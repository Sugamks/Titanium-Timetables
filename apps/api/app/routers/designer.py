from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.services.audit import actor_label
from app.engine.conflicts import (
    allocation_conflicts,
    alternative_rooms,
    classify_slot_hint,
    hard_health,
    occupancy_clash,
    teacher_of,
)
from app.engine.handlers import placement_blockers
from app.engine.occupancy import (
    STATE_UNAVAILABLE,
    allocation_view_fields,
    duration_block,
    exclusive_tokens,
    groups_by_section_map,
    lesson_band,
    lesson_rooms,
    load_availability,
    occupy_keys,
    slot_availability,
    teaching_periods,
    valid_starts,
    week_code,
    week_lanes,
)
from app.services.constraint_presets import relevant_constraints
from app.services.cell_groups import extend_band_to_slot, remove_from_band, save_cell_groups
from app.services.day_times import day_payload

router = APIRouter(prefix="/v1/designer", tags=["designer"])


class PlaceIn(BaseModel):
    version_id: str
    lesson_id: str
    day_id: str
    period_id: str
    room_resource_id: str | None = None
    occurrence_index: int = 0
    allocation_id: str | None = None
    lock_level: str = "none"
    stack: bool = False
    band_id: str | None = None


class CellGroupMember(BaseModel):
    lesson_id: str
    group_name: str


class CellGroupIn(BaseModel):
    version_id: str
    day_id: str
    period_id: str
    members: list[CellGroupMember]
    apply_all: bool = False
    band_name: str = ""


class PreviewIn(BaseModel):
    version_id: str
    lesson_id: str
    day_id: str
    period_id: str
    room_resource_id: str | None = None
    allocation_id: str | None = None


class LockIn(BaseModel):
    lock_level: str


