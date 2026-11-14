"""Constraint handlers: each type owns CP-SAT attachment and explanations."""

from __future__ import annotations

from typing import Any

from app.engine.occupancy import lesson_rooms, lesson_sections, lesson_teachers
from app.services.subjects import normalize_category


class ConstraintHandler:
    code = ""

    def validate_params(self, params: dict | None) -> dict:
        return params or {}

    def explain(self, instance: Any, context: dict | None = None) -> dict:
        return {"summary": f"{self.code} applies", "facts": [], "suggested_fixes": []}

    def applies_to_lesson(self, instance, lesson, ctx) -> bool:
        scope = instance.scope or "global"
        sid = instance.scope_id
        if not sid or scope == "global":
            return True
        if scope == "lesson":
            return lesson.id == sid
        if scope == "teacher":
            return sid in [t.id for t in lesson_teachers(lesson)]
        if scope == "section":
            return sid in [s.id for s in lesson_sections(lesson)] or sid in [s.resource_id for s in lesson_sections(lesson)]
        if scope == "subject":
            return lesson.subject_id == sid
        if scope == "room":
            return sid in [r.id for r in lesson_rooms(lesson)]
        return True

    def apply(self, ctx, instance) -> None:
        return

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        return False


def _weight(instance) -> int:
    return max(1, int(instance.weight or 50))


def _hard(instance) -> bool:
    return (instance.severity or "soft") == "hard"


def _rule_name(instance, fallback: str) -> str:
    code = getattr(instance, "type_code", None) or fallback
    return str(code)


def _assume_hard(ctx, instance, label: str):
    if not _hard(instance):
        return None
    assume = getattr(ctx, "assume", None)
    if not assume:
        return None
    return assume(label)


def _ban(ctx, instance, var, lit, label: str) -> None:
    if lit is not None:
        ctx.model.Add(var == 0).OnlyEnforceIf(lit)
        return
    if _hard(instance):
        ctx.model.Add(var == 0)
        return
    penalize = getattr(ctx, "penalize", None)
    if penalize:
        penalize(var, _weight(instance), label)
    else:
        ctx.penalties.append(var * _weight(instance))


def _cap(ctx, instance, terms, limit: int, label: str, lit) -> None:
    if not terms:
        return
    if lit is not None:
        ctx.model.Add(sum(terms) <= limit).OnlyEnforceIf(lit)
        return
    if _hard(instance):
        ctx.model.Add(sum(terms) <= limit)
        return
    over = ctx.model.NewIntVar(0, max(len(terms), limit, 1), f"over{len(ctx.penalties)}")
    ctx.model.Add(sum(terms) - limit <= over)
    penalize = getattr(ctx, "penalize", None)
    if penalize:
        penalize(over, _weight(instance), label)
    else:
        ctx.penalties.append(over * _weight(instance))


def _slot_hit(instance, day_id, period_ids) -> bool:
    params = instance.params or {}
    slots = params.get("slots") or []
    if slots:
        wanted = {(s.get("day_id"), s.get("period_id")) for s in slots}
        return any((day_id, pid) in wanted for pid in (period_ids or []))
    days = set(params.get("day_ids") or [])
    pers = set(params.get("period_ids") or [])
    if days and day_id not in days:
        return False
    if pers and not (set(period_ids or []) & pers):
        return False
    return True


def _require_days_or_periods(params: dict | None) -> dict:
    p = params or {}
    p["day_ids"] = list(p.get("day_ids") or [])
    p["period_ids"] = list(p.get("period_ids") or [])
    p["slots"] = [{"day_id": s.get("day_id"), "period_id": s.get("period_id")} for s in (p.get("slots") or []) if s.get("day_id") and s.get("period_id")]
    if not p["day_ids"] and not p["period_ids"] and not p["slots"]:
        raise ValueError("Choose at least one day or period.")
    return p


def class_teacher_resource_id(section) -> str | None:
    teacher = getattr(section, "class_teacher", None)
    rid = getattr(teacher, "resource_id", None) if teacher is not None else None
    return rid or None


class UnavailableBase(ConstraintHandler):
    resource_prefix = ""

    def _resource_match(self, instance, lesson, tokens=None) -> bool:
        scope_id = instance.scope_id
        if not self.resource_prefix or not scope_id:
            return True
        if self.resource_prefix == "teacher":
            return scope_id in [t.id for t in lesson_teachers(lesson)]
        if self.resource_prefix == "room":
            return scope_id in [r.id for r in lesson_rooms(lesson)]
        if self.resource_prefix == "section-whole":
            secs = lesson_sections(lesson)
            return scope_id in [s.id for s in secs] or scope_id in [s.resource_id for s in secs]
        if tokens:
            if f"{self.resource_prefix}:{scope_id}" in tokens or scope_id in tokens:
                return True
            if f"section-whole:{scope_id}" in tokens:
                return True
        return False

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        if not self.applies_to_lesson(instance, lesson, None):
            return False
        if not _slot_hit(instance, day_id, period_ids):
            return False
        return self._resource_match(instance, lesson)

    def apply(self, ctx, instance):
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for key, var in list(ctx.x.items()):
            meta = ctx.var_meta[key]
            lesson = ctx.lesson_map[key[0]]
            if not self.applies_to_lesson(instance, lesson, ctx):
                continue
            if not _slot_hit(instance, key[2], meta["period_ids"]):
                continue
            if not self._resource_match(instance, lesson, meta.get("tokens")):
                continue
            _ban(ctx, instance, var, lit, label)


