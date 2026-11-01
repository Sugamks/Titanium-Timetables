import re
from datetime import datetime, time, timedelta

from sqlalchemy.orm import Session

from app import models

WEEKDAYS = [
    (0, "Monday"),
    (1, "Tuesday"),
    (2, "Wednesday"),
    (3, "Thursday"),
    (4, "Friday"),
    (5, "Saturday"),
    (6, "Sunday"),
]


def weekday_list(include_saturday: bool = False, include_sunday: bool = False) -> list[tuple[int, str]]:
    days = list(WEEKDAYS[:5])
    if include_saturday:
        days.append(WEEKDAYS[5])
    if include_sunday:
        days.append(WEEKDAYS[6])
    return days


def as_time(val) -> time | None:
    if val is None or val == "":
        return None
    if isinstance(val, time):
        return val
    if isinstance(val, datetime):
        return val.time()
    if isinstance(val, timedelta):
        total = int(val.total_seconds()) % (24 * 3600)
        hours, rem = divmod(total, 3600)
        minutes, seconds = divmod(rem, 60)
        return time(hours, minutes, seconds)
    text = str(val).strip()
    if not text:
        return None
    parts = text.split(":")
    try:
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
        seconds = int(float(parts[2])) if len(parts) > 2 else 0
        return time(hours % 24, minutes % 60, seconds % 60)
    except (TypeError, ValueError):
        return None


DEFAULT_DURATIONS = {
    "lunch_break": 40,
    "short_break": 15,
    "prayer_break": 20,
    "break": 15,
    "assembly": 20,
    "all_teachers": 40,
    "teaching": 40,
}


def time_to_minutes(val: time | None) -> int | None:
    if val is None:
        return None
    return val.hour * 60 + val.minute


