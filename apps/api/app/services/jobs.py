from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy.orm import Session

from app import models
from app.engine.solver import apply_allocations, run_generate


def enqueue_job(db: Session, kind: str, version_id: str, payload: dict | None = None) -> models.GenerationJob:
    job = models.GenerationJob(kind=kind, version_id=version_id, status="pending", payload=payload or {})
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_job(db: Session, job_id: str, **kwargs):
    job = db.get(models.GenerationJob, job_id)
    if not job:
        return
    for k, v in kwargs.items():
        setattr(job, k, v)
    db.commit()


def execute_job(db: Session, job_id: str) -> None:
    job = db.get(models.GenerationJob, job_id)
    if not job:
        return
    job.status = "running"
    job.progress = 5
    db.commit()

    def cb(pct, msg):
        job.progress = pct
        job.message = msg
        db.commit()

    try:
        if job.kind in ("generate", "repair"):
            result = run_generate(db, job.version_id, mode=(job.payload or {}).get("mode") or "balanced", progress_cb=cb)
            for sol in result.get("solutions") or []:
                db.add(
                    models.GenerationSolution(
                        job_id=job.id,
                        label=sol["label"],
                        score=sol["score"],
                        metrics=sol["metrics"],
                        allocations=sol["allocations"],
                        explanation=sol.get("explanation"),
                    )
                )
            job.best_score = max((s["score"] for s in result.get("solutions") or [ {"score": 0} ]), default=0)
            job.status = "completed"
            job.progress = 100
            job.message = "Completed"
            db.commit()
        elif job.kind == "impact":
            from app.services.impact import compute_impact

            data = compute_impact(db, job.version_id, job.payload or {})
            db.add(
                models.GenerationSolution(
                    job_id=job.id,
                    label="I",
                    score=0,
                    metrics=data,
                    allocations=[],
                    explanation=data,
                )
            )
            job.status = "completed"
            job.progress = 100
            db.commit()
        else:
            job.status = "completed"
            job.progress = 100
            db.commit()
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.message = str(exc)
        db.commit()


def apply_solution(db: Session, job_id: str, solution_id: str, actor: str) -> models.TimetableVersion:
    sol = db.get(models.GenerationSolution, solution_id)
    job = db.get(models.GenerationJob, job_id)
    if not sol or not job or sol.job_id != job_id:
        raise ValueError("solution not found")
    src = db.get(models.TimetableVersion, job.version_id)
    if not src:
        raise ValueError("version not found")
    src.status = "draft"
    src.label = f"Draft · {sol.label}"
    apply_allocations(db, src, sol.allocations or [], actor, f"apply solution {sol.label}")
    return src