class TeacherUnavailable(UnavailableBase):
    code = "TeacherUnavailable"
    resource_prefix = "teacher"

    def explain(self, instance, context=None):
        return {
            "summary": "Teacher cannot be scheduled in blocked slots",
            "facts": [f"Blocked: {instance.params}"],
            "suggested_fixes": ["Open one blocked period", "Move the lesson"],
        }


class RoomUnavailable(UnavailableBase):
    code = "RoomUnavailable"
    resource_prefix = "room"


class SubjectUnavailable(UnavailableBase):
    code = "SubjectUnavailable"
    resource_prefix = "subject"

    def _resource_match(self, instance, lesson, tokens=None) -> bool:
        scope_id = instance.scope_id
        if not scope_id:
            return True
        return lesson.subject_id == scope_id

    def explain(self, instance, context=None):
        return {
            "summary": "Subject cannot be scheduled in blocked slots",
            "facts": [f"Blocked: {instance.params}"],
            "suggested_fixes": ["Open one blocked period", "Move the lesson"],
        }


class ClassUnavailable(UnavailableBase):
    code = "ClassUnavailable"
    resource_prefix = "section-whole"


class MaxTeacherLessonsPerDay(ConstraintHandler):
    code = "MaxTeacherLessonsPerDay"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("max", 6)
        return p

    def apply(self, ctx, instance):
        mx = int((instance.params or {}).get("max") or 6)
        rid = instance.scope_id
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for day in ctx.days:
            vars_ = []
            for key, var in ctx.x.items():
                les_id, occ, day_id, start_pid = key
                if day_id != day.id:
                    continue
                lesson = ctx.lesson_map[les_id]
                if rid and rid not in [t.id for t in lesson_teachers(lesson)]:
                    continue
                vars_.append(var)
            _cap(ctx, instance, vars_, mx, label, lit)


class MaxConsecutiveLessons(ConstraintHandler):
    code = "MaxConsecutiveLessons"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("max", 3)
        return p

    def apply(self, ctx, instance):
        mx = int((instance.params or {}).get("max") or 3)
        rid = instance.scope_id
        teacher_ids = [rid] if rid else sorted(
            {
                token.split(":", 1)[1]
                for token, *_rest in ctx.occupy
                if isinstance(token, str) and token.startswith("teacher:")
            }
        )
        teaching = ctx.teaching
        win = mx + 1
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for teacher_id in teacher_ids:
            for day in ctx.days:
                for i in range(0, max(0, len(teaching) - mx)):
                    window = teaching[i : i + win]
                    vars_ = []
                    for p in window:
                        for lane in ("A", "B"):
                            vars_.extend(ctx.occupy.get((f"teacher:{teacher_id}", day.id, p.id, lane), []))
                    _cap(ctx, instance, vars_, mx, label, lit)


def _period_bits(ctx, token: str, day_id: str, prefix: str):
    bits = []
    n = len(ctx.teaching)
    for i, period in enumerate(ctx.teaching):
        vlist = []
        for lane in ("A", "B"):
            vlist.extend(ctx.occupy.get((token, day_id, period.id, lane), []))
        bit = ctx.model.NewBoolVar(f"{prefix}_{i}_{n}_{day_id[:4]}")
        if vlist:
            ctx.model.Add(sum(vlist) >= 1).OnlyEnforceIf(bit)
            ctx.model.Add(sum(vlist) == 0).OnlyEnforceIf(bit.Not())
        else:
            ctx.model.Add(bit == 0)
        bits.append(bit)
    return bits


def _window_holes(ctx, bits, prefix: str):
    n = len(bits)
    active = ctx.model.NewBoolVar(f"{prefix}_on")
    ctx.model.Add(sum(bits) >= 1).OnlyEnforceIf(active)
    ctx.model.Add(sum(bits) == 0).OnlyEnforceIf(active.Not())
    last_i = max(0, n - 1)
    first = ctx.model.NewIntVar(0, last_i, f"{prefix}_first")
    last = ctx.model.NewIntVar(0, last_i, f"{prefix}_last")
    for i, bit in enumerate(bits):
        ctx.model.Add(first <= i).OnlyEnforceIf(bit)
        ctx.model.Add(last >= i).OnlyEnforceIf(bit)
    span = ctx.model.NewIntVar(0, n, f"{prefix}_span")
    ctx.model.Add(span == last - first + 1).OnlyEnforceIf(active)
    ctx.model.Add(span == 0).OnlyEnforceIf(active.Not())
    holes = ctx.model.NewIntVar(0, n, f"{prefix}_holes")
    ctx.model.Add(holes == span - sum(bits)).OnlyEnforceIf(active)
    ctx.model.Add(holes == 0).OnlyEnforceIf(active.Not())
    return holes


class MaxTeacherWindows(ConstraintHandler):
    code = "MaxTeacherWindows"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("max", 2)
        return p

    def apply(self, ctx, instance):
        # (last - first + 1) - occupied <= max. Empty days are free.
        rid = instance.scope_id
        mx = int((instance.params or {}).get("max") or 2)
        if not rid:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        n = len(ctx.teaching)
        if n == 0:
            return
        for day in ctx.days:
            tag = f"win{rid[:4]}_{day.id[:4]}"
            bits = _period_bits(ctx, f"teacher:{rid}", day.id, tag)
            holes = _window_holes(ctx, bits, tag)
            _cap(ctx, instance, [holes], mx, label, lit)


