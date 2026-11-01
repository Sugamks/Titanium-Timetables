from datetime import date, datetime, time, timedelta
from typing import Iterable

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.occupancy import allocation_class_fields, is_teaching, lesson_teachers

DAILY_CAP = 1
WEEKLY_CAP = 3
MONTHLY_CAP = 12
DAY_START = time(7, 30)
MIDDAY = time(12, 0)
DAY_END = time(17, 0)


def published_version(db: Session) -> models.TimetableVersion | None:
    return (
        db.query(models.TimetableVersion)
        .filter(models.TimetableVersion.status.in_(("published", "saved", "approved")))
        .order_by(models.TimetableVersion.published_at.desc())
        .first()
    )


def usable_version(
    db: Session,
    version_id: str | None = None,
    timetable_id: str | None = None,
) -> models.TimetableVersion | None:
    if version_id:
        row = db.get(models.TimetableVersion, version_id)
        if row:
            return row
    if timetable_id:
        tt = db.get(models.Timetable, timetable_id)
        if tt and not tt.deleted_at:
            versions = list(tt.versions or [])
            live = [v for v in versions if v.status in ("published", "saved", "approved")]
            pool = live or versions
            if pool:
                return max(pool, key=lambda v: (v.published_at or v.created_at, v.number))
        return None
    return published_version(db) or (
        db.query(models.TimetableVersion).order_by(models.TimetableVersion.created_at.desc()).first()
    )


def teacher_teaches_on_day(version, teacher, grid_day_id: str | None) -> bool:
    if not version or not teacher or not grid_day_id:
        return False
    for alloc in getattr(version, "allocations", None) or []:
        if getattr(alloc, "day_id", None) != grid_day_id:
            continue
        if lesson_has_teacher(getattr(alloc, "lesson", None), teacher):
            return True
    return False


def absentees_for_template(absentees: list[dict], version, teachers: dict, grid_day_id: str | None) -> list[dict]:
    visible = []
    for row in absentees:
        source = (row.get("source") or "").lower()
        if row.get("covers") or source in ("attendance", "adhoc"):
            visible.append(row)
            continue
        teacher = teachers.get(row.get("teacher_id"))
        if teacher_teaches_on_day(version, teacher, grid_day_id):
            visible.append(row)
    return visible


def absence_window(row: models.Absence) -> tuple[time, time]:
    if row.time_in and row.time_out:
        return row.time_in, row.time_out
    kind = (row.leave_for or "fullday").lower()
    if kind == "morning":
        return DAY_START, MIDDAY
    if kind == "noon":
        return MIDDAY, DAY_END
    return DAY_START, DAY_END


def apply_leave_window(row: models.Absence) -> None:
    start, end = absence_window(row)
    row.time_in = start
    row.time_out = end


def _as_time(value) -> time | None:
    if value is None:
        return None
    if isinstance(value, time):
        return value
    if isinstance(value, datetime):
        return value.time()
    text = str(value)
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            continue
    return None


def period_in_window(period: models.Period | None, start: time, end: time) -> bool:
    if not period or not is_teaching(period):
        return False
    p_start = _as_time(period.start_time)
    p_end = _as_time(period.end_time)
    if p_start is None and p_end is None:
        return True
    p_start = p_start or time(0, 0)
    p_end = p_end or time(23, 59)
    return p_start >= start and p_end <= end


def grid_day_for(db: Session, version: models.TimetableVersion, on_date: date) -> models.Day | None:
    days = db.query(models.Day).filter_by(time_grid_id=version.timetable.time_grid_id).all()
    return next((d for d in days if d.weekday == on_date.weekday()), None)


def teacher_name(teacher: models.Teacher | None) -> str:
    if not teacher:
        return ""
    if teacher.resource and teacher.resource.name:
        return teacher.resource.name
    return teacher.id


def lesson_has_teacher(lesson: models.Lesson | None, teacher: models.Teacher) -> bool:
    if not lesson:
        return False
    return any(res.id == teacher.resource_id for res in lesson_teachers(lesson))


def cover_ids(cover: models.SubstitutionCover) -> list[str]:
    raw = cover.cover_teacher_ids if isinstance(cover.cover_teacher_ids, list) else []
    ids = [str(x) for x in raw if x]
    if cover.cover_teacher_id and cover.cover_teacher_id not in ids:
        ids.insert(0, cover.cover_teacher_id)
    return ids


