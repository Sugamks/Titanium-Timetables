from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.engine.conflicts import hard_health
from app.engine.occupancy import allocation_class_fields, lesson_covers_section, lesson_sections
from app.services.impact import clone_version
from app.services.quality import quality_report
from app.services.audit import actor_label
from app.services.institution import institution_name
from app.services.profile import session_profile
from app.services.staff_profile import read_profile, write_profile
from app.services.day_times import day_payload
from app.services.ttl_file import checkpoint_current


router = APIRouter(prefix="/v1", tags=["publish"])


def _push_version(db: Session, v: models.TimetableVersion, user: dict, status: str):
    health = hard_health(db, v.id)
    for other in v.timetable.versions:
        if other.status in ("published", "saved") and other.id != v.id:
            other.status = "archived"
    v.status = status
    v.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
    if status == "published" and v.timetable:
        v.timetable.status = "published"
        v.timetable.locked_version_id = v.id
    db.add(
        models.ChangeEvent(
            entity="timetable_version",
            entity_id=v.id,
            actor=actor_label(user),
            reason="publish" if status == "published" else "save-ttl",
            new_value={"status": status},
        )
    )
    db.commit()
    checkpoint_current()
    return {
        "id": v.id,
        "status": v.status,
        "quality": quality_report(db, v.id),
        "health": health,
    }


@router.post("/publish/{version_id}")
@router.post("/save/{version_id}")
def save(version_id: str, db: Session = Depends(get_db), user=Depends(require_roles("scheduler_admin", "constructor"))):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404)
    return _push_version(db, v, user, "saved")


@router.post("/go-live/{version_id}")
def go_live(version_id: str, db: Session = Depends(get_db), user=Depends(require_roles("scheduler_admin", "constructor"))):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404)
    return _push_version(db, v, user, "published")


@router.post("/versions/{version_id}/approve")
def approve(version_id: str, db: Session = Depends(get_db), user=Depends(require_roles("scheduler_admin"))):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404)
    v.status = "approved"
    db.commit()
    return {"id": v.id, "status": v.status}


@router.post("/versions/{version_id}/clone")
def clone(version_id: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404)
    nv = clone_version(db, v, "draft", f"Clone of v{v.number}", user.get("name") or "user")
    return {"id": nv.id, "number": nv.number}


@router.post("/versions/{version_id}/rollback")
def rollback(version_id: str, db: Session = Depends(get_db), user=Depends(require_roles("scheduler_admin"))):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404)
    nv = clone_version(db, v, "draft", f"Rollback to v{v.number}", user.get("name") or "user")
    return {"id": nv.id}


def latest_live_version(rows, timetable_id: str | None = None):
    live = [v for v in rows if getattr(v, "status", None) in ("saved", "published")]
    if timetable_id:
        live = [v for v in live if getattr(v, "timetable_id", None) == timetable_id]
    if not live:
        return None
    return max(live, key=lambda v: v.published_at or datetime.min)


def _published(
    db: Session, academic_year_id: str | None = None, timetable_id: str | None = None
) -> models.TimetableVersion | None:
    q = (
        db.query(models.TimetableVersion)
        .join(models.Timetable, models.Timetable.id == models.TimetableVersion.timetable_id)
        .filter(models.TimetableVersion.status.in_(("saved", "published")))
        .filter(models.Timetable.deleted_at.is_(None))
    )
    if academic_year_id:
        q = q.filter(models.Timetable.academic_year_id == academic_year_id)
    if timetable_id:
        q = q.filter(models.Timetable.id == timetable_id)
    return latest_live_version(q.all(), timetable_id)