class MinTeacherWindows(ConstraintHandler):
    code = "MinTeacherWindows"

    def validate_params(self, params):
        p = params or {}
        if p.get("min") is None and p.get("max") is not None:
            p["min"] = p["max"]
        p.setdefault("min", 1)
        return p

    def apply(self, ctx, instance):
        # Working day (has at least one lesson) must keep at least N holes in the span.
        rid = instance.scope_id
        mn = int((instance.params or {}).get("min") or (instance.params or {}).get("max") or 1)
        if not rid:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        if not ctx.teaching:
            return
        for day in ctx.days:
            tag = f"minwin{rid[:4]}_{day.id[:4]}"
            bits = _period_bits(ctx, f"teacher:{rid}", day.id, tag)
            holes = _window_holes(ctx, bits, tag)
            active = ctx.model.NewBoolVar(f"{tag}_on")
            ctx.model.Add(sum(bits) >= 1).OnlyEnforceIf(active)
            ctx.model.Add(sum(bits) == 0).OnlyEnforceIf(active.Not())
            if lit is not None:
                ctx.model.Add(holes >= mn).OnlyEnforceIf([active, lit])
            elif _hard(instance):
                ctx.model.Add(holes >= mn).OnlyEnforceIf(active)
            else:
                short = ctx.model.NewIntVar(0, max(mn, 1), f"{tag}_short")
                ctx.model.Add(short >= mn - holes).OnlyEnforceIf(active)
                ctx.model.Add(short == 0).OnlyEnforceIf(active.Not())
                if hasattr(ctx, "penalize"):
                    ctx.penalize(short, _weight(instance), label)
                else:
                    ctx.penalties.append(short * _weight(instance))


def _teacher_ids(ctx, instance) -> list[str]:
    rid = instance.scope_id
    if rid:
        return [rid]
    found = set()
    for lesson in ctx.lessons:
        for teacher in lesson_teachers(lesson):
            found.add(teacher.id)
    return sorted(found)


def _day_count(ctx, token: str, day, prefix: str):
    vars_ = []
    for key, var in ctx.x.items():
        if key[2] != day.id:
            continue
        if token in (ctx.var_meta[key].get("tokens") or set()):
            vars_.append(var)
    return vars_


class MaxDaysPerWeek(ConstraintHandler):
    code = "MaxDaysPerWeek"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("max", 5)
        return p

    def apply(self, ctx, instance):
        mx = int((instance.params or {}).get("max") or 5)
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for rid in _teacher_ids(ctx, instance):
            day_on = []
            for day in ctx.days:
                vars_ = _day_count(ctx, f"teacher:{rid}", day, rid)
                if not vars_:
                    continue
                bit = ctx.model.NewBoolVar(f"md{rid[:4]}_{day.id[:4]}")
                ctx.model.Add(sum(vars_) >= 1).OnlyEnforceIf(bit)
                ctx.model.Add(sum(vars_) == 0).OnlyEnforceIf(bit.Not())
                day_on.append(bit)
            _cap(ctx, instance, day_on, mx, label, lit)


class MinLessonsPerDay(ConstraintHandler):
    code = "MinLessonsPerDay"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("min", 2)
        return p

    def apply(self, ctx, instance):
        mn = int((instance.params or {}).get("min") or (instance.params or {}).get("max") or 2)
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for rid in _teacher_ids(ctx, instance):
            for day in ctx.days:
                vars_ = _day_count(ctx, f"teacher:{rid}", day, rid)
                if not vars_:
                    continue
                active = ctx.model.NewBoolVar(f"mind{rid[:4]}_{day.id[:4]}")
                ctx.model.Add(sum(vars_) >= 1).OnlyEnforceIf(active)
                ctx.model.Add(sum(vars_) == 0).OnlyEnforceIf(active.Not())
                if lit is not None or _hard(instance):
                    gate = lit
                    if gate is None:
                        ctx.model.Add(sum(vars_) >= mn).OnlyEnforceIf(active)
                    else:
                        ctx.model.Add(sum(vars_) >= mn).OnlyEnforceIf([active, gate])
                else:
                    short = ctx.model.NewIntVar(0, mn, f"short{rid[:4]}_{day.id[:4]}")
                    ctx.model.Add(short >= mn - sum(vars_)).OnlyEnforceIf(active)
                    ctx.model.Add(short == 0).OnlyEnforceIf(active.Not())
                    ctx.penalize(short, _weight(instance), label) if hasattr(ctx, "penalize") else ctx.penalties.append(short * _weight(instance))


class LunchBreak(ConstraintHandler):
    code = "LunchBreak"

    def apply(self, ctx, instance):
        params = instance.params or {}
        wanted = set(params.get("period_ids") or [])
        if not wanted:
            wanted = _lunch_teaching_ids(ctx)
        if not wanted:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        window = [p for p in ctx.teaching if p.id in wanted]
        if not window:
            return
        for rid in _teacher_ids(ctx, instance):
            for day in ctx.days:
                bits = []
                for period in window:
                    vlist = []
                    for lane in ("A", "B"):
                        vlist.extend(ctx.occupy.get((f"teacher:{rid}", day.id, period.id, lane), []))
                    bit = ctx.model.NewBoolVar(f"lun{rid[:3]}_{day.id[:3]}_{period.sort_order}")
                    if vlist:
                        ctx.model.Add(sum(vlist) >= 1).OnlyEnforceIf(bit)
                        ctx.model.Add(sum(vlist) == 0).OnlyEnforceIf(bit.Not())
                    else:
                        ctx.model.Add(bit == 0)
                    bits.append(bit)
                works = _day_count(ctx, f"teacher:{rid}", day, rid)
                if not works or not bits:
                    continue
                active = ctx.model.NewBoolVar(f"lunon{rid[:3]}_{day.id[:3]}")
                ctx.model.Add(sum(works) >= 1).OnlyEnforceIf(active)
                ctx.model.Add(sum(works) == 0).OnlyEnforceIf(active.Not())
                free = ctx.model.NewIntVar(0, len(bits), f"lunf{rid[:3]}_{day.id[:3]}")
                ctx.model.Add(free == len(bits) - sum(bits))
                if lit is not None:
                    ctx.model.Add(free >= 1).OnlyEnforceIf([active, lit])
                elif _hard(instance):
                    ctx.model.Add(free >= 1).OnlyEnforceIf(active)
                else:
                    miss = ctx.model.NewBoolVar(f"lunm{rid[:3]}_{day.id[:3]}")
                    ctx.model.Add(free == 0).OnlyEnforceIf(miss)
                    ctx.model.Add(free >= 1).OnlyEnforceIf(miss.Not())
                    both = ctx.model.NewBoolVar(f"lunb{rid[:3]}_{day.id[:3]}")
                    ctx.model.AddBoolAnd([active, miss]).OnlyEnforceIf(both)
                    ctx.model.AddBoolOr([active.Not(), miss.Not(), both.Not()])
                    if hasattr(ctx, "penalize"):
                        ctx.penalize(both, _weight(instance), label)
                    else:
                        ctx.penalties.append(both * _weight(instance))