def touch_cover(cover: models.SubstitutionCover, user: dict | None, action: str, note: str | None = None) -> None:
    now = datetime.utcnow()
    cover.updated_at = now
    cover.updated_by = (user or {}).get("name") or (user or {}).get("sub")
    if note:
        cover.action_note = note
    elif action != "ignored":
        cover.action_note = None
    expl = dict(cover.explanation or {})
    expl.update(
        {
            "action": action,
            "at": now.isoformat(timespec="seconds"),
            "by": cover.updated_by,
            "note": cover.action_note,
        }
    )
    cover.explanation = expl


def set_cover_teachers(cover: models.SubstitutionCover, teacher_ids: Iterable[str] | None) -> None:
    ids = [str(x) for x in (teacher_ids or []) if x]
    cover.cover_teacher_ids = ids
    cover.cover_teacher_id = ids[0] if ids else None
    if cover.status != "ignored":
        cover.status = "covered" if ids else "pending"


def exemption_active(ex: models.Exemption, on_date: date) -> bool:
    if ex.from_date and on_date < ex.from_date:
        return False
    if ex.to_date and on_date > ex.to_date:
        return False
    return True


def week_bounds(on_date: date) -> tuple[date, date]:
    start = on_date - timedelta(days=on_date.weekday())
    return start, start + timedelta(days=6)


def month_bounds(on_date: date) -> tuple[date, date]:
    start = on_date.replace(day=1)
    if start.month == 12:
        nxt = start.replace(year=start.year + 1, month=1)
    else:
        nxt = start.replace(month=start.month + 1)
    return start, nxt - timedelta(days=1)


def ensure_day(db: Session, on_date: date, version: models.TimetableVersion) -> models.SubstitutionDay:
    day = (
        db.query(models.SubstitutionDay)
        .filter_by(on_date=on_date, based_on_version_id=version.id)
        .first()
    )
    if day:
        return day
    day = models.SubstitutionDay(on_date=on_date, based_on_version_id=version.id, status="draft")
    db.add(day)
    db.commit()
    db.refresh(day)
    return day


def seed_covers_for_absence(db: Session, day: models.SubstitutionDay, version: models.TimetableVersion, absence: models.Absence) -> int:
    teacher = absence.teacher or db.get(models.Teacher, absence.teacher_id)
    if not teacher:
        return 0
    grid_day = grid_day_for(db, version, day.on_date)
    if not grid_day:
        return 0
    start, end = absence_window(absence)
    added = 0
    existing = {(c.allocation_id, c.absent_teacher_id) for c in day.covers}
    for alloc in version.allocations:
        if alloc.day_id != grid_day.id:
            continue
        if not lesson_has_teacher(alloc.lesson, teacher):
            continue
        period = db.get(models.Period, alloc.period_id)
        if not period_in_window(period, start, end):
            continue
        key = (alloc.id, teacher.id)
        if key in existing:
            continue
        db.add(
            models.SubstitutionCover(
                substitution_day_id=day.id,
                absence_id=absence.id,
                allocation_id=alloc.id,
                day_id=alloc.day_id,
                period_id=alloc.period_id,
                absent_teacher_id=teacher.id,
                cover_teacher_ids=[],
                status="pending",
            )
        )
        existing.add(key)
        added += 1
    if added:
        db.commit()
        db.refresh(day)
    return added


def seed_day(db: Session, day: models.SubstitutionDay) -> int:
    version = db.get(models.TimetableVersion, day.based_on_version_id)
    if not version:
        return 0
    total = 0
    absences = db.query(models.Absence).filter_by(on_date=day.on_date).all()
    for absence in absences:
        apply_leave_window(absence)
        total += seed_covers_for_absence(db, day, version, absence)
    return total


def remove_absence(db: Session, absence: models.Absence, clear_covers: bool = True) -> None:
    if clear_covers:
        covers = (
            db.query(models.SubstitutionCover)
            .filter(
                models.SubstitutionCover.absent_teacher_id == absence.teacher_id,
            )
            .all()
        )
        days = {c.substitution_day_id for c in covers}
        for sid in days:
            day = db.get(models.SubstitutionDay, sid)
            if day and day.on_date == absence.on_date:
                for cover in list(day.covers):
                    if cover.absent_teacher_id == absence.teacher_id:
                        db.delete(cover)
    db.delete(absence)
    db.commit()


def _teacher_id_for_resource(db: Session, resource_id: str, cache: dict[str, str]) -> str | None:
    if resource_id in cache:
        return cache[resource_id]
    teacher = db.query(models.Teacher).filter_by(resource_id=resource_id).first()
    cache[resource_id] = teacher.id if teacher else ""
    return teacher.id if teacher else None


