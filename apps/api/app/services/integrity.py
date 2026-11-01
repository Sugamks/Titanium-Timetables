from sqlalchemy.orm import Session

from app import models
from app.engine.conflicts import hard_health
from app.engine.occupancy import lesson_sections, lesson_teachers
from app.services.time_grids import is_teaching_type


def _lesson_label(les: models.Lesson) -> str:
    subject = les.subject.name if les.subject else "Lesson"
    classes = ", ".join(
        (s.resource.name if s.resource else s.name) for s in lesson_sections(les) if s
    )
    return f"{subject}{f' · {classes}' if classes else ''}"


def _latest_version(t: models.Timetable) -> models.TimetableVersion | None:
    versions = sorted(t.versions or [], key=lambda v: v.number)
    if not versions:
        return None
    preferred = [v for v in versions if v.status in ("saved", "published")]
    return (preferred or versions)[-1]


def template_integrity(db: Session, timetable: models.Timetable, version_id: str | None = None) -> dict:
    issues: list[dict] = []
    grid = db.get(models.TimeGrid, timetable.time_grid_id)
    days = sorted(grid.days, key=lambda d: d.sort_order) if grid else []
    periods = sorted(grid.periods, key=lambda p: p.sort_order) if grid else []
    teaching = [p for p in periods if is_teaching_type(p.period_type)]

    if timetable.deleted_at:
        issues.append({"code": "deleted", "severity": "error", "message": "This template is deleted. Restore it before using it."})
    if timetable.is_disabled:
        issues.append({"code": "disabled", "severity": "warn", "message": "This template is disabled and hidden from the default grid pick."})
    if not days:
        issues.append({"code": "no_days", "severity": "error", "message": "No weekdays are set on this template."})
    if not teaching:
        issues.append({"code": "no_teaching", "severity": "error", "message": "No teaching periods. Add at least one teaching bell."})

    missing_times = [p.name for p in periods if not p.start_time or not p.end_time]
    if missing_times:
        shown = ", ".join(missing_times[:6])
        extra = f" (+{len(missing_times) - 6} more)" if len(missing_times) > 6 else ""
        issues.append({"code": "period_times", "severity": "error", "message": f"Set start and end times for: {shown}{extra}."})

    version = db.get(models.TimetableVersion, version_id) if version_id else _latest_version(timetable)
    if version_id and not version:
        issues.append({"code": "missing_version", "severity": "error", "message": "That timetable version was not found."})

    lessons = (
        db.query(models.Lesson).filter_by(time_grid_id=timetable.time_grid_id).all()
        if timetable.time_grid_id
        else []
    )
    no_class = [_lesson_label(l) for l in lessons if not lesson_sections(l)]
    no_teacher = [_lesson_label(l) for l in lessons if not lesson_teachers(l)]
    if no_class:
        issues.append({"code": "lesson_class", "severity": "error", "message": f"{len(no_class)} lesson(s) have no class."})
    if no_teacher:
        issues.append({"code": "lesson_teacher", "severity": "error", "message": f"{len(no_teacher)} lesson(s) have no teacher."})

    health = {"ok": True, "checks": {}}
    if version:
        health = hard_health(db, version.id)
        checks = health.get("checks") or {}
        teachers = checks.get("teacher_conflicts") or {}
        classes = checks.get("class_conflicts") or {}
        rooms = checks.get("room_conflicts") or {}
        incomplete = checks.get("incomplete_lessons") or []
        if teachers:
            issues.append({"code": "teacher_clash", "severity": "error", "message": f"{len(teachers)} teacher clash(es) — a teacher is in two places at once."})
        if classes:
            issues.append({"code": "class_clash", "severity": "error", "message": f"{len(classes)} class clash(es) — a class or group is double-booked."})
        if rooms:
            issues.append({"code": "room_clash", "severity": "error", "message": f"{len(rooms)} room clash(es)."})
        if incomplete:
            issues.append({
                "code": "incomplete",
                "severity": "warn",
                "message": f"{len(incomplete)} lesson(s) still need cards placed (short of periods/week).",
            })
        if not lessons and not version.allocations:
            issues.append({"code": "empty", "severity": "warn", "message": "No lessons or placements yet. Add lessons, then generate."})

    errors = [i for i in issues if i["severity"] == "error"]
    warns = [i for i in issues if i["severity"] == "warn"]
    return {
        "ok": not errors,
        "template_id": timetable.id,
        "template_name": timetable.name,
        "version_id": version.id if version else None,
        "version_label": (version.label or f"v{version.number}") if version else None,
        "error_count": len(errors),
        "warn_count": len(warns),
        "issues": issues,
        "summary": "Ready" if not errors and not warns else ("Fix the errors" if errors else "Warnings only"),
        "health": health,
    }