def _lunch_teaching_ids(ctx) -> set[str]:
    periods = getattr(ctx, "periods", None) or []
    lunch = [p for p in periods if (getattr(p, "period_type", "") or "") == "lunch_break"]
    if not lunch:
        return set()
    ids = set()
    teaching = list(ctx.teaching)
    for br in lunch:
        before = [p for p in teaching if p.sort_order < br.sort_order]
        after = [p for p in teaching if p.sort_order > br.sort_order]
        if before:
            ids.add(before[-1].id)
        if after:
            ids.add(after[0].id)
    return ids


class _PeriodBound(ConstraintHandler):
    bound = "start"

    def validate_params(self, params):
        p = params or {}
        if not p.get("period_id") and p.get("period") is None:
            raise ValueError("Choose the period.")
        return p

    def apply(self, ctx, instance):
        params = instance.params or {}
        index = {p.id: i for i, p in enumerate(ctx.teaching)}
        limit = index.get(params.get("period_id"))
        if limit is None and params.get("period") is not None:
            try:
                limit = int(params.get("period")) - 1
            except (TypeError, ValueError):
                limit = None
        if limit is None:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        for rid in _teacher_ids(ctx, instance):
            for key, var in ctx.x.items():
                lesson = ctx.lesson_map[key[0]]
                if rid not in [t.id for t in lesson_teachers(lesson)]:
                    continue
                start = index.get(key[3], 0)
                bad = start < limit if self.bound == "start" else start > limit
                if bad:
                    _ban(ctx, instance, var, lit, label)


class StartAfter(_PeriodBound):
    code = "StartAfter"
    bound = "start"


class EndBefore(_PeriodBound):
    code = "EndBefore"
    bound = "end"


class ContractHours(ConstraintHandler):
    code = "ContractHours"

    def apply(self, ctx, instance):
        rid = instance.scope_id
        params = instance.params or {}
        mx = params.get("max_periods_per_week")
        teacher = None
        if rid:
            teacher = next((t for t in ctx.teachers if t.resource_id == rid), None)
        if mx is None and teacher:
            mx = teacher.contract_max if teacher.contract_max is not None else teacher.contract_periods
        if mx is None:
            return
        mx = int(mx)
        terms = []
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if rid and rid not in [t.id for t in lesson_teachers(lesson)]:
                continue
            dur = max(1, lesson.duration_periods or 1)
            terms.append(var * dur)
        if not terms:
            return
        if _hard(instance):
            ctx.model.Add(sum(terms) <= mx)
        else:
            over = ctx.model.NewIntVar(0, mx * 4, f"cmax_{rid[:8] if rid else 'g'}")
            ctx.model.Add(sum(terms) - mx <= over)
            ctx.penalties.append(over * _weight(instance))


class PreferredPeriod(ConstraintHandler):
    code = "PreferredPeriod"

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        if not _hard(instance):
            return False
        if not self.applies_to_lesson(instance, lesson, None):
            return False
        params = instance.params or {}
        if (params.get("mode") or "prefer") == "avoid":
            return _slot_hit(instance, day_id, period_ids)
        return not _slot_hit(instance, day_id, period_ids)

    def apply(self, ctx, instance):
        params = instance.params or {}
        pids = set(params.get("period_ids") or [])
        mode = params.get("mode") or "prefer"
        if not pids:
            return
        w = _weight(instance)
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if not self.applies_to_lesson(instance, lesson, ctx):
                continue
            covered = set(ctx.var_meta[key]["period_ids"])
            hit = bool(covered & pids)
            if mode == "avoid":
                if hit:
                    if _hard(instance):
                        ctx.model.Add(var == 0)
                    else:
                        ctx.penalties.append(var * w)
            else:
                if not hit:
                    if _hard(instance):
                        ctx.model.Add(var == 0)
                    else:
                        ctx.penalties.append(var * w)


class PreferredDay(ConstraintHandler):
    code = "PreferredDay"

    def apply(self, ctx, instance):
        params = instance.params or {}
        days = set(params.get("day_ids") or [])
        mode = params.get("mode") or "prefer"
        if not days:
            return
        w = _weight(instance)
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if not self.applies_to_lesson(instance, lesson, ctx):
                continue
            day_id = key[2]
            if mode == "avoid":
                if day_id in days:
                    if _hard(instance):
                        ctx.model.Add(var == 0)
                    else:
                        ctx.penalties.append(var * w)
            else:
                if day_id not in days:
                    ctx.penalties.append(var * w)