def busy_teachers_on_slot(db: Session, version: models.TimetableVersion, day_id: str, period_id: str) -> set[str]:
    cache: dict[str, str] = {}
    busy: set[str] = set()
    for alloc in version.allocations:
        if alloc.day_id != day_id or alloc.period_id != period_id:
            continue
        for res in lesson_teachers(alloc.lesson):
            tid = _teacher_id_for_resource(db, res.id, cache)
            if tid:
                busy.add(tid)
    return busy


def cover_counts(db: Session, on_date: date) -> dict[str, dict[str, int]]:
    week_start, week_end = week_bounds(on_date)
    month_start, month_end = month_bounds(on_date)
    days = db.query(models.SubstitutionDay).filter(models.SubstitutionDay.on_date >= month_start, models.SubstitutionDay.on_date <= month_end).all()
    out: dict[str, dict[str, int]] = {}
    for day in days:
        for cover in day.covers:
            if cover.status == "ignored":
                continue
            for tid in cover_ids(cover):
                bucket = out.setdefault(tid, {"daily": 0, "weekly": 0, "monthly": 0})
                bucket["monthly"] += 1
                if week_start <= day.on_date <= week_end:
                    bucket["weekly"] += 1
                if day.on_date == on_date:
                    bucket["daily"] += 1
    return out


def covers_on_slot(db: Session, day: models.SubstitutionDay, period_id: str) -> set[str]:
    busy: set[str] = set()
    for cover in day.covers:
        if cover.period_id != period_id or cover.status == "ignored":
            continue
        busy.update(cover_ids(cover))
    return busy


def score_candidates(
    db: Session,
    version: models.TimetableVersion,
    allocation: models.LessonAllocation,
    absent_teacher: models.Teacher,
    on_date: date | None = None,
    day: models.SubstitutionDay | None = None,
    section_id: str | None = None,
) -> list[dict]:
    when = on_date or (day.on_date if day else date.today())
    lesson = allocation.lesson
    subject_name = lesson.subject.name if lesson and lesson.subject else ""
    class_ids = set(allocation_class_fields(lesson).get("section_ids") or [])
    busy = busy_teachers_on_slot(db, version, allocation.day_id, allocation.period_id)
    if day:
        busy |= covers_on_slot(db, day, allocation.period_id)
    absences = {a.teacher_id for a in db.query(models.Absence).filter_by(on_date=when).all()}
    exemptions = [e for e in db.query(models.Exemption).all() if exemption_active(e, when)]
    ex_map = {e.teacher_id: e for e in exemptions}
    loads = cover_counts(db, when)
    subject_teachers: set[str] = set()
    class_teachers: set[str] = set()
    id_cache: dict[str, str] = {}
    for les in db.query(models.Lesson).options(joinedload(models.Lesson.resources), joinedload(models.Lesson.section_links)).all():
        teachers = []
        for res in lesson_teachers(les):
            tid = _teacher_id_for_resource(db, res.id, id_cache)
            if tid:
                teachers.append(tid)
        if les.subject and les.subject.name == subject_name:
            subject_teachers.update(teachers)
        sec_ids = {s.id for s in (ls.section for ls in (les.section_links or []) if ls.section)}
        if les.section_id:
            sec_ids.add(les.section_id)
        if class_ids & sec_ids:
            class_teachers.update(teachers)

    out = []
    for t in db.query(models.Teacher).all():
        if t.id == absent_teacher.id:
            continue
        if section_id and class_teachers and t.id not in class_teachers:
            # keep them, but mark them after the class filter load
            pass
        reasons = []
        score = 50
        blocked = False
        free = t.id not in busy
        if free:
            score += 25
            reasons.append({"ok": True, "text": "Free this period"})
        else:
            score -= 40
            blocked = True
            reasons.append({"ok": False, "text": "Busy this period"})
        if t.id in absences:
            score -= 50
            blocked = True
            reasons.append({"ok": False, "text": "Absent today"})
        ex = ex_map.get(t.id)
        if ex:
            score -= 30 if ex.kind == "full" else 10
            if ex.kind == "full":
                blocked = True
            reasons.append({"ok": False, "text": f"Exemption ({ex.kind})"})
        else:
            reasons.append({"ok": True, "text": "No exemption"})
        same_dept = bool(t.department and absent_teacher.department and t.department == absent_teacher.department)
        if same_dept:
            score += 10
            reasons.append({"ok": True, "text": "Same department"})
        else:
            reasons.append({"ok": False, "text": "Different department"})
        if t.id in subject_teachers:
            score += 15
            reasons.append({"ok": True, "text": "Same subject"})
        else:
            reasons.append({"ok": False, "text": "Different subject"})
        if t.id in class_teachers:
            score += 8
            reasons.append({"ok": True, "text": "Teaches this class"})
        load = loads.get(t.id, {"daily": 0, "weekly": 0, "monthly": 0})
        if load["daily"] >= DAILY_CAP:
            score -= 20
            blocked = True
            reasons.append({"ok": False, "text": f"Daily cap {load['daily']}/{DAILY_CAP}"})
        else:
            reasons.append({"ok": True, "text": f"Daily {load['daily']}/{DAILY_CAP}"})
        if load["weekly"] >= WEEKLY_CAP:
            score -= 15
            blocked = True
            reasons.append({"ok": False, "text": f"Weekly cap {load['weekly']}/{WEEKLY_CAP}"})
        else:
            reasons.append({"ok": True, "text": f"Weekly {load['weekly']}/{WEEKLY_CAP}"})
        if load["monthly"] >= MONTHLY_CAP:
            score -= 15
            blocked = True
            reasons.append({"ok": False, "text": f"Monthly cap {load['monthly']}/{MONTHLY_CAP}"})
        else:
            reasons.append({"ok": True, "text": f"Monthly {load['monthly']}/{MONTHLY_CAP}"})
        out.append(
            {
                "teacher_id": t.id,
                "name": teacher_name(t),
                "department": t.department or "",
                "score": max(0, min(100, score)),
                "blocked": blocked,
                "free": free,
                "same_subject": t.id in subject_teachers,
                "same_department": same_dept,
                "teaches_class": t.id in class_teachers,
                "daily": load["daily"],
                "weekly": load["weekly"],
                "monthly": load["monthly"],
                "daily_cap": DAILY_CAP,
                "weekly_cap": WEEKLY_CAP,
                "monthly_cap": MONTHLY_CAP,
                "reasons": reasons,
            }
        )
    out.sort(key=lambda r: (r["blocked"], -r["score"], r["name"]))
    return out


