"""OR-Tools CP-SAT generator: duration blocks, groups, week lanes, constraint handlers."""

from __future__ import annotations

import random
from collections import Counter, defaultdict

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.handlers import get_handler, placement_forbidden
from app.services.constraint_presets import relevant_constraints
from app.services.day_times import day_payload
from app.engine.occupancy import (
    STATE_AVOID,
    STATE_PREFERRED,
    STATE_UNAVAILABLE,
    allocation_view_fields,
    duration_block,
    exclusive_tokens,
    groups_by_section_map,
    lesson_rooms,
    lesson_teachers,
    load_availability,
    occupy_keys,
    slot_availability,
    teacher_fields,
    teaching_periods,
    valid_starts,
    week_code,
    week_lanes,
)


def _alloc_dict(lesson_id, day_id, period_id, room_id, occ, lock="none", week_pattern_id=None, period_ids=None, week_code_val="ALL"):
    return {
        "lesson_id": lesson_id,
        "day_id": day_id,
        "period_id": period_id,
        "period_ids": period_ids or [period_id],
        "room_resource_id": room_id,
        "occurrence_index": occ,
        "lock_level": lock,
        "week_pattern_id": week_pattern_id,
        "week_code": week_code_val,
    }


def _lesson_query(db: Session):
    return db.query(models.Lesson).options(
        joinedload(models.Lesson.resources),
        joinedload(models.Lesson.subject),
        joinedload(models.Lesson.section).joinedload(models.Section.class_teacher),
        joinedload(models.Lesson.section).joinedload(models.Section.resource),
        joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section).joinedload(models.Section.class_teacher),
        joinedload(models.Lesson.group_links).joinedload(models.LessonGroup.group),
        joinedload(models.Lesson.band_links).joinedload(models.LessonBandMember.band),
        joinedload(models.Lesson.week_pattern),
    )


def _lessons_for_grid(db: Session, grid_id: str) -> list[models.Lesson]:
    return _lesson_query(db).filter_by(time_grid_id=grid_id).all()


def lesson_on_version(les, year_id: str | None, grid_id: str | None) -> bool:
    return bool(grid_id and getattr(les, "time_grid_id", None) == grid_id)


def _lessons_for_version(db: Session, version: models.TimetableVersion) -> list[models.Lesson]:
    grid_id = version.timetable.time_grid_id if version.timetable else None
    if not grid_id:
        return []
    return _lessons_for_grid(db, grid_id)


def _pick_room(lesson: models.Lesson, occupied: set, day_id: str, period_ids: list[str], lanes: list[str], rooms: list[models.Room]) -> str | None:
    assigned = lesson_rooms(lesson)
    if assigned:
        return assigned[0].id
    required_type = lesson.required_room_type
    candidates = []
    for room in rooms:
        if room.resource and room.resource.is_active is False:
            continue
        if required_type and room.room_type and room.room_type != required_type:
            continue
        keys = occupy_keys({f"room:{room.resource_id}"}, day_id, period_ids, lanes)
        if any(k in occupied for k in keys):
            continue
        candidates.append(room)
    if not candidates:
        return None
    sections = []
    try:
        from app.engine.occupancy import lesson_sections

        sections = lesson_sections(lesson)
    except Exception:
        sections = []
    home = next((s.home_room_id for s in sections if s.home_room_id), None)
    if home:
        for c in candidates:
            if c.resource_id == home:
                return home
    return candidates[0].resource_id


class SolverContext:
    def __init__(self, model, lessons, days, teaching, x, var_meta, occupy, db, teachers):
        self.model = model
        self.lessons = lessons
        self.lesson_map = {l.id: l for l in lessons}
        self.days = days
        self.teaching = teaching
        self.x = x
        self.var_meta = var_meta
        self.occupy = occupy
        self.penalties = []
        self.soft_terms = []
        self.assumptions = []
        self.room_of = {}
        self.rooms = []
        self.periods = []
        self.db = db
        self.teachers = teachers
        self.period_index = {p.id: i for i, p in enumerate(teaching)}
        self._seq = 0

    def assume(self, label: str):
        self._seq += 1
        lit = self.model.NewBoolVar(f"asm{self._seq}")
        self.model.AddAssumption(lit)
        self.assumptions.append((lit, label))
        return lit

    def penalize(self, indicator, weight: int, label: str):
        w = max(1, int(weight or 1))
        self.penalties.append(indicator * w)
        self.soft_terms.append((indicator, w, label))


