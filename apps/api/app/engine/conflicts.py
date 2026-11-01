from collections import defaultdict

from sqlalchemy.orm import Session

from app import models
from app.engine.handlers import placement_blockers
from app.engine.occupancy import (
    STATE_PREFERRED,
    STATE_UNAVAILABLE,
    duration_block,
    exclusive_tokens,
    groups_by_section_map,
    is_teaching,
    lesson_groups,
    lesson_rooms,
    lesson_sections,
    lesson_teachers,
    load_availability,
    occupy_keys,
    availability_state,
    slot_availability,
    teaching_periods,
    week_code,
    week_lanes,
)
from app.services.time_grids import break_label


def classify_slot_hint(hard: bool, state: str) -> str:
    if hard or state == STATE_UNAVAILABLE:
        return "blocked"
    if state == STATE_PREFERRED:
        return "preferred"
    return "available"


def occupancy_clash(proposed: list[tuple], occupied: set[tuple]) -> bool:
    return any(key in occupied for key in proposed)


def teacher_of(lesson: models.Lesson) -> models.Resource | None:
    ts = lesson_teachers(lesson)
    return ts[0] if ts else None


def room_of_lesson(lesson: models.Lesson) -> models.Resource | None:
    rs = lesson_rooms(lesson)
    return rs[0] if rs else None


def _grid_teaching(db: Session, grid_id: str) -> list[models.Period]:
    periods = db.query(models.Period).filter_by(time_grid_id=grid_id).order_by(models.Period.sort_order).all()
    return teaching_periods(periods)


def _allocation_cover(db: Session, alloc: models.LessonAllocation, teaching: list[models.Period]) -> list[str]:
    les = alloc.lesson
    dur = max(1, (les.duration_periods if les else 1) or 1)
    block = duration_block(teaching, alloc.period_id, dur)
    return [p.id for p in block] if block else [alloc.period_id]


def allocation_conflicts(db: Session, version_id: str, candidate: dict, ignore_id: str | None = None) -> list[dict]:
    """Hard conflicts for a proposed placement, including duration blocks, groups, and week lanes."""
    issues = []
    lesson = db.get(models.Lesson, candidate["lesson_id"])
    if not lesson:
        return [{"code": "missing_lesson", "ok": False, "label": "Lesson not found"}]

    version = db.get(models.TimetableVersion, version_id)
    if not version:
        return [{"code": "missing_version", "ok": False, "label": "Version not found"}]

    teaching = _grid_teaching(db, version.timetable.time_grid_id)
    start_period = db.get(models.Period, candidate["period_id"])
    if start_period and not is_teaching(start_period):
        label = break_label(start_period.period_type)
        return [{"code": "break", "ok": False, "label": f"{start_period.name} is a {label} and cannot take lessons"}]
    dur = max(1, lesson.duration_periods or 1)
    block = duration_block(teaching, candidate["period_id"], dur)
    if not block:
        return [{"code": "duration", "ok": False, "label": f"No contiguous {dur}-period block from this start"}]

    period_ids = [p.id for p in block]
    code = week_code(lesson.week_pattern)
    lanes = week_lanes(code)
    gmap = groups_by_section_map(db)
    tokens = exclusive_tokens(lesson, gmap)
    room_id = candidate.get("room_resource_id") or (lesson_rooms(lesson)[0].id if lesson_rooms(lesson) else None)
    if room_id:
        tokens = set(tokens)
        tokens.add(f"room:{room_id}")

    cells = load_availability(db)
    avail = slot_availability(lesson, candidate["day_id"], period_ids, code, cells)
    if avail == STATE_UNAVAILABLE:
        off = []
        for t in lesson_teachers(lesson):
            if any(availability_state(cells, t.id, candidate["day_id"], pid, code) == STATE_UNAVAILABLE for pid in period_ids):
                off.append(f"Staff not available — {t.name or t.id}")
        for r in lesson_rooms(lesson):
            if any(availability_state(cells, r.id, candidate["day_id"], pid, code) == STATE_UNAVAILABLE for pid in period_ids):
                off.append(f"Room not available — {r.name or r.id}")
        for sec in lesson_sections(lesson):
            rid = sec.resource_id
            if rid and any(availability_state(cells, rid, candidate["day_id"], pid, code) == STATE_UNAVAILABLE for pid in period_ids):
                off.append(f"Class not available — {sec.resource.name if sec.resource else sec.id}")
        label = "; ".join(off) if off else "Staff or class not available on this period"
    else:
        label = "Available"
    issues.append({"code": "availability", "ok": avail != STATE_UNAVAILABLE, "label": label, "state": avail})

    from app.services.constraint_presets import relevant_constraints

    constraints = relevant_constraints(db, version)
    blockers = placement_blockers(constraints, lesson, candidate["day_id"], period_ids)
    if blockers:
        issues.append({"code": "constraint", "ok": False, "label": "; ".join(blockers)})
    else:
        issues.append({"code": "constraint", "ok": True, "label": "Staff and class rules ok"})

    q = db.query(models.LessonAllocation).filter_by(version_id=version_id, day_id=candidate["day_id"])
    if ignore_id:
        q = q.filter(models.LessonAllocation.id != ignore_id)
    existing = q.all()

    occupied = set()
    for alloc in existing:
        other = alloc.lesson
        other_code = week_code(other.week_pattern) if other else "ALL"
        other_lanes = week_lanes(other_code)
        if not set(lanes) & set(other_lanes):
            continue
        other_periods = _allocation_cover(db, alloc, teaching)
        if not set(period_ids) & set(other_periods):
            continue
        occupied.update(occupy_keys(exclusive_tokens(other, gmap), alloc.day_id, other_periods, other_lanes))

    proposed = occupy_keys(tokens, candidate["day_id"], period_ids, lanes)
    clash = [k for k in proposed if k in occupied]
    class_hit = any(k[0].startswith("section-whole:") or k[0].startswith("group:") for k in clash)
    teacher_hit = any(k[0].startswith("teacher:") for k in clash)
    room_hit = any(k[0].startswith("room:") for k in clash)

    issues.append({"code": "class", "ok": not class_hit, "label": "Class/group available" if not class_hit else "Class or group occupied"})
    issues.append({"code": "teacher", "ok": not teacher_hit, "label": "Teacher available" if not teacher_hit else "Teacher occupied"})
    room_issue = {"code": "room", "ok": not room_hit, "label": "Room available" if not room_hit else "Room occupied"}
    if room_hit:
        room_issue["alternatives"] = alternative_rooms(db, version_id, candidate["day_id"], candidate["period_id"], room_id)
    issues.append(room_issue)

    # Capacity
    if room_id:
        room = db.query(models.Room).filter_by(resource_id=room_id).first()
        heads = sum(s.student_count or 0 for s in lesson_sections(lesson) if not lesson_groups(lesson))
        if room and heads and heads > (room.capacity or 0):
            issues.append({"code": "capacity", "ok": False, "label": f"Room capacity {room.capacity} < {heads} students"})
        else:
            issues.append({"code": "capacity", "ok": True, "label": "Capacity ok"})
        if lesson.required_room_type and room and room.room_type and room.room_type != lesson.required_room_type:
            issues.append({"code": "room_type", "ok": False, "label": f"Requires {lesson.required_room_type}"})

    # Qualification
    if not lesson.allow_unqualified:
        for tres in lesson_teachers(lesson):
            teacher = db.query(models.Teacher).filter_by(resource_id=tres.id).first()
            if not teacher:
                continue
            quals = [q for q in (teacher.qualifications or []) if q.subject_id == lesson.subject_id]
            if quals and not any(q.qualified for q in quals):
                issues.append({"code": "qualification", "ok": False, "label": f"{tres.name} is not qualified for this subject"})

    return issues


