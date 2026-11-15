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
    alloc_week_code,
    allocation_view_fields,
    duration_block,
    exclusive_tokens,
    groups_by_section_map,
    lesson_band,
    lesson_rooms,
    lesson_section_ids,
    load_availability,
    normalize_week_lane,
    occupy_keys,
    other_week_lane,
    slot_availability,
    teacher_fields,
    teaching_periods,
    valid_starts,
    week_lanes,
    week_pattern_code_map,
    week_pattern_id_by_code,
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
    swap_with_id: str | None = None
    lock_level: str = "none"
    stack: bool = False
    band_id: str | None = None
    week_lane: str | None = None


class CollapseWeekIn(BaseModel):
    keep: str


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


def _require_draft(db: Session, version_id: str) -> models.TimetableVersion:
    version = db.get(models.TimetableVersion, version_id)
    if not version:
        raise HTTPException(404, "Version not found")
    if (version.status or "") in ("published", "archived"):
        raise HTTPException(400, "This week is published. Open a draft to change it.")
    return version


def _card_label(db: Session, lesson_id: str | None) -> str:
    lesson = db.get(models.Lesson, lesson_id) if lesson_id else None
    if lesson and lesson.subject and lesson.subject.name:
        return lesson.subject.name
    return "a card"


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
    id_to_code = week_pattern_code_map(db)
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
            "week_code": alloc_week_code(a, lesson=les, id_to_code=id_to_code),
            "room_resource_id": a.room_resource_id,
            "occurrence_index": a.occurrence_index,
            "lock_level": a.lock_level,
            "subject": les.subject.name if les.subject else "",
            "short": les.subject.short_name if les.subject else "",
            "color": les.subject.color if les.subject else "#64748b",
            **allocation_view_fields(les),
            **teacher_fields(t),
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


def _alloc_lanes(
    alloc: models.LessonAllocation | None,
    lesson: models.Lesson | None = None,
    *,
    week_lane: str | None = None,
    id_to_code: dict[str, str] | None = None,
) -> set[str]:
    """Odd (A) and Even (B) do not overlap; Every week (ALL) overlaps both."""
    code = alloc_week_code(alloc, lesson=lesson, week_lane=week_lane, id_to_code=id_to_code)
    return set(week_lanes(code))


def _alloc_section_ids(alloc: models.LessonAllocation | None, lesson: models.Lesson | None = None) -> set[str]:
    les = lesson if lesson is not None else (alloc.lesson if alloc is not None else None)
    return set(lesson_section_ids(les) or []) if les else set()


def _resolve_place_pattern_id(db: Session, week_lane: str | None, lesson: models.Lesson | None) -> str | None:
    lane = normalize_week_lane(week_lane) if week_lane else "ALL"
    if lane in ("WEEK_A", "WEEK_B"):
        return week_pattern_id_by_code(db, lane)
    if lesson and lesson.week_pattern_id:
        return lesson.week_pattern_id
    return week_pattern_id_by_code(db, "ALL")


def _fork_all_allocation(
    db: Session,
    moving: models.LessonAllocation,
    active_lane: str,
    id_to_code: dict[str, str],
) -> None:
    """Split Every-week card into Odd+Even; keep edit on active lane, clone other at old slot."""
    current = alloc_week_code(moving, lesson=moving.lesson, id_to_code=id_to_code)
    if current != "ALL" or active_lane not in ("WEEK_A", "WEEK_B"):
        if active_lane in ("WEEK_A", "WEEK_B"):
            moving.week_pattern_id = week_pattern_id_by_code(db, active_lane)
        return
    other = other_week_lane(active_lane)
    other_id = week_pattern_id_by_code(db, other)
    active_id = week_pattern_id_by_code(db, active_lane)
    if not other_id or not active_id:
        raise HTTPException(
            400,
            "Odd/Even week patterns are missing. Add WEEK_A and WEEK_B before editing Separate weeks.",
        )
    clone = models.LessonAllocation(
        lesson_id=moving.lesson_id,
        version_id=moving.version_id,
        day_id=moving.day_id,
        period_id=moving.period_id,
        room_resource_id=moving.room_resource_id,
        occurrence_index=moving.occurrence_index,
        lock_level=moving.lock_level,
        week_pattern_id=other_id,
    )
    db.add(clone)
    moving.week_pattern_id = active_id
    db.flush()


