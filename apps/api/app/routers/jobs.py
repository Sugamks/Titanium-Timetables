import asyncio
import json
from threading import Thread

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user, require_roles
from app.database import SessionLocal, get_db
from app.services.impact import clone_version, compute_impact
from app.services.jobs import apply_solution, enqueue_job, execute_job

router = APIRouter(prefix="/v1", tags=["jobs"])


class GenerateIn(BaseModel):
    version_id: str
    mode: str = "balanced"
    objectives: list[str] | None = None


class ApplyIn(BaseModel):
    solution_id: str


class ImpactIn(BaseModel):
    version_id: str
    room_resource_id: str | None = None
    teacher_resource_id: str | None = None


class ScenarioIn(BaseModel):
    source_version_id: str
    name: str
    change_spec: dict | None = None


def _run_job_thread(job_id: str):
    db = SessionLocal()
    try:
        execute_job(db, job_id)
    finally:
        db.close()


def _start(job: models.GenerationJob):
    Thread(target=_run_job_thread, args=(job.id,), daemon=True).start()
    return {"job_id": job.id, "status": job.status}


def _require_live_version(db: Session, version_id: str) -> models.TimetableVersion:
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404, "Version not found")
    if v.timetable and v.timetable.deleted_at:
        raise HTTPException(400, "This template was deleted. Restore it first.")
    return v


@router.post("/generate")
def generate(body: GenerateIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    _require_live_version(db, body.version_id)
    job = enqueue_job(db, "generate", body.version_id, {"mode": body.mode, "objectives": body.objectives})
    return _start(job)


@router.post("/repair")
def repair(body: GenerateIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    _require_live_version(db, body.version_id)
    job = enqueue_job(db, "repair", body.version_id, {"mode": body.mode, "local_repair": True})
    return _start(job)


@router.post("/impact")
def impact(body: ImpactIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = enqueue_job(
        db,
        "impact",
        body.version_id,
        {"room_resource_id": body.room_resource_id, "teacher_resource_id": body.teacher_resource_id},
    )
    # impact is cheap — run inline then still return job
    execute_job(db, job.id)
    return {"job_id": job.id, "status": "completed", "result": compute_impact(db, body.version_id, body.model_dump())}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = db.get(models.GenerationJob, job_id)
    if not job:
        raise HTTPException(404)
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "best_score": job.best_score,
    }


@router.get("/jobs/{job_id}/solutions")
def solutions(job_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    job = db.get(models.GenerationJob, job_id)
    if not job:
        raise HTTPException(404)
    return [
        {
            "id": s.id,
            "label": s.label,
            "score": s.score,
            "metrics": s.metrics,
            "explanation": s.explanation,
            "allocation_count": len(s.allocations or []),
        }
        for s in job.solutions
    ]


@router.get("/jobs/{job_id}/solutions/{solution_id}/preview")
def preview_solution(job_id: str, solution_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    from app.engine.solver import preview_placements

    job = db.get(models.GenerationJob, job_id)
    sol = db.get(models.GenerationSolution, solution_id)
    if not job or not sol or sol.job_id != job_id:
        raise HTTPException(404, "Solution not found")
    version = db.get(models.TimetableVersion, job.version_id)
    if not version:
        raise HTTPException(404, "Version not found")
    grid = preview_placements(db, version, sol.allocations or [])
    return {
        "id": sol.id,
        "label": sol.label,
        "score": sol.score,
        "metrics": sol.metrics,
        "explanation": sol.explanation,
        **grid,
    }


@router.post("/jobs/{job_id}/apply")
def apply(job_id: str, body: ApplyIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        nv = apply_solution(db, job_id, body.solution_id, user.get("name") or user.get("sub"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"version_id": nv.id, "number": nv.number, "status": nv.status}


@router.post("/scenarios")
def scenarios(body: ScenarioIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    src = db.get(models.TimetableVersion, body.source_version_id)
    if not src:
        raise HTTPException(404)
    nv = clone_version(db, src, "scenario", body.name, user.get("name") or "user")
    sc = models.Scenario(source_version_id=src.id, result_version_id=nv.id, name=body.name, change_spec=body.change_spec or {})
    db.add(sc)
    db.commit()
    return {"scenario_id": sc.id, "version_id": nv.id}


@router.websocket("/jobs/{job_id}/events")
async def job_events(websocket: WebSocket, job_id: str):
    await websocket.accept()
    try:
        while True:
            db = SessionLocal()
            try:
                job = db.get(models.GenerationJob, job_id)
                if not job:
                    await websocket.send_text(json.dumps({"error": "not found"}))
                    break
                await websocket.send_text(
                    json.dumps(
                        {
                            "status": job.status,
                            "progress": job.progress,
                            "message": job.message,
                            "best_score": job.best_score,
                        }
                    )
                )
                if job.status in ("completed", "failed"):
                    break
            finally:
                db.close()
            await asyncio.sleep(0.6)
    except WebSocketDisconnect:
        return
