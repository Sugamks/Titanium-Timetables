"""Apply named school rules as constraint rows (global or template-scoped)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app import models
from app.engine.handlers import get_handler
from app.services.time_grids import is_teaching_type


def _grid_for(db: Session, timetable_id: str | None, year_id: str | None) -> models.TimeGrid | None:
    if timetable_id:
        tt = db.get(models.Timetable, timetable_id)
        if tt:
            return db.get(models.TimeGrid, tt.time_grid_id)
    grids = db.query(models.TimeGrid).all()
    return next((g for g in grids if year_id and g.academic_year_id == year_id), None) or (grids[0] if grids else None)


def teaching_and_breaks(grid: models.TimeGrid) -> tuple[list[models.Period], list[models.Period]]:
    periods = sorted(grid.periods, key=lambda p: p.sort_order)
    teaching = [p for p in periods if is_teaching_type(p.period_type)]
    return teaching, periods


def _after_lunch_ids(periods: list[models.Period]) -> list[str]:
    lunch_at = None
    ordered = sorted(periods, key=lambda p: p.sort_order)
    for p in ordered:
        if (p.period_type or "") == "lunch_break":
            lunch_at = p.sort_order
    if lunch_at is None:
        return []
    return [p.id for p in ordered if is_teaching_type(p.period_type) and p.sort_order > lunch_at]


def _upsert(db: Session, **kwargs) -> models.ConstraintInstance:
    q = db.query(models.ConstraintInstance).filter_by(
        type_code=kwargs["type_code"],
        scope=kwargs.get("scope") or "global",
        scope_id=kwargs.get("scope_id"),
        timetable_id=kwargs.get("timetable_id"),
    )
    extra = kwargs.get("match") or {}
    row = None
    for cand in q.all():
        params = cand.params or {}
        if all(params.get(k) == v for k, v in extra.items()):
            row = cand
            break
    params = dict(kwargs.get("params") or {})
    params = get_handler(kwargs["type_code"]).validate_params(params)
    if row:
        row.params = params
        row.severity = kwargs.get("severity") or "hard"
        row.weight = kwargs.get("weight") or 100
        row.enabled = True
        return row
    row = models.ConstraintInstance(
        type_code=kwargs["type_code"],
        severity=kwargs.get("severity") or "hard",
        weight=kwargs.get("weight") or 100,
        scope=kwargs.get("scope") or "global",
        scope_id=kwargs.get("scope_id"),
        timetable_id=kwargs.get("timetable_id"),
        params=params,
        enabled=True,
    )
    db.add(row)
    return row


def apply_preset(db: Session, body: dict) -> dict:
    code = (body.get("code") or "").strip()
    timetable_id = body.get("timetable_id") or None
    year_id = body.get("academic_year_id") or None
    grid = _grid_for(db, timetable_id, year_id)
    if not grid:
        raise ValueError("Create a template first so the week grid exists.")
    teaching, periods = teaching_and_breaks(grid)
    days = sorted(grid.days, key=lambda d: d.sort_order)
    day_ids = [d.id for d in days]
    created = []

    if code == "first_period_class_teacher":
        if not teaching:
            raise ValueError("No teaching periods on this template.")
        row = _upsert(
            db,
            type_code="ClassTeacherOnlyInPeriods",
            scope="global",
            timetable_id=None,
            params={"day_ids": day_ids, "period_ids": [teaching[0].id], "slots": []},
            match={"period_ids": [teaching[0].id]},
        )
        created.append(row.id)
    elif code == "second_period_non_class_teacher":
        if len(teaching) < 2:
            raise ValueError("Need at least two teaching periods.")
        row = _upsert(
            db,
            type_code="NotClassTeacherInPeriods",
            scope="global",
            timetable_id=None,
            params={"day_ids": day_ids, "period_ids": [teaching[1].id], "slots": []},
            match={"period_ids": [teaching[1].id]},
        )
        created.append(row.id)
    elif code == "pin_subject":
        subject_id = body.get("subject_id")
        day_id = body.get("day_id")
        period_id = body.get("period_id")
        if not subject_id or not day_id or not period_id:
            raise ValueError("Choose a subject, day, and period.")
        row = _upsert(
            db,
            type_code="PreferredPeriod",
            scope="subject",
            scope_id=subject_id,
            timetable_id=None,
            severity="hard",
            params={"day_ids": [day_id], "period_ids": [period_id], "slots": [{"day_id": day_id, "period_id": period_id}], "mode": "prefer"},
            match={"day_ids": [day_id], "period_ids": [period_id]},
        )
        created.append(row.id)
    elif code == "no_pe_after_lunch":
        pids = _after_lunch_ids(periods)
        if not pids:
            raise ValueError("Mark a lunch break on the bell times first.")
        targets = _section_targets(db, body)
        for sid in targets:
            row = _upsert(
                db,
                type_code="ForbidCategoryInPeriods",
                scope="section",
                scope_id=sid,
                timetable_id=timetable_id,
                params={"category": "physical", "day_ids": day_ids, "period_ids": pids, "slots": []},
                match={"category": "physical"},
            )
            created.append(row.id)
    elif code == "no_core_last":
        if not teaching:
            raise ValueError("No teaching periods on this template.")
        targets = _section_targets(db, body)
        last_id = teaching[-1].id
        for sid in targets:
            row = _upsert(
                db,
                type_code="ForbidCategoryInPeriods",
                scope="section",
                scope_id=sid,
                timetable_id=timetable_id,
                params={"category": "core", "day_ids": day_ids, "period_ids": [last_id], "slots": [], "role": "last"},
                match={"category": "core", "role": "last"},
            )
            created.append(row.id)
    elif code == "max_consecutive":
        mx = int(body.get("max") or 3)
        for rid in _teacher_targets(db, body):
            row = _upsert(
                db,
                type_code="MaxConsecutiveLessons",
                scope="teacher",
                scope_id=rid,
                timetable_id=timetable_id,
                severity=body.get("severity") or "hard",
                params={"max": mx},
                match={},
            )
            created.append(row.id)
    elif code == "max_per_day":
        mx = int(body.get("max") or 6)
        for rid in _teacher_targets(db, body):
            row = _upsert(
                db,
                type_code="MaxTeacherLessonsPerDay",
                scope="teacher",
                scope_id=rid,
                timetable_id=timetable_id,
                severity=body.get("severity") or "hard",
                params={"max": mx},
                match={},
            )
            created.append(row.id)
    else:
        raise ValueError(f"Unknown rule: {code}")

    db.commit()
    return {"ok": True, "code": code, "count": len(created), "ids": created}


def _section_targets(db: Session, body: dict) -> list[str]:
    if body.get("section_id") and not body.get("apply_all"):
        return [body["section_id"]]
    year_id = body.get("academic_year_id")
    q = db.query(models.Section)
    if year_id:
        q = q.filter(models.Section.academic_year_id == year_id)
    return [s.id for s in q.all()]


def relevant_constraints(db: Session, version: models.TimetableVersion):
    tid = version.timetable_id
    rows = (
        db.query(models.ConstraintInstance)
        .filter((models.ConstraintInstance.version_id == version.id) | (models.ConstraintInstance.version_id.is_(None)))
        .all()
    )
    return [c for c in rows if not getattr(c, "timetable_id", None) or c.timetable_id == tid]


def _teacher_targets(db: Session, body: dict) -> list[str]:
    if body.get("teacher_resource_id") and not body.get("apply_all"):
        return [body["teacher_resource_id"]]
    return [t.resource_id for t in db.query(models.Teacher).all() if t.resource_id]