def _generation_context(db: Session, version: models.TimetableVersion) -> dict:
    grid = version.timetable.time_grid_id
    days = db.query(models.Day).filter_by(time_grid_id=grid).order_by(models.Day.sort_order).all()
    periods = db.query(models.Period).filter_by(time_grid_id=grid).order_by(models.Period.sort_order).all()
    return {
        "grid": grid,
        "days": days,
        "periods": periods,
        "teaching": teaching_periods(periods),
        "lessons": _lessons_for_version(db, version),
        "gmap": groups_by_section_map(db),
        "cells": load_availability(db),
        "rooms": db.query(models.Room).options(joinedload(models.Room.resource)).all(),
        "constraints": relevant_constraints(db, version),
        "locked": [a for a in version.allocations if a.lock_level != "none"],
    }


def greedy_generate(db: Session, version: models.TimetableVersion, rng: random.Random, ctx: dict | None = None) -> list[dict]:
    ctx = ctx or _generation_context(db, version)
    days = ctx["days"]
    teaching = ctx["teaching"]
    lessons = ctx["lessons"]
    gmap = ctx["gmap"]
    cells = ctx["cells"]
    rooms = ctx["rooms"]
    constraints = ctx["constraints"]
    locked = ctx["locked"]
    occupied: set = set()
    placements: list[dict] = []

    def consume(lesson, day_id, period_ids, lanes, room_id):
        tokens = exclusive_tokens(lesson, gmap)
        if room_id:
            tokens.add(f"room:{room_id}")
        for k in occupy_keys(tokens, day_id, period_ids, lanes):
            occupied.add(k)

    locked_count = defaultdict(int)
    for a in locked:
        les = a.lesson
        code = week_code(les.week_pattern)
        block = duration_block(teaching, a.period_id, max(1, les.duration_periods or 1))
        pids = [p.id for p in block] if block else [a.period_id]
        rid = a.room_resource_id or (lesson_rooms(les)[0].id if lesson_rooms(les) else None)
        consume(les, a.day_id, pids, week_lanes(code), rid)
        locked_count[a.lesson_id] += 1
        placements.append(_alloc_dict(a.lesson_id, a.day_id, a.period_id, rid, a.occurrence_index, a.lock_level, les.week_pattern_id, pids, code))

    from app.engine.occupancy import (
        lesson_blocks,
        lesson_section_ids,
        max_cards_per_day,
        spans_contiguous,
        subject_section_card_totals,
    )

    period_idx = {p.id: i for i, p in enumerate(teaching)}
    class_used = defaultdict(list)
    lessons_by_id = {row.id: row for row in lessons}
    subject_day = Counter()
    for pl in placements:
        les = lessons_by_id.get(pl["lesson_id"])
        if not les:
            continue
        for sid in lesson_section_ids(les):
            subject_day[(les.subject_id, sid, pl["day_id"])] += 1
            for pid in pl.get("period_ids") or []:
                if pid in period_idx:
                    class_used[(sid, pl["day_id"])].append(period_idx[pid])
    bundle_need = subject_section_card_totals(lessons)
    wanted = set(ctx.get("section_ids") or [])
    starts_by_dur = {}
    day_count = len(days)
    for lesson in sorted(lessons, key=lambda l: (-(l.priority or 50), -(l.duration_periods or 1), -l.frequency_per_week)):
        if wanted and not (set(lesson_section_ids(lesson)) & wanted):
            continue
        blocks = lesson_blocks(lesson)
        placed_n = locked_count.get(lesson.id, 0)
        pending = blocks[placed_n:]
        code = week_code(lesson.week_pattern)
        lanes = week_lanes(code)
        occ = placed_n
        section_ids_here = lesson_section_ids(lesson)
        max_by_section = {
            sid: max_cards_per_day(bundle_need.get((lesson.subject_id, sid), 0), day_count)
            for sid in section_ids_here
        }

        def day_load(day_id: str) -> int:
            return max((subject_day[(lesson.subject_id, sid, day_id)] for sid in section_ids_here), default=0)

        for dur in pending:
            starts = starts_by_dur.setdefault(dur, valid_starts(teaching, dur))
            placed = False
            day_order = list(days)
            rng.shuffle(day_order)
            day_order.sort(key=lambda d: day_load(d.id))
            start_order = list(starts)
            rng.shuffle(start_order)
            for day in day_order:
                if any(subject_day[(lesson.subject_id, sid, day.id)] >= max_by_section[sid] for sid in section_ids_here):
                    continue
                for start in start_order:
                    block = duration_block(teaching, start.id, dur)
                    if not block:
                        continue
                    pids = [p.id for p in block]
                    state = slot_availability(lesson, day.id, pids, code, cells)
                    if state == STATE_UNAVAILABLE:
                        continue
                    if placement_forbidden(constraints, lesson, day.id, pids):
                        continue
                    indexes = [period_idx[pid] for pid in pids if pid in period_idx]
                    if any(not spans_contiguous(class_used[(sid, day.id)] + indexes) for sid in section_ids_here):
                        continue
                    tokens = exclusive_tokens(lesson, gmap)
                    room = _pick_room(lesson, occupied, day.id, pids, lanes, rooms)
                    if room:
                        tokens.add(f"room:{room}")
                    keys = occupy_keys(tokens, day.id, pids, lanes)
                    if any(k in occupied for k in keys):
                        continue
                    consume(lesson, day.id, pids, lanes, room)
                    for sid in section_ids_here:
                        class_used[(sid, day.id)].extend(indexes)
                        subject_day[(lesson.subject_id, sid, day.id)] += 1
                    placements.append(_alloc_dict(lesson.id, day.id, start.id, room, occ, "none", lesson.week_pattern_id, pids, code))
                    occ += 1
                    placed = True
                    break
                if placed:
                    break
            if not placed:
                break
    return placements