def _grid_payload(db: Session, version: models.TimetableVersion, alloc_filter):
    grid_id = version.timetable.time_grid_id
    days = db.query(models.Day).filter_by(time_grid_id=grid_id).order_by(models.Day.sort_order).all()
    periods = db.query(models.Period).filter_by(time_grid_id=grid_id).order_by(models.Period.sort_order).all()
    rooms = {r.resource_id: (r.resource.name if r.resource else "") for r in db.query(models.Room).all()}
    cells = []
    for a in version.allocations:
        if not alloc_filter(a):
            continue
        les = a.lesson
        classes = allocation_class_fields(les)
        cells.append(
            {
                "day_id": a.day_id,
                "period_id": a.period_id,
                "subject": les.subject.name if les and les.subject else "",
                "short": (les.subject.short_name or les.subject.name) if les and les.subject else "",
                "color": (les.subject.color if les and les.subject else None) or "#64748b",
                "section": classes["section"],
                "section_ids": classes["section_ids"],
                "sections": classes["sections"],
                "teacher": next((lr.resource.name for lr in les.resources if lr.resource and lr.resource.type == "teacher"), None) if les else None,
                "room": rooms.get(a.room_resource_id) or "",
            }
        )
    return {
        "ok": True,
        "version_id": version.id,
        "version_number": version.number,
        "status": version.status,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "timetable_id": version.timetable_id,
        "timetable_name": version.timetable.name if version.timetable else "Timetable",
        "days": [day_payload(d) for d in days],
        "periods": [
            {
                "id": p.id,
                "name": p.name,
                "sort_order": p.sort_order,
                "period_type": p.period_type or "teaching",
                "start_time": str(p.start_time)[:5] if p.start_time else None,
                "end_time": str(p.end_time)[:5] if p.end_time else None,
            }
            for p in periods
        ],
        "cells": cells,
    }


class ProfileIn(BaseModel):
    name: str
    username: str
    email: str = ""
    institution: str = ""
    roles: list[str] = []
    can_construct: bool = True


@router.get("/me")
def me(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return session_profile(user, None, institution=institution_name())


@router.get("/profile")
def get_staff_profile(_=Depends(get_current_user)):
    return read_profile()


@router.put("/profile")
def put_staff_profile(body: ProfileIn, _=Depends(get_current_user)):
    try:
        return write_profile(
            body.name,
            body.username,
            email=body.email,
            institution=body.institution,
            roles=body.roles,
            can_construct=body.can_construct,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/class-timetable")
def class_timetable(
    section_id: str | None = None,
    academic_year_id: str | None = None,
    timetable_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    v = _published(db, academic_year_id, timetable_id)
    if not v:
        return {"ok": False, "error": "No timetable has been saved or published yet."}
    year_id = academic_year_id or (v.timetable.academic_year_id if v.timetable else None)
    sec = db.get(models.Section, section_id) if section_id else None
    if sec and year_id and sec.academic_year_id and sec.academic_year_id != year_id:
        name = sec.resource.name if sec.resource else None
        if name:
            for other in db.query(models.Section).filter(models.Section.academic_year_id == year_id).all():
                if other.resource and other.resource.name == name:
                    sec = other
                    break
    if not sec:
        return {"ok": False, "error": "Pick a class to view its week."}

    payload = _grid_payload(db, v, lambda a: a.lesson and lesson_covers_section(a.lesson, sec.id))
    payload["section_name"] = sec.resource.name if sec.resource else ""
    payload["section_id"] = sec.id
    return payload


@router.get("/me/timetable")
def my_timetable(
    teacher_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    v = _published(db)
    if not v:
        return {"ok": False, "error": "No timetable has been published yet."}
    teacher = db.get(models.Teacher, teacher_id) if teacher_id else None
    if not teacher:
        return {"ok": False, "error": "Pick a teacher to view their week."}

    def filt(a):
        return any(lr.resource_id == teacher.resource_id for lr in a.lesson.resources)

    payload = _grid_payload(db, v, filt)
    payload["teacher_name"] = teacher.resource.name if teacher.resource else ""
    return payload


@router.get("/audit")
def audit(limit: int = 200, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.ChangeEvent).order_by(models.ChangeEvent.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "entity": r.entity,
            "entity_id": r.entity_id,
            "actor": r.actor,
            "reason": r.reason,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