def alternative_rooms(db: Session, version_id: str, day_id: str, period_id: str, exclude: str | None) -> list[dict]:
    occupied = {
        a.room_resource_id
        for a in db.query(models.LessonAllocation).filter_by(version_id=version_id, day_id=day_id, period_id=period_id).all()
        if a.room_resource_id
    }
    rooms = db.query(models.Room).all()
    out = []
    for r in rooms:
        if r.resource_id == exclude:
            continue
        out.append({"id": r.resource_id, "name": r.resource.name if r.resource else r.id, "ok": r.resource_id not in occupied, "capacity": r.capacity, "room_type": r.room_type})
    return out[:8]


def hard_health(db: Session, version_id: str) -> dict:
    version = db.get(models.TimetableVersion, version_id)
    if not version:
        return {"ok": False, "checks": {}}
    teaching = _grid_teaching(db, version.timetable.time_grid_id)
    gmap = groups_by_section_map(db)
    occupied = defaultdict(list)
    allocs = db.query(models.LessonAllocation).filter_by(version_id=version_id).all()
    for a in allocs:
        les = a.lesson
        code = week_code(les.week_pattern) if les else "ALL"
        pids = _allocation_cover(db, a, teaching)
        keys = occupy_keys(exclusive_tokens(les, gmap), a.day_id, pids, week_lanes(code))
        for k in keys:
            occupied[k].append(a.id)

    def dups(prefix):
        return {str(k): v for k, v in occupied.items() if k[0].startswith(prefix) and len(v) > 1}

    lessons = db.query(models.Lesson).filter_by(time_grid_id=version.timetable.time_grid_id).all()
    by_lesson = defaultdict(int)
    for a in allocs:
        by_lesson[a.lesson_id] += 1
    incomplete = []
    for les in lessons:
        if by_lesson[les.id] < les.frequency_per_week:
            incomplete.append({"lesson_id": les.id, "need": les.frequency_per_week, "have": by_lesson[les.id]})

    checks = {
        "teacher_conflicts": dups("teacher:"),
        "class_conflicts": {**dups("section-whole:"), **dups("group:")},
        "room_conflicts": dups("room:"),
        "incomplete_lessons": incomplete,
    }
    ok = not checks["teacher_conflicts"] and not checks["class_conflicts"] and not checks["room_conflicts"] and not incomplete
    return {"ok": ok, "checks": checks}
