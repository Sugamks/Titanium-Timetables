from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.services.substitution import (
    apply_leave_window,
    cover_ids,
    ensure_day,
    remove_absence,
    score_candidates,
    seed_covers_for_absence,
    seed_day,
    serialize_day,
    set_cover_teachers,
    touch_cover,
    usable_version,
)

router = APIRouter(prefix="/v1/operations", tags=["operations"])


class AbsenceIn(BaseModel):
    teacher_id: str
    on_date: date
    leave_for: str = "fullday"
    source: str = "adhoc"
    time_in: time | None = None
    time_out: time | None = None


class ExemptionIn(BaseModel):
    teacher_id: str
    kind: str = "full"
    from_date: date | None = None
    to_date: date | None = None
    params: dict | None = None


class DutyIn(BaseModel):
    teacher_id: str
    on_date: date
    period_id: str | None = None
    title: str = "Duty"


class SubDayIn(BaseModel):
    on_date: date
    version_id: str | None = None
    timetable_id: str | None = None


class CoverIn(BaseModel):
    allocation_id: str | None = None
    cover_id: str | None = None
    cover_teacher_id: str | None = None
    cover_teacher_ids: list[str] | None = None
    status: str = "covered"


class IgnoreIn(BaseModel):
    cover_id: str
    ignored: bool = True
    reason: str | None = None


def _open_day(
    db: Session,
    on_date: date,
    version_id: str | None = None,
    timetable_id: str | None = None,
) -> models.SubstitutionDay:
    version = usable_version(db, version_id, timetable_id)
    if not version:
        raise HTTPException(400, "Need a saved or published timetable first")
    day = ensure_day(db, on_date, version)
    seed_day(db, day)
    return day


def _cover_row(db: Session, day: models.SubstitutionDay, body: CoverIn) -> models.SubstitutionCover:
    if body.cover_id:
        cover = db.get(models.SubstitutionCover, body.cover_id)
        if cover and cover.substitution_day_id == day.id:
            return cover
    if body.allocation_id:
        cover = next((c for c in day.covers if c.allocation_id == body.allocation_id), None)
        if cover:
            return cover
    raise HTTPException(404, "Cover row missing")


@router.get("/absences")
def list_absences(on_date: date | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.Absence)
    if on_date:
        q = q.filter_by(on_date=on_date)
    rows = q.all()
    return [
        {
            "id": r.id,
            "teacher_id": r.teacher_id,
            "teacher": r.teacher.resource.name if r.teacher and r.teacher.resource else None,
            "on_date": str(r.on_date),
            "source": r.source,
            "leave_for": r.leave_for,
            "time_in": r.time_in.strftime("%H:%M") if r.time_in else None,
            "time_out": r.time_out.strftime("%H:%M") if r.time_out else None,
        }
        for r in rows
    ]