class PreferredRoom(ConstraintHandler):
    code = "PreferredRoom"

    def apply(self, ctx, instance):
        # Room choice is currently bound on the lesson; penalize if assigned room != preferred.
        pref = (instance.params or {}).get("room_resource_id")
        if not pref:
            return
        w = _weight(instance)
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if not self.applies_to_lesson(instance, lesson, ctx):
                continue
            rooms = [r.id for r in lesson_rooms(lesson)]
            if rooms and pref not in rooms:
                ctx.penalties.append(var * w)


class SameRoom(ConstraintHandler):
    code = "SameRoom"


class DifferentRoom(ConstraintHandler):
    code = "DifferentRoom"

    def apply(self, ctx, instance):
        other = (instance.params or {}).get("other_lesson_id")
        room_of = getattr(ctx, "room_of", None) or {}
        if not other or not room_of:
            return
        a_id = instance.scope_id if instance.scope == "lesson" else None
        if not a_id:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        rooms = sorted({rid for (_key, rid) in room_of})
        shared_flags = []
        for rid in rooms:
            a_vars = [var for (key, room_id), var in room_of.items() if key[0] == a_id and room_id == rid]
            b_vars = [var for (key, room_id), var in room_of.items() if key[0] == other and room_id == rid]
            if not a_vars or not b_vars:
                continue
            a_on = ctx.model.NewBoolVar(f"dra{rid[:4]}")
            b_on = ctx.model.NewBoolVar(f"drb{rid[:4]}")
            ctx.model.Add(sum(a_vars) >= 1).OnlyEnforceIf(a_on)
            ctx.model.Add(sum(a_vars) == 0).OnlyEnforceIf(a_on.Not())
            ctx.model.Add(sum(b_vars) >= 1).OnlyEnforceIf(b_on)
            ctx.model.Add(sum(b_vars) == 0).OnlyEnforceIf(b_on.Not())
            both = ctx.model.NewBoolVar(f"drs{rid[:4]}")
            ctx.model.AddBoolAnd([a_on, b_on]).OnlyEnforceIf(both)
            ctx.model.AddBoolOr([a_on.Not(), b_on.Not(), both.Not()])
            shared_flags.append(both)
        if not shared_flags:
            return
        share = ctx.model.NewBoolVar("drshare")
        ctx.model.Add(sum(shared_flags) >= 1).OnlyEnforceIf(share)
        ctx.model.Add(sum(shared_flags) == 0).OnlyEnforceIf(share.Not())
        if lit is not None:
            ctx.model.Add(share == 0).OnlyEnforceIf(lit)
        elif _hard(instance):
            ctx.model.Add(share == 0)
        elif hasattr(ctx, "penalize"):
            ctx.penalize(share, _weight(instance), label)
        else:
            ctx.penalties.append(share * _weight(instance))


class PairSlotBase(ConstraintHandler):
    def _other_id(self, instance):
        return (instance.params or {}).get("other_lesson_id")

    def _pairs(self, ctx, instance):
        other = self._other_id(instance)
        a = instance.scope_id if instance.scope == "lesson" else None
        if not other or not a:
            return []
        out = []
        for k1, v1 in ctx.x.items():
            if k1[0] != a:
                continue
            for k2, v2 in ctx.x.items():
                if k2[0] != other:
                    continue
                out.append((k1, v1, k2, v2))
        return out


class LessonsTogether(PairSlotBase):
    code = "LessonsTogether"

    def apply(self, ctx, instance):
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        w = _weight(instance)
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            if k1[2] == k2[2]:
                continue
            if lit is not None or _hard(instance):
                clause = ctx.model.AddBoolOr([v1.Not(), v2.Not()])
                if lit is not None:
                    clause.OnlyEnforceIf(lit)
                continue
            both = ctx.model.NewBoolVar(f"tog{id(v1)}_{id(v2)}")
            ctx.model.AddBoolAnd([v1, v2]).OnlyEnforceIf(both)
            ctx.model.AddBoolOr([v1.Not(), v2.Not(), both.Not()])
            if hasattr(ctx, "penalize"):
                ctx.penalize(both, w, label)
            else:
                ctx.penalties.append(both * w)


class LessonsApart(PairSlotBase):
    code = "LessonsApart"

    def apply(self, ctx, instance):
        min_days = int((instance.params or {}).get("min_days") or 1)
        day_idx = {d.id: i for i, d in enumerate(ctx.days)}
        w = _weight(instance)
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            dist = abs(day_idx.get(k1[2], 0) - day_idx.get(k2[2], 0))
            if dist < min_days:
                both = ctx.model.NewBoolVar(f"apt_{k1[1]}_{k2[1]}")
                ctx.model.AddBoolAnd([v1, v2]).OnlyEnforceIf(both)
                ctx.penalties.append(both * w)
                if _hard(instance):
                    ctx.model.AddBoolOr([v1.Not(), v2.Not()])


class SameTime(PairSlotBase):
    code = "SameTime"

    def apply(self, ctx, instance):
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        w = _weight(instance)
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            if k1[3] == k2[3]:
                continue
            if lit is not None or _hard(instance):
                clause = ctx.model.AddBoolOr([v1.Not(), v2.Not()])
                if lit is not None:
                    clause.OnlyEnforceIf(lit)
                continue
            both = ctx.model.NewBoolVar(f"st{id(v1)}_{id(v2)}")
            ctx.model.AddBoolAnd([v1, v2]).OnlyEnforceIf(both)
            ctx.model.AddBoolOr([v1.Not(), v2.Not(), both.Not()])
            if hasattr(ctx, "penalize"):
                ctx.penalize(both, w, label)
            else:
                ctx.penalties.append(both * w)


