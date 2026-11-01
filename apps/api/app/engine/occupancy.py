"""Resource occupancy: exclusive tokens, week lanes, contiguous duration blocks."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy.orm import Session, joinedload

from app import models
from app.services.time_grids import is_teaching_type

STATE_AVAILABLE = "available"
STATE_UNAVAILABLE = "unavailable"
STATE_PREFERRED = "preferred"
STATE_AVOID = "avoid"


def week_code(pattern: models.WeekPattern | None, pattern_id: str | None = None) -> str:
    if pattern and pattern.code:
        return pattern.code
    return "ALL"


def week_lanes(code: str | None) -> list[str]:
    c = (code or "ALL").upper()
    if c in ("WEEK_A", "A"):
        return ["A"]
    if c in ("WEEK_B", "B"):
        return ["B"]
    return ["A", "B"]


def is_teaching(period) -> bool:
    return is_teaching_type(getattr(period, "period_type", None))


def teaching_periods(periods: list[models.Period]) -> list[models.Period]:
    return [p for p in sorted(periods, key=lambda x: x.sort_order) if is_teaching(p)]


def duration_block(periods: list[models.Period], start_period_id: str, duration: int) -> list[models.Period] | None:
    """Contiguous teaching periods. A break in between blocks a double/triple."""
    dur = max(1, int(duration or 1))
    teachable = [p for p in sorted(periods, key=lambda x: x.sort_order) if is_teaching(p)]
    ids = [p.id for p in teachable]
    try:
        idx = ids.index(start_period_id)
    except ValueError:
        return None
    if idx + dur > len(teachable):
        return None
    block = teachable[idx : idx + dur]
    first, last = block[0].sort_order, block[-1].sort_order
    if last - first + 1 != dur:
        return None
    return block


def valid_starts(periods: list[models.Period], duration: int) -> list[models.Period]:
    return [p for p in sorted(periods, key=lambda x: x.sort_order) if is_teaching(p) and duration_block(periods, p.id, duration)]


def lesson_section_ids(lesson) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    for ls in getattr(lesson, "section_links", None) or []:
        sid = getattr(ls, "section_id", None) or getattr(getattr(ls, "section", None), "id", None)
        if sid and sid not in seen:
            seen.add(sid)
            ids.append(sid)
    if ids:
        return ids
    sid = getattr(lesson, "section_id", None) or getattr(getattr(lesson, "section", None), "id", None)
    return [sid] if sid else []


def lesson_sections(lesson: models.Lesson) -> list[models.Section]:
    linked = [ls.section for ls in (lesson.section_links or []) if ls.section]
    if linked:
        return linked
    if lesson.section:
        return [lesson.section]
    return []


def lesson_covers_section(lesson: models.Lesson, section_id: str) -> bool:
    return any(s.id == section_id for s in lesson_sections(lesson))


def allocation_class_fields(lesson: models.Lesson | None) -> dict:
    """All classes on a joined card, not only lesson.section_id (the first class)."""
    if not lesson:
        return {"section": "", "section_id": None, "section_ids": [], "sections": []}
    secs = lesson_sections(lesson)
    names: list[str] = []
    ids: list[str] = []
    for s in secs:
        ids.append(s.id)
        name = s.resource.name if s.resource else None
        if name and name not in names:
            names.append(name)
    return {
        "section": ", ".join(names),
        "section_id": ids[0] if ids else lesson.section_id,
        "section_ids": ids,
        "sections": names,
    }


def lesson_band(lesson: models.Lesson | None):
    if not lesson:
        return None
    for link in getattr(lesson, "band_links", None) or []:
        if link.band:
            return link.band
    return None


def allocation_view_fields(lesson: models.Lesson | None) -> dict:
    classes = allocation_class_fields(lesson)
    groups = lesson_groups(lesson) if lesson else []
    band = lesson_band(lesson)
    return {
        **classes,
        "joined": len(classes["section_ids"]) > 1,
        "groups": [g.name for g in groups if g],
        "group_ids": [g.id for g in groups if g],
        "band_id": band.id if band else None,
        "band_name": band.name if band else None,
    }


def lesson_groups(lesson: models.Lesson) -> list[models.StudentGroup]:
    linked = [lg.group for lg in (lesson.group_links or []) if lg.group]
    if linked:
        return linked
    if lesson.student_group_id and getattr(lesson, "student_group", None):
        return [lesson.student_group]
    return []


def lesson_teachers(lesson: models.Lesson) -> list[models.Resource]:
    return [lr.resource for lr in lesson.resources if lr.resource and lr.resource.type == "teacher" and lr.role == "required"]


def lesson_rooms(lesson: models.Lesson) -> list[models.Resource]:
    return [lr.resource for lr in lesson.resources if lr.resource and lr.resource.type == "room" and lr.role == "required"]


def exclusive_tokens(lesson: models.Lesson, groups_by_section: dict[str, list[models.StudentGroup]] | None = None) -> set[str]:
    """Tokens that cannot be shared at the same (day, period, week-lane)."""
    tokens: set[str] = set()
    for res in lesson_teachers(lesson):
        tokens.add(f"teacher:{res.id}")
    for res in lesson_rooms(lesson):
        tokens.add(f"room:{res.id}")
    for lr in lesson.resources:
        if lr.resource and lr.resource.type == "equipment" and lr.role == "required":
            tokens.add(f"equipment:{lr.resource_id}")

    groups = lesson_groups(lesson)
    sections = lesson_sections(lesson)
    by_sec = groups_by_section or {}
    # Split groups may share a period only when they belong to a saved period group.
    # Leftover language splits without a band still occupy the whole class.
    if groups and lesson_band(lesson):
        for g in groups:
            tokens.add(f"group:{g.id}")
        return tokens

    sec_ids: list[str] = [sec.id for sec in sections]
    if not sec_ids:
        for g in groups:
            sid = getattr(g, "section_id", None)
            if sid and sid not in sec_ids:
                sec_ids.append(sid)
    for sid in sec_ids:
        tokens.add(f"section-whole:{sid}")
        for g in by_sec.get(sid) or []:
            tokens.add(f"group:{g.id}")
        for sec in sections:
            if sec.id == sid:
                for g in getattr(sec, "groups", []) or []:
                    tokens.add(f"group:{g.id}")
    for g in groups:
        tokens.add(f"group:{g.id}")
    return tokens


def occupy_keys(tokens: set[str], day_id: str, period_ids: list[str], lanes: list[str]) -> list[tuple]:
    keys = []
    for token in tokens:
        for pid in period_ids:
            for lane in lanes:
                keys.append((token, day_id, pid, lane))
    return keys


@dataclass
class Placement:
    lesson_id: str
    day_id: str
    period_id: str
    period_ids: list[str]
    room_resource_id: str | None
    occurrence_index: int
    lock_level: str = "none"
    week_pattern_id: str | None = None
    week_code: str = "ALL"

    def as_dict(self) -> dict:
        return {
            "lesson_id": self.lesson_id,
            "day_id": self.day_id,
            "period_id": self.period_id,
            "period_ids": self.period_ids,
            "room_resource_id": self.room_resource_id,
            "occurrence_index": self.occurrence_index,
            "lock_level": self.lock_level,
            "week_pattern_id": self.week_pattern_id,
            "week_code": self.week_code,
        }


def groups_by_section_map(db: Session) -> dict[str, list[models.StudentGroup]]:
    out: dict[str, list[models.StudentGroup]] = {}
    for g in db.query(models.StudentGroup).all():
        if g.section_id:
            out.setdefault(g.section_id, []).append(g)
    return out


def load_lesson(db: Session, lesson_id: str) -> models.Lesson | None:
    return (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.subject),
            joinedload(models.Lesson.section),
            joinedload(models.Lesson.section_links),
            joinedload(models.Lesson.group_links),
            joinedload(models.Lesson.week_pattern),
        )
        .filter_by(id=lesson_id)
        .first()
    )


def pattern_code_for(db: Session, pattern_id: str | None) -> str:
    if not pattern_id:
        return "ALL"
    row = db.get(models.WeekPattern, pattern_id)
    return row.code if row else "ALL"


def availability_state(cells: dict, resource_id: str, day_id: str, period_id: str, code: str) -> str:
    for key in (
        (resource_id, day_id, period_id, code),
        (resource_id, day_id, period_id, "ALL"),
        (resource_id, day_id, period_id, None),
    ):
        if key in cells:
            return cells[key]
    return STATE_AVAILABLE


def load_availability(db: Session) -> dict:
    cells = {}
    if not hasattr(models, "AvailabilityCell"):
        return cells
    for row in db.query(models.AvailabilityCell).all():
        code = pattern_code_for(db, row.week_pattern_id)
        cells[(row.resource_id, row.day_id, row.period_id, code)] = row.state
        cells[(row.resource_id, row.day_id, row.period_id, None)] = row.state
    return cells


def resource_ids_for_tokens(lesson: models.Lesson) -> list[str]:
    ids = [t.id for t in lesson_teachers(lesson)]
    ids += [r.id for r in lesson_rooms(lesson)]
    for sec in lesson_sections(lesson):
        ids.append(sec.resource_id)
    for g in lesson_groups(lesson):
        ids.append(g.resource_id)
    return [i for i in ids if i]


def slot_availability(lesson: models.Lesson, day_id: str, period_ids: list[str], code: str, cells: dict) -> str:
    """Worst state across consumed resources and periods: unavailable > avoid > preferred > available."""
    rank = {STATE_UNAVAILABLE: 3, STATE_AVOID: 2, STATE_PREFERRED: 1, STATE_AVAILABLE: 0}
    worst = STATE_AVAILABLE
    for rid in resource_ids_for_tokens(lesson):
        for pid in period_ids:
            state = availability_state(cells, rid, day_id, pid, code)
            if rank[state] > rank[worst]:
                worst = state
    return worst