@router.post("/allocations")
def place(body: PlaceIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if body.allocation_id and str(body.allocation_id).startswith("preview-"):
        raise HTTPException(400, "This is a preview. Click Use this timetable, then you can swap periods.")
    _require_draft(db, body.version_id)
    lesson_load = (
        joinedload(models.Lesson.week_pattern),
        joinedload(models.Lesson.section_links),
        joinedload(models.Lesson.section),
    )
    id_to_code = week_pattern_code_map(db)
    active_lane = normalize_week_lane(body.week_lane) if body.week_lane else None
    incoming = db.get(models.Lesson, body.lesson_id)
    if incoming:
        incoming = (
            db.query(models.Lesson)
            .options(*lesson_load)
            .filter_by(id=body.lesson_id)
            .first()
        )
    slot_allocs = (
        db.query(models.LessonAllocation)
        .options(joinedload(models.LessonAllocation.lesson).options(*lesson_load))
        .filter_by(version_id=body.version_id, day_id=body.day_id, period_id=body.period_id)
        .all()
    )
    moving = None
    if body.allocation_id:
        moving = (
            db.query(models.LessonAllocation)
            .options(joinedload(models.LessonAllocation.lesson).options(*lesson_load))
            .filter_by(id=body.allocation_id)
            .first()
        )
        if moving and active_lane in ("WEEK_A", "WEEK_B"):
            _fork_all_allocation(db, moving, active_lane, id_to_code)
            id_to_code = week_pattern_code_map(db)
    move_lanes = _alloc_lanes(moving, incoming, week_lane=active_lane, id_to_code=id_to_code)
    move_sections = _alloc_section_ids(moving, incoming)
    # Odd/Even share a cell visually only when lanes overlap. Ignore the other fortnight half.
    lane_peers = [
        a
        for a in slot_allocs
        if a.id != body.allocation_id and (_alloc_lanes(a, id_to_code=id_to_code) & move_lanes)
    ]
    # Parallel classes share a period; only same-class cards are swap/stack peers.
    class_peers = [
        a
        for a in lane_peers
        if not move_sections or (_alloc_section_ids(a) & move_sections)
    ]
    band = None
    if body.band_id:
        band = db.get(models.LessonBand, body.band_id)
    if incoming and not band:
        band = lesson_band(incoming)
    same_band_slot = bool(
        band and lane_peers and any(lesson_band(a.lesson) and lesson_band(a.lesson).id == band.id for a in lane_peers)
    )
    if band and (body.band_id or same_band_slot):
        try:
            return extend_band_to_slot(db, body.version_id, body.day_id, body.period_id, band.id)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    payload = body.model_dump()
    if active_lane:
        payload["week_lane"] = active_lane
    issues = allocation_conflicts(
        db,
        body.version_id,
        payload,
        ignore_id=body.allocation_id,
    )
    occupant = None
    target_day_id = body.day_id
    target_period_id = body.period_id
    if body.allocation_id and not body.stack and body.swap_with_id:
        # Explicit two-card swap — do not guess by slot/lane.
        explicit = (
            db.query(models.LessonAllocation)
            .options(joinedload(models.LessonAllocation.lesson).options(*lesson_load))
            .filter_by(id=body.swap_with_id, version_id=body.version_id)
            .first()
        )
        if not explicit:
            raise HTTPException(400, "The other card is not on this timetable.")
        if explicit.id == body.allocation_id:
            raise HTTPException(400, "Pick two different cards to swap.")
        # Must sit in the drop cell (or a multi-period block that covers it).
        if explicit.day_id != body.day_id:
            raise HTTPException(400, "That card is not in this period.")
        if explicit.period_id != body.period_id:
            v = db.get(models.TimetableVersion, body.version_id)
            exp_les = explicit.lesson
            exp_dur = max(1, (exp_les.duration_periods if exp_les else 1) or 1)
            teaching = teaching_periods(
                db.query(models.Period)
                .filter_by(time_grid_id=v.timetable.time_grid_id)
                .order_by(models.Period.sort_order)
                .all()
            ) if v and v.timetable else []
            cover = duration_block(teaching, explicit.period_id, exp_dur) if teaching else None
            cover_ids = [p.id for p in cover] if cover else [explicit.period_id]
            if body.period_id not in cover_ids:
                raise HTTPException(400, "That card is not in this period.")
        if active_lane in ("WEEK_A", "WEEK_B"):
            _fork_all_allocation(db, explicit, active_lane, id_to_code)
        occupant = explicit
        # Use the other card's real start period (not a duration block continuation cell).
        target_day_id = explicit.day_id
        target_period_id = explicit.period_id
    elif body.allocation_id and not body.stack and class_peers:
        occupant = class_peers[0]
        if active_lane in ("WEEK_A", "WEEK_B"):
            _fork_all_allocation(db, occupant, active_lane, id_to_code)
    waive = {"class"} if body.stack else set()
    if body.stack and incoming and any(a.lesson_id == incoming.id for a in class_peers):
        waive.add("teacher")
    blocking = [i for i in issues if not i["ok"] and i["code"] not in waive]
    # Explicit swap always proceeds; conflict list is advisory for the move-into-empty path.
    if blocking and not occupant:
        raise _conflict_http(issues)
    place_pattern_id = _resolve_place_pattern_id(db, active_lane, incoming)
    if body.allocation_id:
        a = moving or db.get(models.LessonAllocation, body.allocation_id)
        if not a:
            raise HTTPException(400, "That lesson is not on the saved timetable yet. Click Use this timetable, then swap.")
        if a.lock_level == "full":
            raise HTTPException(400, "This card is locked. Unlock it before moving it.")
        old = {"day_id": a.day_id, "period_id": a.period_id}
        if occupant:
            if occupant.lock_level == "full":
                raise HTTPException(400, "This card is locked. Unlock it before moving it.")
            occupant.day_id, occupant.period_id = a.day_id, a.period_id
        a.day_id = target_day_id
        a.period_id = target_period_id
        a.room_resource_id = body.room_resource_id or a.room_resource_id
        if place_pattern_id:
            a.week_pattern_id = place_pattern_id
        elif not a.week_pattern_id and incoming and incoming.week_pattern_id:
            a.week_pattern_id = incoming.week_pattern_id
        if body.lock_level in ("lesson", "full"):
            a.lock_level = body.lock_level
        label = _card_label(db, a.lesson_id)
        db.add(
            models.ChangeEvent(
                entity="lesson_allocation",
                entity_id=a.id,
                actor=actor_label(user),
                reason=f"Swapped {label}." if occupant else f"Moved {label}.",
                old_value=old,
                new_value={"day_id": target_day_id, "period_id": target_period_id, "week_lane": active_lane or "ALL"},
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
            week_pattern_id=place_pattern_id,
        )
        db.add(a)
        db.flush()
        db.add(
            models.ChangeEvent(
                entity="lesson_allocation",
                entity_id=a.id,
                actor=actor_label(user),
                reason=f"Placed {_card_label(db, a.lesson_id)}.",
            )
        )
    db.commit()
    db.refresh(a)
    return {"id": a.id, "swapped": bool(occupant), "issues": issues}


@router.delete("/allocations/{aid}")
def dealloc(
    aid: str,
    week_lane: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_roles("constructor")),
):
    a = (
        db.query(models.LessonAllocation)
        .options(joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.week_pattern))
        .filter_by(id=aid)
        .first()
    )
    if not a:
        raise HTTPException(404)
    _require_draft(db, a.version_id)
    if a.lock_level == "full":
        raise HTTPException(400, "This card is locked. Unlock it before removing it.")
    id_to_code = week_pattern_code_map(db)
    active_lane = normalize_week_lane(week_lane) if week_lane else None
    if active_lane in ("WEEK_A", "WEEK_B"):
        _fork_all_allocation(db, a, active_lane, id_to_code)
    label = _card_label(db, a.lesson_id)
    db.add(
        models.ChangeEvent(
            entity="lesson_allocation",
            entity_id=aid,
            actor=actor_label(user),
            reason=f"Removed {label} from the week.",
            old_value={"lesson_id": a.lesson_id, "week_lane": active_lane or alloc_week_code(a, id_to_code=id_to_code)},
        )
    )
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/versions/{version_id}/collapse-week")
def collapse_week(
    version_id: str,
    body: CollapseWeekIn,
    db: Session = Depends(get_db),
    user=Depends(require_roles("constructor")),
):
    _require_draft(db, version_id)
    keep = normalize_week_lane(body.keep)
    if keep not in ("WEEK_A", "WEEK_B"):
        raise HTTPException(400, "Pick Odd week or Even week as the shared default.")
    other = other_week_lane(keep)
    id_to_code = week_pattern_code_map(db)
    all_id = week_pattern_id_by_code(db, "ALL")
    allocs = (
        db.query(models.LessonAllocation)
        .options(joinedload(models.LessonAllocation.lesson).joinedload(models.Lesson.week_pattern))
        .filter_by(version_id=version_id)
        .all()
    )
    groups: dict[tuple[str, int], list[models.LessonAllocation]] = {}
    for a in allocs:
        groups.setdefault((a.lesson_id, a.occurrence_index or 0), []).append(a)
    kept = 0
    dropped = 0
    for rows in groups.values():
        ranked = []
        for r in rows:
            code = alloc_week_code(r, lesson=r.lesson, id_to_code=id_to_code)
            ranked.append((code, r))
        keeper = next((r for code, r in ranked if code == keep), None)
        if keeper is None:
            keeper = next((r for code, r in ranked if code == "ALL"), None)
        if keeper is None:
            for _, r in ranked:
                db.delete(r)
                dropped += 1
            continue
        keeper.week_pattern_id = all_id
        kept += 1
        for _, r in ranked:
            if r.id == keeper.id:
                continue
            db.delete(r)
            dropped += 1
    db.add(
        models.ChangeEvent(
            entity="timetable_version",
            entity_id=version_id,
            actor=actor_label(user),
            reason=f"Collapsed Separate weeks to Both using {keep}.",
            new_value={"keep": keep, "other": other, "kept": kept, "dropped": dropped},
        )
    )
    db.commit()
    return {"ok": True, "keep": keep, "kept": kept, "dropped": dropped}