class DifferentTime(PairSlotBase):
    code = "DifferentTime"

    def apply(self, ctx, instance):
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            if k1[2] == k2[2] and k1[3] == k2[3]:
                ctx.model.AddBoolOr([v1.Not(), v2.Not()])


class Before(PairSlotBase):
    code = "Before"

    def apply(self, ctx, instance):
        day_idx = {d.id: i for i, d in enumerate(ctx.days)}
        pidx = ctx.period_index
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            later = (day_idx.get(k1[2], 0), pidx.get(k1[3], 0)) >= (day_idx.get(k2[2], 0), pidx.get(k2[3], 0))
            if later:
                ctx.model.AddBoolOr([v1.Not(), v2.Not()])


class After(PairSlotBase):
    code = "After"

    def apply(self, ctx, instance):
        day_idx = {d.id: i for i, d in enumerate(ctx.days)}
        pidx = ctx.period_index
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            earlier = (day_idx.get(k1[2], 0), pidx.get(k1[3], 0)) <= (day_idx.get(k2[2], 0), pidx.get(k2[3], 0))
            if earlier:
                ctx.model.AddBoolOr([v1.Not(), v2.Not()])


class Consecutive(PairSlotBase):
    code = "Consecutive"

    def apply(self, ctx, instance):
        pidx = ctx.period_index
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        w = _weight(instance)
        for k1, v1, k2, v2 in self._pairs(ctx, instance):
            same_day = k1[2] == k2[2]
            adj = abs(pidx.get(k1[3], 0) - pidx.get(k2[3], 0)) == 1
            if same_day and adj:
                continue
            if lit is not None or _hard(instance):
                clause = ctx.model.AddBoolOr([v1.Not(), v2.Not()])
                if lit is not None:
                    clause.OnlyEnforceIf(lit)
                continue
            both = ctx.model.NewBoolVar(f"cn{id(v1)}_{id(v2)}")
            ctx.model.AddBoolAnd([v1, v2]).OnlyEnforceIf(both)
            ctx.model.AddBoolOr([v1.Not(), v2.Not(), both.Not()])
            if hasattr(ctx, "penalize"):
                ctx.penalize(both, w, label)
            else:
                ctx.penalties.append(both * w)


class SubjectDistribution(ConstraintHandler):
    code = "SubjectDistribution"

    def apply(self, ctx, instance):
        # Two blocks of the same subject for the same class on one day.
        from app.engine.occupancy import lesson_section_ids

        w = _weight(instance)
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        by_day = {}
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if instance.scope == "subject" and instance.scope_id and lesson.subject_id != instance.scope_id:
                continue
            if instance.scope == "section" and instance.scope_id:
                if instance.scope_id not in lesson_section_ids(lesson):
                    continue
            for sid in lesson_section_ids(lesson) or [""]:
                by_day.setdefault((lesson.subject_id, sid, key[2]), []).append(var)
        for (subject_id, sid, day_id), vars_ in by_day.items():
            if len(vars_) < 2:
                continue
            extra = ctx.model.NewIntVar(0, len(vars_), f"dist_{subject_id[:4]}_{day_id[:4]}")
            ctx.model.Add(sum(vars_) - 1 <= extra)
            if lit is not None:
                ctx.model.Add(extra == 0).OnlyEnforceIf(lit)
            elif _hard(instance):
                ctx.model.Add(extra == 0)
            elif hasattr(ctx, "penalize"):
                ctx.penalize(extra, w, label)
            else:
                ctx.penalties.append(extra * w)


class MaxSubjectPerDay(ConstraintHandler):
    code = "MaxSubjectPerDay"

    def validate_params(self, params):
        p = params or {}
        p.setdefault("max", 1)
        return p

    def apply(self, ctx, instance):
        mx = int((instance.params or {}).get("max") or 1)
        subject_id = instance.scope_id if instance.scope == "subject" else None
        for day in ctx.days:
            vars_ = []
            for key, var in ctx.x.items():
                if key[2] != day.id:
                    continue
                lesson = ctx.lesson_map[key[0]]
                if subject_id and lesson.subject_id != subject_id:
                    continue
                if instance.scope == "section" and instance.scope_id:
                    if instance.scope_id not in [s.id for s in lesson_sections(lesson)]:
                        continue
                vars_.append(var)
            if vars_:
                if _hard(instance):
                    ctx.model.Add(sum(vars_) <= mx)
                else:
                    over = ctx.model.NewIntVar(0, len(vars_), f"msd_{day.id[:6]}")
                    ctx.model.Add(sum(vars_) - mx <= over)
                    ctx.penalties.append(over * _weight(instance))


class ForbidCategoryInPeriods(ConstraintHandler):
    code = "ForbidCategoryInPeriods"

    def validate_params(self, params):
        p = _require_days_or_periods(params)
        raw = (p.get("category") or "").strip()
        category = normalize_category(raw)
        if not raw or category == "other":
            raise ValueError("Choose a subject category (core, language, physical, or activity).")
        p["category"] = category
        return p

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        if not self.applies_to_lesson(instance, lesson, None):
            return False
        category = normalize_category((instance.params or {}).get("category"))
        sub = lesson.subject
        if not sub or normalize_category(sub.category) != category:
            return False
        return _slot_hit(instance, day_id, period_ids)

    def apply(self, ctx, instance):
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if not self.forbids_placement(instance, lesson, key[2], ctx.var_meta[key]["period_ids"]):
                continue
            if _hard(instance):
                ctx.model.Add(var == 0)
            else:
                ctx.penalties.append(var * _weight(instance))