def ortools_generate(db: Session, version: models.TimetableVersion, time_limit: float = 8.0, section_ids: list[str] | None = None) -> dict:
    from app.engine.cpsat_solve import solve_cpsat

    return solve_cpsat(db, version, time_limit=time_limit, section_ids=section_ids)


def score_placements(db: Session, version: models.TimetableVersion, placements: list[dict], ctx: dict | None = None) -> dict:
    ctx = ctx or _generation_context(db, version)
    teaching = ctx["teaching"]
    lessons = {l.id: l for l in ctx["lessons"]}
    gmap = ctx["gmap"]
    room_count = max(1, len(ctx["rooms"]))
    period_idx = {p.id: i for i, p in enumerate(teaching)}
    occupied = set()
    hard = 0
    teacher_day_periods = defaultdict(list)

    for pl in placements:
        les = lessons.get(pl["lesson_id"])
        if not les:
            continue
        code = pl.get("week_code") or week_code(les.week_pattern)
        pids = pl.get("period_ids") or [pl["period_id"]]
        tokens = exclusive_tokens(les, gmap)
        if pl.get("room_resource_id"):
            tokens.add(f"room:{pl['room_resource_id']}")
        keys = occupy_keys(tokens, pl["day_id"], pids, week_lanes(code))
        for k in keys:
            if k in occupied:
                hard += 1
            occupied.add(k)
        for t in lesson_teachers(les):
            for pid in pids:
                teacher_day_periods[(t.id, pl["day_id"])].append(period_idx.get(pid, 0))

    gaps = 0
    for (_t, _d), idxs in teacher_day_periods.items():
        idxs = sorted(set(idxs))
        if len(idxs) >= 2:
            gaps += (idxs[-1] - idxs[0] + 1) - len(idxs)

    from app.engine.occupancy import lesson_blocks, lesson_sections, spans_contiguous

    class_day = defaultdict(list)
    for pl in placements:
        les = lessons.get(pl["lesson_id"])
        if not les:
            continue
        pids = pl.get("period_ids") or [pl["period_id"]]
        for section in lesson_sections(les):
            for pid in pids:
                class_day[(section.id, pl["day_id"])].append(period_idx.get(pid, 0))
    student_gaps = 0
    for idxs in class_day.values():
        ordered = sorted(set(idxs))
        if not spans_contiguous(ordered):
            student_gaps += (ordered[-1] - ordered[0] + 1) - len(ordered)

    have = defaultdict(int)
    for pl in placements:
        have[pl["lesson_id"]] += 1
    incomplete = 0
    incomplete_lessons = 0
    for lid, les in lessons.items():
        needed = len(lesson_blocks(les)) or int(les.frequency_per_week or 0)
        missing = max(0, needed - have[lid])
        if missing > 0:
            incomplete += missing
            incomplete_lessons += 1

    rooms_used = len({pl.get("room_resource_id") for pl in placements if pl.get("room_resource_id")})
    util = min(100, int(100 * rooms_used / room_count))
    pref = max(0, 100 - gaps - incomplete * 5)
    if hard:
        pref = max(0, pref - 20)
    return {
        "hard_violations": hard,
        "teacher_gaps": gaps,
        "student_gaps": student_gaps,
        "room_utilization": util,
        "preference_score": round(pref, 1),
        "placed": len(placements),
        "incomplete": incomplete,
        "incomplete_lessons": incomplete_lessons,
    }