@router.post("/allocations/{aid}/lock")
def lock(aid: str, body: LockIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    a = db.get(models.LessonAllocation, aid)
    if not a:
        raise HTTPException(404)
    _require_draft(db, a.version_id)
    if body.lock_level not in ("none", "lesson", "full"):
        raise HTTPException(400, "Lock must be none, lesson, or full.")
    a.lock_level = body.lock_level
    label = _card_label(db, a.lesson_id)
    if body.lock_level == "full":
        reason = f"Locked {label}. It cannot be moved."
    elif body.lock_level == "lesson":
        reason = f"Pinned {label}. Generate will not move it."
    else:
        reason = f"Unlocked {label}."
    db.add(models.ChangeEvent(entity="lesson_allocation", entity_id=a.id, actor=actor_label(user), reason=reason))
    db.commit()
    return {"id": a.id, "lock_level": a.lock_level}


@router.post("/cell-group")
def cell_group(body: CellGroupIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    _require_draft(db, body.version_id)
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
def possible_slots(
    version_id: str,
    lesson_id: str,
    week_lane: str | None = None,
    allocation_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
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
    id_to_code = week_pattern_code_map(db)
    moving = db.get(models.LessonAllocation, allocation_id) if allocation_id else None
    code = alloc_week_code(moving, lesson=les, week_lane=week_lane, id_to_code=id_to_code)
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
        if allocation_id and alloc.id == allocation_id:
            continue
        other = alloc.lesson
        other_code = alloc_week_code(alloc, lesson=other, id_to_code=id_to_code)
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