@router.get("/versions/{version_id}")
def version_grid(version_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = db.get(models.TimetableVersion, version_id)
    if not v:
        raise HTTPException(404, "Version not found")
    if v.timetable and v.timetable.deleted_at:
        raise HTTPException(400, "This template was deleted. Restore it first.")
    grid_id = v.timetable.time_grid_id
    days = db.query(models.Day).filter_by(time_grid_id=grid_id).order_by(models.Day.sort_order).all()
    periods = db.query(models.Period).filter_by(time_grid_id=grid_id).order_by(models.Period.sort_order).all()
    teaching = teaching_periods(periods)
    allocs = []
    for a in v.allocations:
        les = a.lesson
        t = teacher_of(les)
        dur = max(1, les.duration_periods or 1) if les else 1
        block = duration_block(teaching, a.period_id, dur)
        period_ids = [p.id for p in block] if block else [a.period_id]
        base = {
            "id": a.id,
            "lesson_id": a.lesson_id,
            "day_id": a.day_id,
            "period_id": a.period_id,
            "period_ids": period_ids,
            "duration_periods": dur,
            "week_pattern_id": a.week_pattern_id,
            "room_resource_id": a.room_resource_id,
            "occurrence_index": a.occurrence_index,
            "lock_level": a.lock_level,
            "subject": les.subject.name if les.subject else "",
            "short": les.subject.short_name if les.subject else "",
            "color": les.subject.color if les.subject else "#64748b",
            **allocation_view_fields(les),
            "teacher": t.name if t else "",
            "teacher_resource_id": t.id if t else None,
            "room": next((r.resource.name for r in db.query(models.Room).all() if r.resource_id == a.room_resource_id), None),
        }
        for offset, pid in enumerate(period_ids):
            allocs.append({**base, "period_id": pid, "block_offset": offset, "block_start": period_ids[0]})
    return {
        "version": {"id": v.id, "status": v.status, "number": v.number, "label": v.label, "timetable_id": v.timetable_id},
        "days": [day_payload(d) for d in days],
        "periods": [{"id": p.id, "name": p.name, "sort_order": p.sort_order, "period_type": p.period_type, "is_teaching": p.period_type == "teaching", "start_time": str(p.start_time)[:5] if p.start_time else None, "end_time": str(p.end_time)[:5] if p.end_time else None} for p in periods],
        "allocations": allocs,
        "health": hard_health(db, version_id),
    }


@router.post("/preview")
def preview(body: PreviewIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    issues = allocation_conflicts(
        db,
        body.version_id,
        {
            "lesson_id": body.lesson_id,
            "day_id": body.day_id,
            "period_id": body.period_id,
            "room_resource_id": body.room_resource_id,
        },
        ignore_id=body.allocation_id,
    )
    blocked = [i for i in issues if not i["ok"]]
    explanation = None
    if blocked:
        explanation = {
            "summary": "Cannot place this lesson in that slot",
            "facts": [i["label"] for i in blocked],
            "suggested_fixes": [],
        }
        for i in issues:
            if i["code"] == "room" and not i["ok"]:
                explanation["suggested_fixes"] = [f"Use {a['name']}" for a in i.get("alternatives") or [] if a.get("ok")][:3]
    return {"issues": issues, "ok": not blocked, "explanation": explanation}


def _conflict_http(issues: list) -> HTTPException:
    labels = [i.get("label") for i in issues if not i.get("ok")]
    return HTTPException(status_code=409, detail={"message": "; ".join(labels) or "Cannot place there", "issues": issues})


@router.post("/allocations")
def place(body: PlaceIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if body.allocation_id and str(body.allocation_id).startswith("preview-"):
        raise HTTPException(400, "This is a preview. Click Use this timetable, then you can swap periods.")
    incoming = db.get(models.Lesson, body.lesson_id)
    slot_allocs = (
        db.query(models.LessonAllocation)
        .filter_by(version_id=body.version_id, day_id=body.day_id, period_id=body.period_id)
        .all()
    )
    band = None
    if body.band_id:
        band = db.get(models.LessonBand, body.band_id)
    if incoming and not band:
        band = lesson_band(incoming)
    same_band_slot = bool(
        band and slot_allocs and any(lesson_band(a.lesson) and lesson_band(a.lesson).id == band.id for a in slot_allocs)
    )
    if band and (body.band_id or same_band_slot):
        try:
            return extend_band_to_slot(db, body.version_id, body.day_id, body.period_id, band.id)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    issues = allocation_conflicts(
        db,
        body.version_id,
        body.model_dump(),
        ignore_id=body.allocation_id,
    )
    occupant = None
    if body.allocation_id and not body.stack:
        occupant = (
            db.query(models.LessonAllocation)
            .filter_by(version_id=body.version_id, day_id=body.day_id, period_id=body.period_id)
            .filter(models.LessonAllocation.id != body.allocation_id)
            .first()
        )
    waive = {"class"} if body.stack else set()
    if body.stack and incoming and any(a.lesson_id == incoming.id for a in slot_allocs):
        waive.add("teacher")
    blocking = [i for i in issues if not i["ok"] and i["code"] not in waive]
    if blocking and not occupant:
        raise _conflict_http(issues)
    if body.allocation_id:
        a = db.get(models.LessonAllocation, body.allocation_id)
        if not a:
            raise HTTPException(400, "That lesson is not on the saved timetable yet. Click Use this timetable, then swap.")
        old = {"day_id": a.day_id, "period_id": a.period_id}
        if occupant:
            occupant.day_id, occupant.period_id = a.day_id, a.period_id
        a.day_id = body.day_id
        a.period_id = body.period_id
        a.room_resource_id = body.room_resource_id or a.room_resource_id
        a.lock_level = body.lock_level
        db.add(
            models.ChangeEvent(
                entity="lesson_allocation",
                entity_id=a.id,
                actor=actor_label(user),
                reason="swap" if occupant else "move",
                old_value=old,
                new_value={"day_id": body.day_id, "period_id": body.period_id},
            )
        )
    else:
        if blocking:
            raise _conflict_http(issues)
        a = models.LessonAllocation(
            lesson_id=body.lesson_id,
            version_id=body.version_id,
            day_id=body.day_id,
            period_id=body.period_id,
            room_resource_id=body.room_resource_id,
            occurrence_index=body.occurrence_index,
            lock_level=body.lock_level,
        )
        db.add(a)
        db.flush()
        db.add(models.ChangeEvent(entity="lesson_allocation", entity_id=a.id, actor=actor_label(user), reason="place"))
    db.commit()
    db.refresh(a)
    return {"id": a.id, "swapped": bool(occupant), "issues": issues}


@router.delete("/allocations/{aid}")
def dealloc(aid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    a = db.get(models.LessonAllocation, aid)
    if not a:
        raise HTTPException(404)
    if a.lock_level == "full":
        raise HTTPException(400, "Locked allocation")
    db.add(models.ChangeEvent(entity="lesson_allocation", entity_id=aid, actor=actor_label(user), reason="dealloc", old_value={"lesson_id": a.lesson_id}))
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/allocations/{aid}/lock")
def lock(aid: str, body: LockIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    a = db.get(models.LessonAllocation, aid)
    if not a:
        raise HTTPException(404)
    a.lock_level = body.lock_level
    db.commit()
    return {"id": a.id, "lock_level": a.lock_level}


@router.post("/cell-group")
def cell_group(body: CellGroupIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        return save_cell_groups(
            db,
            version_id=body.version_id,
            day_id=body.day_id,
            period_id=body.period_id,
            members=[m.model_dump() for m in body.members],
            apply_all=body.apply_all,
            band_name=body.band_name,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class BandExtendIn(BaseModel):
    version_id: str
    day_id: str
    period_id: str
    band_id: str


@router.post("/cell-group/extend")
def cell_group_extend(body: BandExtendIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        return extend_band_to_slot(db, body.version_id, body.day_id, body.period_id, body.band_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class BandRemoveIn(BaseModel):
    version_id: str
    band_id: str
    lesson_id: str
    apply_all: bool = True
    day_id: str | None = None
    period_id: str | None = None


@router.post("/cell-group/remove")
def cell_group_remove(body: BandRemoveIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        return remove_from_band(
            db,
            version_id=body.version_id,
            band_id=body.band_id,
            lesson_id=body.lesson_id,
            apply_all=body.apply_all,
            day_id=body.day_id,
            period_id=body.period_id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/possible-slots")
def possible_slots(version_id: str, lesson_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    v = db.get(models.TimetableVersion, version_id)
    les = db.get(models.Lesson, lesson_id)
    if not v or not les:
        raise HTTPException(404)
    days = db.query(models.Day).filter_by(time_grid_id=v.timetable.time_grid_id).order_by(models.Day.sort_order).all()
    teaching = teaching_periods(
        db.query(models.Period).filter_by(time_grid_id=v.timetable.time_grid_id).order_by(models.Period.sort_order).all()
    )
    dur = max(1, les.duration_periods or 1)
    starts = valid_starts(teaching, dur)
    cells = load_availability(db)
    constraints = relevant_constraints(db, v)
    gmap = groups_by_section_map(db)
    code = week_code(les.week_pattern)
    lanes = week_lanes(code)
    tokens = set(exclusive_tokens(les, gmap))
    room = lesson_rooms(les)
    if room:
        tokens.add(f"room:{room[0].id}")
    occupied: set[tuple] = set()
    allocs = (
        db.query(models.LessonAllocation)
        .options(
            joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.resources),
            joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.week_pattern),
            joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.section_links),
            joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.group_links),
        )
        .filter_by(version_id=version_id)
        .all()
    )
    for alloc in allocs:
        other = alloc.lesson
        other_code = week_code(other.week_pattern) if other else "ALL"
        cover = duration_block(teaching, alloc.period_id, max(1, (other.duration_periods if other else 1) or 1))
        other_periods = [p.id for p in cover] if cover else [alloc.period_id]
        occupied.update(
            occupy_keys(
                exclusive_tokens(other, gmap) if other else set(),
                alloc.day_id,
                other_periods,
                week_lanes(other_code),
            )
        )
    out = []
    available = preferred = blocked = 0
    for d in days:
        for start in starts:
            block = duration_block(teaching, start.id, dur)
            pids = [p.id for p in block] if block else [start.id]
            state = slot_availability(les, d.id, pids, code, cells)
            reasons = placement_blockers(constraints, les, d.id, pids)
            hard = bool(reasons) or occupancy_clash(occupy_keys(tokens, d.id, pids, lanes), occupied)
            status = classify_slot_hint(hard, state)
            if status == "blocked":
                blocked += 1
            elif status == "preferred":
                preferred += 1
            else:
                available += 1
            if hard and not reasons:
                reasons = [state] if state == STATE_UNAVAILABLE else ["Occupied"]
            elif not reasons and state != "available":
                reasons = [state]
            out.append(
                {
                    "day_id": d.id,
                    "day": d.name,
                    "period_id": start.id,
                    "period": start.name,
                    "period_ids": pids,
                    "ok": status != "blocked",
                    "status": status,
                    "reasons": reasons,
                }
            )
    return {"lesson_id": lesson_id, "duration_periods": dur, "available": available, "preferred": preferred, "blocked": blocked, "slots": out}