def minutes_to_time(total: int) -> time:
    total = min(max(int(total), 0), 23 * 60 + 59)
    return time(total // 60, total % 60)


def add_minutes(val: time | None, minutes: int) -> time | None:
    base = time_to_minutes(val)
    if base is None:
        return None
    return minutes_to_time(base + minutes)


def period_duration_minutes(period) -> int:
    start = time_to_minutes(getattr(period, "start_time", None))
    end = time_to_minutes(getattr(period, "end_time", None))
    if start is None or end is None or end <= start:
        ptype = getattr(period, "period_type", None) or TEACHING_TYPE
        return DEFAULT_DURATIONS.get(ptype, 40)
    return end - start


def cascade_forward(periods: list, from_index: int = 0) -> None:
    """Each later period starts when the previous one ends, keeping its own length."""
    ordered = sorted(periods, key=lambda p: p.sort_order)
    start_at = max(0, int(from_index))
    for i in range(start_at, len(ordered) - 1):
        prev = ordered[i]
        nxt = ordered[i + 1]
        if prev.end_time is None:
            continue
        dur = period_duration_minutes(nxt)
        nxt.start_time = prev.end_time
        nxt.end_time = add_minutes(nxt.start_time, dur)


def apply_period_time_change(db: Session, period: models.Period, start: time | None = None, end: time | None = None) -> None:
    if start is not None:
        dur = period_duration_minutes(period)
        period.start_time = start
        if end is None:
            period.end_time = add_minutes(start, dur)
    if end is not None:
        period.end_time = end
        start_m = time_to_minutes(period.start_time)
        end_m = time_to_minutes(period.end_time)
        if start_m is not None and end_m is not None and end_m <= start_m:
            period.end_time = add_minutes(period.start_time, 5)
    siblings = (
        db.query(models.Period)
        .filter_by(time_grid_id=period.time_grid_id)
        .order_by(models.Period.sort_order)
        .all()
    )
    idx = next((i for i, p in enumerate(siblings) if p.id == period.id), 0)
    cascade_forward(siblings, idx)


TEACHING_TYPE = "teaching"
BREAK_TYPES = ("lunch_break", "short_break", "prayer_break", "break")
NON_TEACHING_TYPES = set(BREAK_TYPES) | {"assembly"}
ALLOWED_PERIOD_TYPES = (TEACHING_TYPE,) + BREAK_TYPES + ("assembly", "all_teachers")

BREAK_LABELS = {
    "lunch_break": "Lunch Break",
    "short_break": "Short Break",
    "prayer_break": "Prayer Break",
    "break": "Break",
    "assembly": "Assembly",
    "all_teachers": "All teachers",
    "teaching": "Teaching",
}

DEFAULT_BREAK_NAMES = {
    "lunch_break": "Lunch Break",
    "short_break": "Short Break",
    "prayer_break": "Prayer Break",
    "assembly": "Assembly",
}

AUTO_PERIOD_NAME = re.compile(r"^(p|period)\s*\d+$", re.I)


def is_teaching_type(ptype: str | None) -> bool:
    return (ptype or TEACHING_TYPE) == TEACHING_TYPE


def teaching_display_name(n: int) -> str:
    return f"Period {n}"


def is_auto_period_name(name: str | None) -> bool:
    text = (name or "").strip()
    return not text or bool(AUTO_PERIOD_NAME.match(text)) or text in BREAK_LABELS.values() or text in DEFAULT_BREAK_NAMES.values()


def renumber_teaching_names(periods: list) -> bool:
    """Number teaching slots only: Period 1, Period 2. Breaks keep type labels."""
    changed = False
    n = 0
    for p in sorted(periods, key=lambda x: x.sort_order):
        if is_teaching_type(p.period_type):
            n += 1
            nxt = teaching_display_name(n)
            if is_auto_period_name(p.name) and p.name != nxt:
                p.name = nxt
                changed = True
        else:
            nxt = BREAK_LABELS.get(p.period_type) or p.name
            if is_auto_period_name(p.name) and nxt and p.name != nxt:
                p.name = nxt
                changed = True
    return changed


def break_label(ptype: str | None) -> str:
    return BREAK_LABELS.get(ptype or TEACHING_TYPE, ptype or "Period")


def period_type(short_name: str | None, long_name: str | None) -> str:
    short = (short_name or "").strip().lower()
    blob = f"{short} {(long_name or '').strip().lower()}".strip()
    if short in ("pb", "prayer") or "prayer" in blob:
        return "prayer_break"
    if short in ("lb", "lunch") or "lunch" in blob:
        return "lunch_break"
    if short in ("sb", "br", "break") or any(token in blob for token in ("short break", "recess", "tea break")):
        return "short_break"
    if "break" in blob:
        return "short_break"
    if "assembly" in blob:
        return "assembly"
    return "teaching"


def default_period_specs(count: int) -> list[dict]:
    specs: list[dict] = []
    start_minutes = 8 * 60
    for i in range(max(1, count)):
        begin = start_minutes + i * 40
        end = begin + 40
        specs.append(
            {
                "name": teaching_display_name(i + 1),
                "sort_order": i + 1,
                "start_time": time((begin // 60) % 24, begin % 60),
                "end_time": time((end // 60) % 24, end % 60),
                "period_type": "teaching",
            }
        )
    return specs


def ensure_days(db: Session, grid: models.TimeGrid, days: list[tuple[int, str]]) -> int:
    existing = {d.weekday: d for d in grid.days}
    created = 0
    for i, (weekday, name) in enumerate(days):
        row = existing.get(weekday)
        if row:
            row.name = name
            row.sort_order = i
            continue
        db.add(models.Day(time_grid_id=grid.id, name=name, weekday=weekday, sort_order=i))
        created += 1
    return created


def ensure_periods(db: Session, grid: models.TimeGrid, specs: list[dict]) -> tuple[int, int]:
    by_order = {p.sort_order: p for p in grid.periods}
    created = 0
    updated = 0
    for spec in specs:
        order = int(spec["sort_order"])
        row = by_order.get(order)
        if row:
            row.name = spec["name"]
            row.start_time = spec.get("start_time")
            row.end_time = spec.get("end_time")
            row.period_type = spec.get("period_type") or "teaching"
            updated += 1
            continue
        db.add(
            models.Period(
                time_grid_id=grid.id,
                name=spec["name"],
                sort_order=order,
                start_time=spec.get("start_time"),
                end_time=spec.get("end_time"),
                period_type=spec.get("period_type") or "teaching",
            )
        )
        created += 1
    return created, updated


def insert_period(
    db: Session,
    grid: models.TimeGrid,
    *,
    name: str,
    period_type_code: str,
    after_period_id: str | None = None,
    start_time: time | None = None,
    end_time: time | None = None,
) -> models.Period:
    periods = sorted(grid.periods, key=lambda p: p.sort_order)
    if after_period_id:
        after = next((p for p in periods if p.id == after_period_id), None)
        if not after:
            raise ValueError("Period not found on this template")
        new_order = after.sort_order + 1
        if start_time is None:
            start_time = after.end_time
    else:
        new_order = (periods[-1].sort_order + 1) if periods else 1
    for p in periods:
        if p.sort_order >= new_order:
            p.sort_order += 1
    row = models.Period(
        time_grid_id=grid.id,
        name=name,
        sort_order=new_order,
        start_time=start_time,
        end_time=end_time,
        period_type=period_type_code,
    )
    db.add(row)
    db.flush()
    if row.start_time and not row.end_time:
        row.end_time = add_minutes(row.start_time, DEFAULT_DURATIONS.get(period_type_code, 40))
    siblings = (
        db.query(models.Period)
        .filter_by(time_grid_id=grid.id)
        .order_by(models.Period.sort_order)
        .all()
    )
    idx = next((i for i, p in enumerate(siblings) if p.id == row.id), 0)
    cascade_forward(siblings, idx)
    renumber_teaching_names(siblings)
    return row


def delete_period(db: Session, period: models.Period) -> None:
    grid_id = period.time_grid_id
    order = period.sort_order
    db.delete(period)
    db.flush()
    later = db.query(models.Period).filter(models.Period.time_grid_id == grid_id, models.Period.sort_order > order).all()
    for p in later:
        p.sort_order -= 1
    db.flush()
    leftover = (
        db.query(models.Period)
        .filter_by(time_grid_id=grid_id)
        .order_by(models.Period.sort_order)
        .all()
    )
    renumber_teaching_names(leftover)


def set_teaching_period_count(db: Session, grid: models.TimeGrid, count: int) -> tuple[int, int]:
    """Add or remove teaching periods so the grid has `count` teaching slots. Breaks stay."""
    target = max(1, min(20, int(count)))
    added = 0
    removed = 0
    while True:
        periods = (
            db.query(models.Period)
            .filter_by(time_grid_id=grid.id)
            .order_by(models.Period.sort_order)
            .all()
        )
        teaching = [p for p in periods if is_teaching_type(p.period_type)]
        n = len(teaching)
        if n == target:
            break
        if n < target:
            last_any = periods[-1] if periods else None
            insert_period(
                db,
                grid,
                name=teaching_display_name(n + 1),
                period_type_code=TEACHING_TYPE,
                after_period_id=last_any.id if last_any else None,
            )
            added += 1
            db.flush()
            db.refresh(grid)
            continue
        last = teaching[-1]
        if db.query(models.LessonAllocation).filter_by(period_id=last.id).first():
            raise ValueError(f"{last.name} has lessons placed on it. Remove those first.")
        delete_period(db, last)
        removed += 1
        db.flush()
        db.refresh(grid)
    leftover = (
        db.query(models.Period)
        .filter_by(time_grid_id=grid.id)
        .order_by(models.Period.sort_order)
        .all()
    )
    renumber_teaching_names(leftover)
    return added, removed


def ensure_draft(db: Session, timetable: models.Timetable, created_by: str | None = None) -> None:
    if timetable.versions:
        return
    db.add(
        models.TimetableVersion(
            timetable_id=timetable.id,
            number=1,
            status="draft",
            label="Draft 1",
            created_by=created_by,
        )
    )


def create_grid(
    db: Session,
    name: str,
    academic_year_id: str | None,
    days: list[tuple[int, str]],
    period_specs: list[dict],
    is_active: bool = True,
) -> models.TimeGrid:
    grid = models.TimeGrid(
        name=name,
        academic_year_id=academic_year_id,
        is_active=is_active,
    )
    db.add(grid)
    db.flush()
    ensure_days(db, grid, days)
    if period_specs:
        ensure_periods(db, grid, period_specs)
    db.flush()
    return grid