class AvoidConsecutiveDifficult(ConstraintHandler):
    code = "AvoidConsecutiveDifficult"

    def apply(self, ctx, instance):
        ids = set((instance.params or {}).get("subject_ids") or [])
        mx = int((instance.params or {}).get("max_consecutive") or 2)
        difficult = [l for l in ctx.lessons if l.subject and (l.subject.is_difficult or l.subject_id in ids)]
        if not difficult:
            return
        d_ids = {l.id for l in difficult}
        teaching = ctx.teaching
        for day in ctx.days:
            for i in range(0, max(0, len(teaching) - mx)):
                window = teaching[i : i + mx + 1]
                vars_ = []
                for p in window:
                    for key, var in ctx.x.items():
                        if key[0] not in d_ids or key[2] != day.id:
                            continue
                        if p.id in ctx.var_meta[key]["period_ids"]:
                            vars_.append(var)
                if vars_:
                    ctx.model.Add(sum(vars_) <= mx)


class ClassTeacherSlotRule(ConstraintHandler):
    require_class_teacher = True

    def validate_params(self, params):
        return _require_days_or_periods(params)

    def _teacher_ids(self, lesson) -> set[str]:
        return {t.id for t in lesson_teachers(lesson)}

    def _class_teacher_id(self, lesson, instance) -> str | None:
        for sec in lesson_sections(lesson):
            if instance.scope_id and sec.id != instance.scope_id and sec.resource_id != instance.scope_id:
                continue
            rid = class_teacher_resource_id(sec)
            if rid:
                return rid
        return None

    def apply(self, ctx, instance):
        for key, var in ctx.x.items():
            lesson = ctx.lesson_map[key[0]]
            if not self.forbids_placement(instance, lesson, key[2], ctx.var_meta[key]["period_ids"]):
                continue
            if _hard(instance):
                ctx.model.Add(var == 0)
            else:
                ctx.penalties.append(var * _weight(instance))


class ClassTeacherOnlyInPeriods(ClassTeacherSlotRule):
    code = "ClassTeacherOnlyInPeriods"
    require_class_teacher = True

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        if not self.applies_to_lesson(instance, lesson, None):
            return False
        if not _slot_hit(instance, day_id, period_ids):
            return False
        ct = self._class_teacher_id(lesson, instance)
        if not ct:
            return False
        teachers = self._teacher_ids(lesson)
        if not teachers:
            return True
        return any(tid != ct for tid in teachers)


class SameRoomAllWeek(ConstraintHandler):
    code = "SameRoomAllWeek"

    def apply(self, ctx, instance):
        room_of = getattr(ctx, "room_of", None) or {}
        if not room_of:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        lessons = [l for l in ctx.lessons if self.applies_to_lesson(instance, l, ctx)]
        for lesson in lessons:
            by_room: dict[str, list] = {}
            for (key, rid), var in room_of.items():
                if key[0] == lesson.id:
                    by_room.setdefault(rid, []).append(var)
            if len(by_room) < 2:
                continue
            chosen = []
            for rid, vars_ in by_room.items():
                bit = ctx.model.NewBoolVar(f"sr{lesson.id[:4]}_{rid[:4]}")
                ctx.model.Add(sum(vars_) >= 1).OnlyEnforceIf(bit)
                ctx.model.Add(sum(vars_) == 0).OnlyEnforceIf(bit.Not())
                chosen.append(bit)
            if lit is not None:
                ctx.model.Add(sum(chosen) <= 1).OnlyEnforceIf(lit)
            elif _hard(instance):
                ctx.model.Add(sum(chosen) <= 1)
            else:
                extra = ctx.model.NewIntVar(0, len(chosen), f"sre{lesson.id[:4]}")
                ctx.model.Add(sum(chosen) - 1 <= extra)
                if hasattr(ctx, "penalize"):
                    ctx.penalize(extra, _weight(instance), label)
                else:
                    ctx.penalties.append(extra * _weight(instance))


class _RoomTypeCount(ConstraintHandler):
    sense = "min"

    def validate_params(self, params):
        p = params or {}
        if not (p.get("room_type") or "").strip():
            raise ValueError("Choose a room type.")
        p["room_type"] = str(p["room_type"]).strip()
        p["min"] = int(p.get("min") or p.get("max") or 1)
        p["max"] = int(p.get("max") or p.get("min") or 1)
        return p

    def apply(self, ctx, instance):
        room_of = getattr(ctx, "room_of", None) or {}
        rooms = {r.resource_id: r for r in (getattr(ctx, "rooms", None) or [])}
        want = ((instance.params or {}).get("room_type") or "").strip()
        if not room_of or not want:
            return
        label = _rule_name(instance, self.code)
        lit = _assume_hard(ctx, instance, label)
        limit = int((instance.params or {}).get("min" if self.sense == "min" else "max") or 1)
        for lesson in [l for l in ctx.lessons if self.applies_to_lesson(instance, l, ctx)]:
            vars_ = []
            for (key, rid), var in room_of.items():
                if key[0] != lesson.id:
                    continue
                room = rooms.get(rid)
                if room and (room.room_type or "") == want:
                    vars_.append(var)
            if not vars_:
                continue
            if self.sense == "max":
                _cap(ctx, instance, vars_, limit, label, lit)
                continue
            if lit is not None:
                ctx.model.Add(sum(vars_) >= limit).OnlyEnforceIf(lit)
            elif _hard(instance):
                ctx.model.Add(sum(vars_) >= limit)
            else:
                short = ctx.model.NewIntVar(0, limit, f"rt{lesson.id[:4]}")
                ctx.model.Add(short >= limit - sum(vars_))
                if hasattr(ctx, "penalize"):
                    ctx.penalize(short, _weight(instance), label)
                else:
                    ctx.penalties.append(short * _weight(instance))