def preview_placements(db: Session, version: models.TimetableVersion, placements: list[dict], ctx: dict | None = None) -> dict:
    from app.engine.conflicts import teacher_of

    ctx = ctx or _generation_context(db, version)
    teaching = ctx["teaching"]
    days = ctx["days"]
    periods = ctx["periods"]
    lessons = {l.id: l for l in ctx["lessons"]}
    rooms = {r.resource_id: r for r in ctx["rooms"]}
    allocs = []
    for i, pl in enumerate(placements or []):
        les = lessons.get(pl.get("lesson_id"))
        if not les:
            continue
        t = teacher_of(les)
        dur = max(1, les.duration_periods or 1)
        start_id = pl.get("period_id")
        block = duration_block(teaching, start_id, dur)
        period_ids = pl.get("period_ids") or ([p.id for p in block] if block else [start_id])
        room = rooms.get(pl.get("room_resource_id"))
        base = {
            "id": f"preview-{i}",
            "lesson_id": les.id,
            "day_id": pl.get("day_id"),
            "period_id": start_id,
            "period_ids": period_ids,
            "duration_periods": dur,
            "week_pattern_id": pl.get("week_pattern_id"),
            "room_resource_id": pl.get("room_resource_id"),
            "occurrence_index": pl.get("occurrence_index") or 0,
            "lock_level": pl.get("lock_level") or "none",
            "subject": les.subject.name if les.subject else "",
            "short": (les.subject.short_name if les.subject else "") or "",
            "color": (les.subject.color if les.subject else None) or "#64748b",
            **allocation_view_fields(les),
            **teacher_fields(t),
            "room": room.resource.name if room and room.resource else None,
        }
        for offset, pid in enumerate(period_ids):
            allocs.append({**base, "period_id": pid, "block_offset": offset, "block_start": period_ids[0]})
    return {
        "days": [day_payload(d) for d in days],
        "periods": [
            {
                "id": p.id,
                "name": p.name,
                "sort_order": p.sort_order,
                "period_type": p.period_type,
                "is_teaching": p.period_type == "teaching",
                "start_time": str(p.start_time)[:5] if p.start_time else None,
                "end_time": str(p.end_time)[:5] if p.end_time else None,
            }
            for p in periods
        ],
        "allocations": allocs,
    }


def explain_failure(db: Session, version: models.TimetableVersion) -> dict:
    from app.engine.occupancy import lesson_sections

    lessons = _lessons_for_version(db, version)
    days = db.query(models.Day).filter_by(time_grid_id=version.timetable.time_grid_id).count()
    teaching = teaching_periods(db.query(models.Period).filter_by(time_grid_id=version.timetable.time_grid_id).all())
    facts = []
    fixes = []
    for les in lessons:
        t = lesson_teachers(les)
        secs = lesson_sections(les)
        dur = max(1, les.duration_periods or 1)
        facts.append(
            {
                "lesson_id": les.id,
                "subject": les.subject.name if les.subject else "",
                "section": ", ".join(s.resource.name for s in secs if s.resource) if secs else "",
                "teacher": t[0].name if t else "unassigned",
                "required": les.frequency_per_week,
                "duration": dur,
                "starts_possible": days * max(0, len(teaching) - dur + 1),
            }
        )
        if not t:
            fixes.append(f"Assign a teacher to {les.subject.name if les.subject else les.id}")
        if dur > 1 and len(teaching) < dur:
            fixes.append(f"{les.subject.name if les.subject else les.id} needs {dur} consecutive teaching periods")
    if not facts:
        fixes.append("Create lessons before generating")
    return {
        "summary": "Generation could not place all lessons without hard conflicts",
        "facts": facts[:12],
        "suggested_fixes": fixes[:8]
        or [
            "Relax a TeacherUnavailable constraint",
            "Reduce frequency of an overloaded subject",
            "Add an extra room or teacher",
        ],
    }