@router.post("/absences")
def add_absence(body: AbsenceIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    teacher = db.get(models.Teacher, body.teacher_id)
    if not teacher:
        raise HTTPException(404, "Teacher not found")
    existing = db.query(models.Absence).filter_by(teacher_id=body.teacher_id, on_date=body.on_date).first()
    if existing:
        raise HTTPException(400, "This teacher is already on the substitution list for that date")
    row = models.Absence(
        teacher_id=body.teacher_id,
        on_date=body.on_date,
        leave_for=body.leave_for,
        source=body.source,
        time_in=body.time_in,
        time_out=body.time_out,
    )
    apply_leave_window(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    days = db.query(models.SubstitutionDay).filter_by(on_date=body.on_date).all()
    for day in days:
        version = db.get(models.TimetableVersion, day.based_on_version_id)
        if version:
            seed_covers_for_absence(db, day, version, row)
    return {"id": row.id}


@router.delete("/absences/{aid}")
def delete_absence(aid: str, clear_covers: bool = True, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    row = db.get(models.Absence, aid)
    if not row:
        raise HTTPException(404)
    remove_absence(db, row, clear_covers=clear_covers)
    return {"ok": True}


@router.get("/exemptions")
def list_exemptions(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.Exemption).all()
    return [
        {
            "id": r.id,
            "teacher_id": r.teacher_id,
            "kind": r.kind,
            "from_date": str(r.from_date) if r.from_date else None,
            "to_date": str(r.to_date) if r.to_date else None,
            "params": r.params,
            "name": r.teacher.resource.name if r.teacher and r.teacher.resource else None,
        }
        for r in rows
    ]


@router.post("/exemptions")
def add_exemption(body: ExemptionIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    exists = db.query(models.Exemption).filter_by(teacher_id=body.teacher_id).first()
    if exists:
        raise HTTPException(400, "This teacher is already exempted")
    row = models.Exemption(
        teacher_id=body.teacher_id,
        kind=body.kind if body.kind in ("full", "partial") else "full",
        from_date=body.from_date,
        to_date=body.to_date,
        params=body.params or {},
    )
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.delete("/exemptions/{eid}")
def del_exemption(eid: str, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    row = db.get(models.Exemption, eid)
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.get("/duties")
def list_duties(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.Duty).all()
    return [{"id": r.id, "teacher_id": r.teacher_id, "on_date": str(r.on_date), "period_id": r.period_id, "title": r.title} for r in rows]


@router.post("/duties")
def add_duty(body: DutyIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    row = models.Duty(**body.model_dump())
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.get("/day")
def get_day(
    on_date: date,
    timetable_id: str | None = None,
    version_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    version = usable_version(db, version_id, timetable_id)
    day = None
    if version:
        day = (
            db.query(models.SubstitutionDay)
            .filter_by(on_date=on_date, based_on_version_id=version.id)
            .first()
        )
    if not day and version:
        day = _open_day(db, on_date, version.id, timetable_id)
    if not day:
        return {"day": None, "error": "Need a saved or published timetable first"}
    return serialize_day(db, day)


@router.post("/day")
def open_day(body: SubDayIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = _open_day(db, body.on_date, body.version_id, body.timetable_id)
    return serialize_day(db, day)


@router.get("/substitutions")
def list_subs(on_date: date | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(models.SubstitutionDay)
    if on_date:
        q = q.filter_by(on_date=on_date)
    return [serialize_day(db, r) for r in q.all()]


@router.post("/substitutions")
def create_sub_day(body: SubDayIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = _open_day(db, body.on_date, body.version_id, body.timetable_id)
    return serialize_day(db, day)


@router.post("/substitutions/{sid}/candidates")
def candidates(
    sid: str,
    allocation_id: str | None = None,
    cover_id: str | None = None,
    section_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_roles("substitutor")),
):
    day = db.get(models.SubstitutionDay, sid)
    if not day:
        raise HTTPException(404)
    cover = None
    if cover_id:
        cover = db.get(models.SubstitutionCover, cover_id)
    elif allocation_id:
        cover = next((c for c in day.covers if c.allocation_id == allocation_id), None)
    if not cover or cover.substitution_day_id != day.id:
        raise HTTPException(404, "Cover row missing")
    alloc = db.get(models.LessonAllocation, cover.allocation_id) if cover.allocation_id else None
    if not alloc:
        raise HTTPException(404)
    absent = db.get(models.Teacher, cover.absent_teacher_id)
    version = db.get(models.TimetableVersion, day.based_on_version_id)
    return score_candidates(db, version, alloc, absent, on_date=day.on_date, day=day, section_id=section_id)


@router.post("/substitutions/{sid}/cover")
def assign_cover(sid: str, body: CoverIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = db.get(models.SubstitutionDay, sid)
    if not day:
        raise HTTPException(404)
    cover = _cover_row(db, day, body)
    ids = body.cover_teacher_ids or ([body.cover_teacher_id] if body.cover_teacher_id else [])
    set_cover_teachers(cover, ids)
    if body.status == "ignored":
        cover.status = "ignored"
        touch_cover(cover, user, "ignored")
    else:
        touch_cover(cover, user, "assigned" if ids else "cleared")
    db.commit()
    return {"id": cover.id, "status": cover.status, "cover_teacher_ids": cover_ids(cover)}


@router.post("/substitutions/{sid}/cover/clear")
def clear_cover(sid: str, body: CoverIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = db.get(models.SubstitutionDay, sid)
    if not day:
        raise HTTPException(404)
    cover = _cover_row(db, day, body)
    set_cover_teachers(cover, [])
    touch_cover(cover, user, "cleared")
    db.commit()
    return {"id": cover.id, "status": cover.status}


@router.post("/substitutions/{sid}/ignore")
def ignore_cover(sid: str, body: IgnoreIn, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = db.get(models.SubstitutionDay, sid)
    cover = db.get(models.SubstitutionCover, body.cover_id)
    if not day or not cover or cover.substitution_day_id != day.id:
        raise HTTPException(404)
    if body.ignored:
        cover.status = "ignored"
        touch_cover(cover, user, "ignored", body.reason or "No substitute needed")
    else:
        cover.status = "covered" if cover_ids(cover) else "pending"
        touch_cover(cover, user, "reopened")
    db.commit()
    return {"id": cover.id, "status": cover.status}


@router.post("/substitutions/{sid}/publish")
def publish_sub(sid: str, db: Session = Depends(get_db), user=Depends(require_roles("substitutor"))):
    day = db.get(models.SubstitutionDay, sid)
    if not day:
        raise HTTPException(404)
    pending = [c for c in day.covers if c.status == "pending" and not cover_ids(c)]
    day.status = "published"
    db.commit()
    return {"id": day.id, "status": day.status, "pending": len(pending)}