def serialize_cover(db: Session, cover: models.SubstitutionCover, teachers: dict[str, str], periods: dict[str, models.Period], days: dict[str, str]) -> dict:
    alloc = db.get(models.LessonAllocation, cover.allocation_id) if cover.allocation_id else None
    les = alloc.lesson if alloc else None
    period = periods.get(cover.period_id)
    classes = allocation_class_fields(les)
    ids = cover_ids(cover)
    return {
        "id": cover.id,
        "absence_id": cover.absence_id,
        "allocation_id": cover.allocation_id,
        "period_id": cover.period_id,
        "period": period.name if period else "",
        "start_time": period.start_time.strftime("%H:%M") if period and period.start_time else "",
        "end_time": period.end_time.strftime("%H:%M") if period and period.end_time else "",
        "day_id": cover.day_id,
        "day": days.get(cover.day_id) or "",
        "subject": les.subject.name if les and les.subject else "",
        "short": (les.subject.short_name or les.subject.name) if les and les.subject else "",
        "color": (les.subject.color if les and les.subject else None) or "#64748b",
        "section": classes.get("section") or "",
        "section_ids": classes.get("section_ids") or [],
        "absent_teacher_id": cover.absent_teacher_id,
        "absent_teacher": teachers.get(cover.absent_teacher_id) or "",
        "cover_teacher_id": cover.cover_teacher_id,
        "cover_teacher": teachers.get(cover.cover_teacher_id) if cover.cover_teacher_id else "",
        "cover_teacher_ids": ids,
        "cover_teachers": [teachers.get(tid) or tid for tid in ids],
        "status": cover.status,
        "score": cover.score,
        "explanation": cover.explanation,
        "updated_at": cover.updated_at.isoformat(timespec="minutes") if cover.updated_at else None,
        "updated_by": cover.updated_by or "",
        "action_note": cover.action_note or (cover.explanation or {}).get("note") or "",
        "action": (cover.explanation or {}).get("action") or cover.status,
    }