def run_generate(db: Session, version_id: str, mode: str = "balanced", progress_cb=None, section_ids: list[str] | None = None) -> dict:
    version = db.get(models.TimetableVersion, version_id)
    if not version:
        return {"error": "version not found"}
    if progress_cb:
        progress_cb(8, "Loading classes and constraints")
    ctx = _generation_context(db, version)
    ctx["section_ids"] = list(section_ids or [])

    solutions = []
    labels = ["A", "B", "C", "D"]
    seeds = [7, 21, 99, 123]
    # fast: 2 greedy. balanced: OR-Tools + 2 greedy. best: longer OR-Tools + 3 greedy.
    n = 2 if mode == "fast" else (3 if mode == "best" else 2)
    use_or = mode != "fast"
    or_limit = 4.0 if mode == "best" else 2.0

    solved = {}
    if use_or:
        if progress_cb:
            progress_cb(15, "Searching solution A")
        solved = ortools_generate(db, version, time_limit=or_limit, section_ids=section_ids)
        placed = solved.get("placements")
        if placed:
            metrics = score_placements(db, version, placed, ctx)
            solutions.append(
                {
                    "label": "A",
                    "score": metrics["preference_score"],
                    "metrics": metrics,
                    "allocations": placed,
                    "explanation": {
                        "engine": "ortools",
                        "broken": solved.get("broken") or [],
                        "preflight": (solved.get("preflight") or [])[:8],
                        "blocked_rules": solved.get("blocked_rules") or [],
                    },
                }
            )
            labels = labels[1:]
            seeds = seeds[1:]
            n = min(n, len(seeds))
        elif solved.get("infeasible"):
            # OR-Tools proved no full solution; still try a few greedy drafts for a partial week.
            n = min(n, 2)

    for i in range(n):
        if progress_cb:
            progress_cb(20 + i * 25, f"Searching solution {labels[i]}")
        placed = greedy_generate(db, version, random.Random(seeds[i]), ctx)
        metrics = score_placements(db, version, placed, ctx)
        solutions.append(
            {
                "label": labels[i],
                "score": metrics["preference_score"],
                "metrics": metrics,
                "allocations": placed,
                "explanation": {"engine": "greedy"},
            }
        )

    solutions.sort(
        key=lambda s: (
            -s["score"],
            s["metrics"]["hard_violations"],
            s["metrics"].get("incomplete_lessons") or s["metrics"].get("incomplete") or 0,
            -s["metrics"]["placed"],
        )
    )
    if progress_cb:
        progress_cb(95, "Scoring")
    tight = (solved.get("preflight") or [])[:8]
    blocked = list(solved.get("blocked_rules") or [])
    has_clash = bool(solutions) and all(s["metrics"]["hard_violations"] > 0 for s in solutions)
    all_empty = bool(solutions) and all(not s.get("allocations") for s in solutions)
    if has_clash or blocked or all_empty:
        fail = explain_failure(db, version)
        if blocked and all_empty:
            fail["summary"] = "Generation is impossible under these rules: " + "; ".join(blocked[:8])
        elif blocked:
            # OR-Tools could not place everything; greedy drafts still exist — do not scream "impossible".
            fail["summary"] = ""
        fail["blocked_rules"] = blocked
        fail["preflight"] = tight
        for s in solutions:
            extra = s.get("explanation") or {}
            if has_clash or all_empty:
                s["explanation"] = {**extra, **fail, "preflight": extra.get("preflight") or tight, "summary": fail.get("summary") or extra.get("summary")}
            else:
                s["explanation"] = {
                    **extra,
                    "blocked_rules": blocked,
                    "preflight": extra.get("preflight") or tight,
                }
        if not solutions and blocked:
            solutions.append(
                {
                    "label": "A",
                    "score": 0,
                    "metrics": {
                        "hard_violations": 0,
                        "teacher_gaps": 0,
                        "student_gaps": 0,
                        "preference_score": 0,
                        "placed": 0,
                        "incomplete": 0,
                        "incomplete_lessons": 0,
                    },
                    "allocations": [],
                    "explanation": fail,
                }
            )
    return {"solutions": solutions}


def apply_allocations(
    db: Session,
    version: models.TimetableVersion,
    placements: list[dict],
    actor: str,
    reason: str,
    pinned_lesson_ids: set[str] | None = None,
):
    pinned = pinned_lesson_ids or set()
    kept = [a for a in list(version.allocations) if a.lock_level != "none" or a.lesson_id in pinned]
    kept_keys = {(a.lesson_id, a.occurrence_index) for a in kept}
    for a in list(version.allocations):
        if a.lock_level == "none":
            db.delete(a)
    db.flush()
    for pl in placements:
        key = (pl["lesson_id"], pl.get("occurrence_index") or 0)
        if key in kept_keys:
            continue
        db.add(
            models.LessonAllocation(
                lesson_id=pl["lesson_id"],
                version_id=version.id,
                day_id=pl["day_id"],
                period_id=pl["period_id"],
                week_pattern_id=pl.get("week_pattern_id"),
                room_resource_id=pl.get("room_resource_id"),
                occurrence_index=pl.get("occurrence_index") or 0,
                lock_level=pl.get("lock_level") or "none",
            )
        )
    db.add(
        models.ChangeEvent(
            entity="timetable_version",
            entity_id=version.id,
            actor=actor,
            reason=reason,
            new_value={"placements": len(placements)},
        )
    )
    db.commit()
