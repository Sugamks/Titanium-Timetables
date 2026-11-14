"""CP-SAT build: assumptions, rooms, class holes, blocks, and a pinned class slice."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.handlers import get_handler
from app.engine.occupancy import (
    STATE_AVOID,
    STATE_UNAVAILABLE,
    duration_block,
    exclusive_tokens,
    groups_by_section_map,
    lesson_blocks,
    lesson_rooms,
    lesson_section_ids,
    lesson_sections,
    lesson_teachers,
    load_availability,
    max_cards_per_day,
    occupy_keys,
    subject_section_card_totals,
    slot_availability,
    teaching_periods,
    valid_starts,
    week_code,
    week_lanes,
)
from app.services.constraint_presets import relevant_constraints


def _empty(reason: str = "") -> dict:
    return {
        "placements": None,
        "broken": [],
        "blocked_rules": [],
        "preflight": [],
        "infeasible": False,
        "error": reason,
    }


def _name(row) -> str:
    resource = getattr(row, "resource", None)
    if resource and resource.name:
        return resource.name
    return getattr(row, "name", None) or "item"


def allowed_room_ids(lesson, rooms: list[models.Room]) -> list[str]:
    pinned = [r.id for r in lesson_rooms(lesson)]
    if pinned:
        return pinned
    custom = [rid for rid in (getattr(lesson, "allowed_room_ids", None) or []) if rid]
    if custom:
        return custom
    homes = [s.home_room_id for s in lesson_sections(lesson) if getattr(s, "home_room_id", None)]
    need = (lesson.required_room_type or "").strip()
    live = [r for r in rooms if not r.resource or r.resource.is_active is not False]
    typed = [r.resource_id for r in live if need and (r.room_type or "") == need]
    pool: list[str] = []
    for rid in homes + typed:
        if rid and rid not in pool:
            pool.append(rid)
    if pool:
        return pool
    return [r.resource_id for r in live][:12]


def _fits(room: models.Room | None, lesson) -> bool:
    if room is None:
        return False
    heads = max((s.student_count or 0) for s in lesson_sections(lesson)) if lesson_sections(lesson) else 0
    if heads and (room.capacity or 0) < heads:
        return False
    need = (lesson.required_room_type or "").strip()
    if need and room.room_type and room.room_type != need and room.resource_id not in (getattr(lesson, "allowed_room_ids", None) or []):
        if room.resource_id not in [s.home_room_id for s in lesson_sections(lesson)]:
            return False
    return True


def room_blocked(constraints, room_id: str, day_id: str, period_ids: list[str]) -> bool:
    from app.engine.handlers import _slot_hit

    for row in constraints:
        if getattr(row, "type_code", "") != "RoomUnavailable" or not getattr(row, "enabled", True):
            continue
        if row.scope_id != room_id:
            continue
        if _slot_hit(row, day_id, period_ids):
            return True
    return False


def preflight(db: Session, lessons, days, teaching, constraints) -> list[dict]:
    from app.engine.handlers import _slot_hit

    slots = max(1, len(days) * len(teaching))
    rows = []

    def unavailable(code: str, scope_id: str, day_id: str, period_id: str) -> bool:
        for row in constraints:
            if row.type_code != code or not getattr(row, "enabled", True):
                continue
            if row.scope_id and row.scope_id != scope_id:
                continue
            if _slot_hit(row, day_id, [period_id]):
                return True
        return False

    teachers: dict[str, str] = {}
    classes: dict[str, str] = {}
    demand_t: dict[str, int] = defaultdict(int)
    demand_c: dict[str, int] = defaultdict(int)
    for lesson in lessons:
        need = sum(lesson_blocks(lesson))
        for teacher in lesson_teachers(lesson):
            teachers[teacher.id] = teacher.name
            demand_t[teacher.id] += need
        for section in lesson_sections(lesson):
            classes[section.id] = _name(section)
            demand_c[section.id] += need
    for tid, name in teachers.items():
        free = 0
        for day in days:
            for period in teaching:
                if not unavailable("TeacherUnavailable", tid, day.id, period.id):
                    free += 1
        rows.append({"kind": "teacher", "name": name, "demand": demand_t[tid], "free": free, "slack": free - demand_t[tid]})
    for sid, name in classes.items():
        free = slots
        for day in days:
            for period in teaching:
                if unavailable("ClassUnavailable", sid, day.id, period.id):
                    free -= 1
        rows.append({"kind": "class", "name": name, "demand": demand_c[sid], "free": free, "slack": free - demand_c[sid]})
    rooms = db.query(models.Room).options(joinedload(models.Room.resource)).all()
    for room in rooms:
        only = 0
        for lesson in lessons:
            choices = allowed_room_ids(lesson, rooms)
            if choices == [room.resource_id]:
                only += sum(lesson_blocks(lesson))
        free = 0
        for day in days:
            for period in teaching:
                if not room_blocked(constraints, room.resource_id, day.id, [period.id]):
                    free += 1
        if only:
            rows.append({"kind": "room", "name": _name(room), "demand": only, "free": free, "slack": free - only})
    rows.sort(key=lambda row: (row["slack"], row["kind"], row["name"]))
    return rows


def _in_slice(lesson, section_ids: set[str] | None) -> bool:
    if not section_ids:
        return True
    return bool(set(lesson_section_ids(lesson)) & section_ids)


def solve_cpsat(db: Session, version: models.TimetableVersion, time_limit: float = 8.0, section_ids: list[str] | None = None) -> dict:
    try:
        from ortools.sat.python import cp_model
    except ImportError:
        return _empty("OR-Tools is not installed")

    from app.engine.solver import SolverContext, _alloc_dict

    grid = version.timetable.time_grid_id
    days = db.query(models.Day).filter_by(time_grid_id=grid).order_by(models.Day.sort_order).all()
    periods = db.query(models.Period).filter_by(time_grid_id=grid).order_by(models.Period.sort_order).all()
    teaching = teaching_periods(periods)
    lessons = (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.subject),
            joinedload(models.Lesson.section),
            joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section),
            joinedload(models.Lesson.group_links),
            joinedload(models.Lesson.band_links),
            joinedload(models.Lesson.week_pattern),
        )
        .filter_by(time_grid_id=grid)
        .all()
    )
    if not lessons or not days or not teaching:
        return _empty("Add lessons, days, and teaching periods first")
    gmap = groups_by_section_map(db)
    cells = load_availability(db)
    rooms = db.query(models.Room).options(joinedload(models.Room.resource)).all()
    room_by_id = {r.resource_id: r for r in rooms}
    teachers = db.query(models.Teacher).all()
    constraints = [c for c in relevant_constraints(db, version) if getattr(c, "enabled", True)]
    report = preflight(db, lessons, days, teaching, constraints)
    wanted = set(section_ids or [])
    pinned = {les.id for les in lessons if wanted and not _in_slice(les, wanted)}
    place_lits = []

    model = cp_model.CpModel()
    x = {}
    var_meta = {}
    occupy = defaultdict(list)
    day_name = {d.id: d.name for d in days}
    period_name = {p.id: p.name for p in periods}

    def add_var(les, occ, day, start, pids, lanes, tokens, code, fixed=False):
        key = (les.id, occ, day.id, start.id)
        if key in x:
            return key
        var = model.NewBoolVar(f"x{len(x)}")
        x[key] = var
        var_meta[key] = {"period_ids": pids, "tokens": tokens, "lanes": lanes, "code": code}
        state = slot_availability(les, day.id, pids, code, cells)
        if state == STATE_UNAVAILABLE and not fixed:
            model.Add(var == 0)
        for cell in occupy_keys(tokens, day.id, pids, lanes):
            occupy[cell].append(var)
        return key

    for les in lessons:
        blocks = lesson_blocks(les)
        if les.id in pinned:
            continue
        code = week_code(les.week_pattern)
        lanes = week_lanes(code)
        tokens = {tok for tok in exclusive_tokens(les, gmap) if not tok.startswith("room:")}
        subject = les.subject.name if les.subject else "lesson"
        section = ", ".join(_name(s) for s in lesson_sections(les)) or "class"
        lit = model.NewBoolVar(f"place{les.id[:8]}")
        model.AddAssumption(lit)
        place_label = f"Place {subject} for {section}"
        place_lits.append((lit, place_label))
        for occ, dur in enumerate(blocks):
            starts = valid_starts(teaching, dur)
            vars_ = []
            for day in days:
                for start in starts:
                    block = duration_block(teaching, start.id, dur)
                    if not block:
                        continue
                    pids = [p.id for p in block]
                    key = add_var(les, occ, day, start, pids, lanes, tokens, code)
                    vars_.append(x[key])
            if vars_:
                model.Add(sum(vars_) == 1).OnlyEnforceIf(lit)
            else:
                model.Add(lit == 0)

    # Cap by subject+class (not lesson id) so Dance 2+3 cannot both land same day when total ≤ days.
    bundle_need = subject_section_card_totals(lessons)
    lesson_by_id = {les.id: les for les in lessons}
    bundle_vars: dict[tuple[str, str, str], list] = defaultdict(list)
    for key, var in x.items():
        les = lesson_by_id.get(key[0])
        if not les or les.id in pinned:
            continue
        day_id = key[2]
        for sid in lesson_section_ids(les):
            bundle_vars[(les.subject_id, sid, day_id)].append(var)
    for (subj, sid, _day_id), vars_ in bundle_vars.items():
        max_pd = max_cards_per_day(bundle_need.get((subj, sid), 0), len(days))
        if len(vars_) > max_pd:
            model.Add(sum(vars_) <= max_pd)

    for allocation in version.allocations:
        les = allocation.lesson
        if not les:
            continue
        keep = les.id in pinned or allocation.lock_level != "none"
        if not keep:
            continue
        blocks = lesson_blocks(les)
        occ = min(allocation.occurrence_index or 0, max(0, len(blocks) - 1))
        dur = blocks[occ] if blocks else 1
        code = week_code(les.week_pattern)
        lanes = week_lanes(code)
        tokens = {tok for tok in exclusive_tokens(les, gmap) if not tok.startswith("room:")}
        day = next((d for d in days if d.id == allocation.day_id), None)
        start = next((p for p in teaching if p.id == allocation.period_id), None)
        if not day or not start:
            continue
        block = duration_block(teaching, start.id, dur) or [start]
        key = add_var(les, occ, day, start, [p.id for p in block], lanes, tokens, code, fixed=True)
        model.Add(x[key] == 1)

    ctx = SolverContext(model, lessons, days, teaching, x, var_meta, occupy, db, teachers)
    ctx.rooms = rooms
    ctx.periods = periods
    ctx.assumptions.extend(place_lits)

    for cell, vars_ in list(occupy.items()):
        if len(vars_) < 2:
            continue
        token, day_id, period_id, _lane = cell
        who = token.split(":", 1)[-1]
        label = f"{who} on {day_name.get(day_id, 'day')} {period_name.get(period_id, 'period')}"
        lit = ctx.assume(label)
        model.Add(sum(vars_) <= 1).OnlyEnforceIf(lit)

    # One room bool per placement. Exactly one allowed room. Rooms do not clash.
    room_occupy = defaultdict(list)
    for key, var in x.items():
        les = ctx.lesson_map[key[0]]
        meta = var_meta[key]
        choices = [rid for rid in allowed_room_ids(les, rooms) if _fits(room_by_id.get(rid), les)]
        choices = [rid for rid in choices if not room_blocked(constraints, rid, key[2], meta["period_ids"])]
        if not choices:
            choices = allowed_room_ids(les, rooms)[:1]
        rvars = []
        for rid in choices:
            rvar = model.NewBoolVar(f"r{len(ctx.room_of)}")
            ctx.room_of[(key, rid)] = rvar
            rvars.append(rvar)
            for cell in occupy_keys({f"room:{rid}"}, key[2], meta["period_ids"], meta["lanes"]):
                room_occupy[cell].append(rvar)
        if rvars:
            model.Add(sum(rvars) == var)
            home = next((s.home_room_id for s in lesson_sections(les) if s.home_room_id), None)
            if home and home in choices and (key, home) in ctx.room_of:
                away = model.NewBoolVar(f"home{len(ctx.room_of)}")
                model.Add(away >= var - ctx.room_of[(key, home)])
                ctx.penalize(away, 3, f"Prefer home room for {_name(lesson_sections(les)[0]) if lesson_sections(les) else 'class'}")

    for cell, vars_ in room_occupy.items():
        if len(vars_) < 2:
            continue
        token, day_id, period_id, _lane = cell
        room = room_by_id.get(token.split(":", 1)[-1])
        label = f"{_name(room) if room else 'Room'} on {day_name.get(day_id, 'day')} {period_name.get(period_id, 'period')}"
        lit = ctx.assume(label)
        model.Add(sum(vars_) <= 1).OnlyEnforceIf(lit)

    # No holes in a class day.
    pindex = {p.id: i for i, p in enumerate(teaching)}
    by_class_day = defaultdict(lambda: defaultdict(list))
    for key, var in x.items():
        meta = var_meta[key]
        for sid in lesson_section_ids(ctx.lesson_map[key[0]]):
            for pid in meta["period_ids"]:
                if pid in pindex:
                    by_class_day[(sid, key[2])][pindex[pid]].append(var)
    class_names = {s.id: _name(s) for les in lessons for s in lesson_sections(les)}
    for (sid, day_id), columns in by_class_day.items():
        bits = []
        for i in range(len(teaching)):
            vlist = columns.get(i) or []
            bit = model.NewBoolVar(f"gap{sid[:4]}_{day_id[:4]}_{i}")
            if vlist:
                model.Add(sum(vlist) >= 1).OnlyEnforceIf(bit)
                model.Add(sum(vlist) == 0).OnlyEnforceIf(bit.Not())
            else:
                model.Add(bit == 0)
            bits.append(bit)
        lit = ctx.assume(f"No holes in {class_names.get(sid, 'class')} on {day_name.get(day_id, 'day')}")
        n = len(bits)
        for i in range(n):
            for k in range(i + 2, n):
                for j in range(i + 1, k):
                    model.Add(bits[i] + bits[k] <= 1 + bits[j]).OnlyEnforceIf(lit)

    tindex = {p.id: i for i, p in enumerate(teaching)}
    building_of = {r.resource_id: (r.building or "") for r in rooms}

    def _span(meta):
        idxs = [tindex[pid] for pid in meta["period_ids"] if pid in tindex]
        return (min(idxs), max(idxs)) if idxs else None

    grouped = defaultdict(list)
    for key in x:
        meta = var_meta[key]
        span = _span(meta)
        if not span:
            continue
        for sid in lesson_section_ids(ctx.lesson_map[key[0]]):
            grouped[("class", sid, key[2])].append((span, key))
        for res in lesson_teachers(ctx.lesson_map[key[0]]):
            grouped[("teacher", res.id, key[2])].append((span, key))
    for (kind, _who, _day), rows in grouped.items():
        rows = sorted(rows, key=lambda item: item[0][0])
        for (span_a, key_a), (span_b, key_b) in zip(rows, rows[1:]):
            if span_b[0] != span_a[1] + 1:
                continue
            rooms_a = [rid for (k, rid) in ctx.room_of if k == key_a]
            rooms_b = [rid for (k, rid) in ctx.room_of if k == key_b]
            if len(rooms_a) > 6 or len(rooms_b) > 6:
                continue
            for rid_a in rooms_a:
                for rid_b in rooms_b:
                    if rid_a == rid_b:
                        continue
                    if kind == "teacher" and building_of.get(rid_a, "") == building_of.get(rid_b, ""):
                        continue
                    changed = model.NewBoolVar(f"mv{len(ctx.soft_terms)}")
                    model.AddBoolAnd([ctx.room_of[(key_a, rid_a)], ctx.room_of[(key_b, rid_b)]]).OnlyEnforceIf(changed)
                    model.AddBoolOr([
                        ctx.room_of[(key_a, rid_a)].Not(),
                        ctx.room_of[(key_b, rid_b)].Not(),
                        changed,
                    ])
                    label = "Class changes room" if kind == "class" else "Teacher changes building"
                    ctx.penalize(changed, 4, label)

    for row in constraints:
        get_handler(row.type_code).apply(ctx, row)

    for key, var in x.items():
        meta = var_meta[key]
        state = slot_availability(ctx.lesson_map[key[0]], key[2], meta["period_ids"], meta["code"], cells)
        if state == STATE_AVOID:
            ctx.penalize(var, 40, "Avoid slot")
    if teaching:
        for key, var in x.items():
            if key[3] == teaching[0].id or key[3] == teaching[-1].id:
                ctx.penalize(var, 2, "Edge period")

    if ctx.penalties:
        model.Minimize(sum(ctx.penalties))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 2
    status = solver.Solve(model)
    feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    blocked = []
    if not feasible:
        try:
            core = {lit.Index() for lit in solver.SufficientAssumptionsForInfeasibility()}
        except Exception:
            core = set()
        blocked = [label for lit, label in ctx.assumptions if lit.Index() in core]
        if not blocked:
            blocked = [label for _lit, label in ctx.assumptions[:12]]
        return {
            "placements": None,
            "broken": [],
            "blocked_rules": blocked,
            "preflight": report,
            "infeasible": status == cp_model.INFEASIBLE,
            "error": "",
        }

    broken = []
    seen = set()
    for var, weight, label in ctx.soft_terms:
        if not label or label in seen:
            continue
        try:
            amount = solver.Value(var)
        except Exception:
            amount = 0
        if amount:
            seen.add(label)
            broken.append({"label": label, "weight": weight, "amount": int(amount)})
    broken.sort(key=lambda row: (-row["weight"], row["label"]))

    placements = []
    for les in lessons:
        code = week_code(les.week_pattern)
        blocks = lesson_blocks(les)
        occ_n = 0
        for occ in range(len(blocks)):
            for day in days:
                for start in teaching:
                    key = (les.id, occ, day.id, start.id)
                    if key not in x or not solver.Value(x[key]):
                        continue
                    pids = var_meta[key]["period_ids"]
                    room_id = None
                    for (rkey, rid), rvar in ctx.room_of.items():
                        if rkey == key and solver.Value(rvar):
                            room_id = rid
                            break
                    lock = "none"
                    placements.append(
                        _alloc_dict(les.id, day.id, start.id, room_id, occ_n, lock, les.week_pattern_id, pids, code)
                    )
                    occ_n += 1
    return {
        "placements": placements,
        "broken": broken,
        "blocked_rules": [],
        "preflight": report,
        "infeasible": False,
        "error": "",
    }