class MinRoomTypeUses(_RoomTypeCount):
    code = "MinRoomTypeUses"
    sense = "min"


class MaxRoomTypeUses(_RoomTypeCount):
    code = "MaxRoomTypeUses"
    sense = "max"


class NotClassTeacherInPeriods(ClassTeacherSlotRule):
    code = "NotClassTeacherInPeriods"
    require_class_teacher = False

    def forbids_placement(self, instance, lesson, day_id, period_ids) -> bool:
        if not self.applies_to_lesson(instance, lesson, None):
            return False
        if not _slot_hit(instance, day_id, period_ids):
            return False
        ct = self._class_teacher_id(lesson, instance)
        if not ct:
            return False
        return ct in self._teacher_ids(lesson)


HANDLERS: dict[str, ConstraintHandler] = {
    cls.code: cls()
    for cls in [
        TeacherUnavailable,
        RoomUnavailable,
        SubjectUnavailable,
        ClassUnavailable,
        MaxTeacherLessonsPerDay,
        MaxDaysPerWeek,
        MinLessonsPerDay,
        LunchBreak,
        StartAfter,
        EndBefore,
        MaxConsecutiveLessons,
        MaxTeacherWindows,
        MinTeacherWindows,
        ContractHours,
        PreferredPeriod,
        PreferredDay,
        PreferredRoom,
        SameRoom,
        SameRoomAllWeek,
        MinRoomTypeUses,
        MaxRoomTypeUses,
        DifferentRoom,
        LessonsTogether,
        LessonsApart,
        SameTime,
        DifferentTime,
        Before,
        After,
        Consecutive,
        SubjectDistribution,
        MaxSubjectPerDay,
        AvoidConsecutiveDifficult,
        ForbidCategoryInPeriods,
        ClassTeacherOnlyInPeriods,
        NotClassTeacherInPeriods,
    ]
}


def get_handler(code: str) -> ConstraintHandler:
    return HANDLERS.get(code) or ConstraintHandler()


CATEGORY_RULE_LABELS = {
    "core": "No core (NOCP)",
    "language": "No language (NOSL)",
    "physical": "No PE (NOPA)",
    "activity": "No activity",
}

RULE_LABELS = {
    "TeacherUnavailable": "Staff not available",
    "RoomUnavailable": "Room not available",
    "ClassUnavailable": "Class not available",
    "ClassTeacherOnlyInPeriods": "Class teacher only (CTON)",
    "NotClassTeacherInPeriods": "Not class teacher (NCTON)",
}


def _resource_name(res) -> str:
    return (getattr(res, "name", None) or "").strip()


def constraint_block_label(instance, lesson) -> str:
    code = getattr(instance, "type_code", "") or ""
    if code == "ForbidCategoryInPeriods":
        cat = normalize_category((getattr(instance, "params", None) or {}).get("category"))
        base = CATEGORY_RULE_LABELS.get(cat, f"No {cat or 'category'}")
        sub = getattr(getattr(lesson, "subject", None), "name", None)
        return f"{base} — {sub} cannot sit in this period" if sub else base
    if code == "ClassTeacherOnlyInPeriods":
        who = next((_resource_name(t) for t in lesson_teachers(lesson) if _resource_name(t)), "")
        return f"Class teacher only (CTON) — {who} is not the class teacher" if who else RULE_LABELS[code]
    if code == "NotClassTeacherInPeriods":
        who = next((_resource_name(t) for t in lesson_teachers(lesson) if _resource_name(t)), "")
        return f"Not class teacher (NCTON) — {who} is the class teacher" if who else RULE_LABELS[code]
    if code == "TeacherUnavailable":
        wanted = getattr(instance, "scope_id", None)
        who = next((_resource_name(t) or t.id for t in lesson_teachers(lesson) if t.id == wanted), "")
        if not who:
            who = next((_resource_name(t) for t in lesson_teachers(lesson) if _resource_name(t)), "")
        return f"Staff not available — {who}" if who else RULE_LABELS[code]
    if code == "ClassUnavailable":
        secs = lesson_sections(lesson)
        name = next((s.resource.name for s in secs if getattr(s, "resource", None) and s.resource.name), "")
        return f"Class not available — {name}" if name else RULE_LABELS[code]
    if code == "RoomUnavailable":
        rooms = lesson_rooms(lesson)
        name = next((_resource_name(r) for r in rooms if _resource_name(r)), "")
        return f"Room not available — {name}" if name else RULE_LABELS[code]
    return RULE_LABELS.get(code) or f"Blocked by {code}"


def placement_blockers(constraints, lesson, day_id, period_ids) -> list[str]:
    labels = []
    for c in constraints or []:
        if not getattr(c, "enabled", True):
            continue
        if (getattr(c, "severity", None) or "soft") != "hard":
            continue
        if get_handler(c.type_code).forbids_placement(c, lesson, day_id, period_ids):
            labels.append(constraint_block_label(c, lesson))
    return labels


def placement_forbidden(constraints, lesson, day_id, period_ids) -> bool:
    return bool(placement_blockers(constraints, lesson, day_id, period_ids))