def serialize_day(db: Session, day: models.SubstitutionDay) -> dict:
    teachers = {t.id: teacher_name(t) for t in db.query(models.Teacher).all()}
    period_rows = db.query(models.Period).all()
    periods = {p.id: p for p in period_rows}
    days = {d.id: d.name for d in db.query(models.Day).all()}
    absences = db.query(models.Absence).filter_by(on_date=day.on_date).all()
    covers = [serialize_cover(db, c, teachers, periods, days) for c in day.covers]
    covers.sort(key=lambda c: (c.get("start_time") or "", c.get("period") or ""))
    by_teacher: dict[str, dict] = {}
    for ab in absences:
        start, end = absence_window(ab)
        by_teacher[ab.teacher_id] = {
            "absence_id": ab.id,
            "teacher_id": ab.teacher_id,
            "teacher": teachers.get(ab.teacher_id) or "",
            "source": ab.source,
            "leave_for": ab.leave_for or "fullday",
            "time_in": start.strftime("%H:%M"),
            "time_out": end.strftime("%H:%M"),
            "pending": 0,
            "done": 0,
            "ignored": 0,
            "total": 0,
            "covers": [],
        }
    for cover in covers:
        tid = cover["absent_teacher_id"]
        if tid not in by_teacher:
            by_teacher[tid] = {
                "absence_id": cover.get("absence_id"),
                "teacher_id": tid,
                "teacher": cover["absent_teacher"],
                "source": "adhoc",
                "leave_for": "fullday",
                "time_in": "",
                "time_out": "",
                "pending": 0,
                "done": 0,
                "ignored": 0,
                "total": 0,
                "covers": [],
            }
        row = by_teacher[tid]
        row["covers"].append(cover)
        row["total"] += 1
        if cover["status"] == "ignored":
            row["ignored"] += 1
        elif cover["cover_teacher_ids"] or cover["status"] == "covered":
            row["done"] += 1
        else:
            row["pending"] += 1
    absentees = sorted(by_teacher.values(), key=lambda r: r["teacher"] or "")
    version = db.get(models.TimetableVersion, day.based_on_version_id)
    grid_day = grid_day_for(db, version, day.on_date) if version else None
    teacher_rows = {t.id: t for t in db.query(models.Teacher).all()}
    absentees = absentees_for_template(absentees, version, teacher_rows, grid_day.id if grid_day else None)
    grid_periods = []
    day_grid: list[dict] = []
    if version and version.timetable:
        grid_periods = [
            {
                "id": p.id,
                "name": p.name,
                "sort_order": p.sort_order,
                "period_type": p.period_type or "teaching",
                "start_time": p.start_time.strftime("%H:%M") if p.start_time else "",
                "end_time": p.end_time.strftime("%H:%M") if p.end_time else "",
            }
            for p in db.query(models.Period)
            .filter_by(time_grid_id=version.timetable.time_grid_id)
            .order_by(models.Period.sort_order)
            .all()
        ]
        if grid_day:
            by_section: dict[str, dict] = {}
            for alloc in version.allocations:
                if alloc.day_id != grid_day.id or not alloc.lesson:
                    continue
                classes = allocation_class_fields(alloc.lesson)
                names = [res.name for res in lesson_teachers(alloc.lesson) if res and res.name]
                subject = alloc.lesson.subject
                ids = classes.get("section_ids") or []
                names_sec = classes.get("sections") or []
                for i, sid in enumerate(ids):
                    sname = names_sec[i] if i < len(names_sec) else ""
                    row = by_section.setdefault(sid, {"section_id": sid, "section": sname, "cells": {}})
                    cover = next((c for c in covers if c.get("allocation_id") == alloc.id), None)
                    row["cells"][alloc.period_id] = {
                        "allocation_id": alloc.id,
                        "subject": subject.name if subject else "",
                        "short": (subject.short_name or subject.name) if subject else "",
                        "color": (subject.color if subject else None) or "#64748b",
                        "teacher": ", ".join(n for n in names if n),
                        "cover_id": cover["id"] if cover else None,
                        "cover_teachers": cover.get("cover_teachers") if cover else [],
                        "cover_status": cover["status"] if cover else None,
                        "absent_teacher": cover.get("absent_teacher") if cover else None,
                    }
            day_grid = sorted(by_section.values(), key=lambda r: r["section"] or "")
    return {
        "id": day.id,
        "on_date": str(day.on_date),
        "based_on_version_id": day.based_on_version_id,
        "timetable_id": version.timetable_id if version else None,
        "timetable": version.timetable.name if version and version.timetable else "",
        "version_label": version.label if version else "",
        "version_status": version.status if version else "",
        "weekday": day.on_date.strftime("%A"),
        "teaching_day": grid_day.name if grid_day else None,
        "grid_day_id": grid_day.id if grid_day else None,
        "periods": grid_periods,
        "day_grid": day_grid,
        "status": day.status,
        "pending": sum(a["pending"] for a in absentees),
        "done": sum(a["done"] for a in absentees),
        "ignored": sum(a["ignored"] for a in absentees),
        "absentees": absentees,
        "covers": covers,
    }
