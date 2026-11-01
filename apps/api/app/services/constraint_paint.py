"""Paint class/staff week-grid cells as constraint slots."""

from __future__ import annotations

from copy import deepcopy

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.handlers import get_handler
from app.services.time_grids import is_teaching_type

STAFF_MODES = ("available", "unavailable")

CLASS_MODES = {
    "open": None,
    "na": ("ClassUnavailable", {}),
    "nocp": ("ForbidCategoryInPeriods", {"category": "core"}),
    "nosl": ("ForbidCategoryInPeriods", {"category": "language"}),
    "nopa": ("ForbidCategoryInPeriods", {"category": "physical"}),
    "cton": ("ClassTeacherOnlyInPeriods", {}),
    "ncton": ("NotClassTeacherInPeriods", {}),
}

CLASS_TYPE_CODES = {spec[0] for spec in CLASS_MODES.values() if spec}


def _key(day_id: str, period_id: str) -> str:
    return f"{day_id}:{period_id}"


def expand_slots(params: dict | None, day_ids: list[str], period_ids: list[str]) -> list[tuple[str, str]]:
    p = params or {}
    slots = p.get("slots") or []
    if slots:
        return [(s.get("day_id"), s.get("period_id")) for s in slots if s.get("day_id") and s.get("period_id")]
    days = list(p.get("day_ids") or [])
    pers = list(p.get("period_ids") or [])
    if days and pers:
        return [(d, pid) for d in days for pid in pers]
    if days:
        return [(d, pid) for d in days for pid in period_ids]
    if pers:
        return [(d, pid) for d in day_ids for pid in pers]
    return []


def _write_slots(row: models.ConstraintInstance, slots: set[tuple[str, str]]) -> None:
    params = dict(row.params or {})
    params["slots"] = [{"day_id": d, "period_id": p} for d, p in sorted(slots)]
    params["day_ids"] = []
    params["period_ids"] = []
    row.params = params


def _grid_ids(db: Session, academic_year_id: str | None) -> tuple[list[str], list[str]]:
    grids = db.query(models.TimeGrid).all()
    grid = next((g for g in grids if academic_year_id and g.academic_year_id == academic_year_id), None) or (grids[0] if grids else None)
    if not grid:
        return [], []
    days = [d.id for d in sorted(grid.days, key=lambda x: x.sort_order)]
    periods = [p.id for p in sorted(grid.periods, key=lambda x: x.sort_order) if is_teaching_type(p.period_type)]
    return days, periods


def _mode_of_constraint(row: models.ConstraintInstance) -> str | None:
    if row.type_code == "ClassUnavailable":
        return "na"
    if row.type_code == "ClassTeacherOnlyInPeriods":
        return "cton"
    if row.type_code == "NotClassTeacherInPeriods":
        return "ncton"
    if row.type_code == "ForbidCategoryInPeriods":
        cat = (row.params or {}).get("category")
        return {"core": "nocp", "language": "nosl", "physical": "nopa"}.get(cat)
    return None


def _matches_mode(row: models.ConstraintInstance, mode: str) -> bool:
    spec = CLASS_MODES.get(mode)
    if not spec:
        return False
    code, extra = spec
    if row.type_code != code:
        return False
    for k, v in extra.items():
        if (row.params or {}).get(k) != v:
            return False
    return True


def teacher_grid(db: Session, resource_id: str) -> dict:
    rows = db.query(models.AvailabilityCell).filter_by(resource_id=resource_id).all()
    cells = {_key(r.day_id, r.period_id): r.state for r in rows}
    return {"kind": "teacher", "id": resource_id, "cells": cells}


def class_grid(db: Session, section_id: str) -> dict:
    section = (
        db.query(models.Section)
        .options(joinedload(models.Section.class_teacher).joinedload(models.Teacher.resource))
        .filter_by(id=section_id)
        .first()
    )
    if not section:
        return {"kind": "section", "id": section_id, "cells": {}, "class_teacher_name": None}
    day_ids, period_ids = _grid_ids(db, section.academic_year_id)
    rows = (
        db.query(models.ConstraintInstance)
        .filter_by(scope="section", scope_id=section_id)
        .filter(models.ConstraintInstance.type_code.in_(CLASS_TYPE_CODES))
        .all()
    )
    cells: dict[str, str] = {}
    for row in rows:
        mode = _mode_of_constraint(row)
        if not mode:
            continue
        for d, p in expand_slots(row.params, day_ids, period_ids):
            cells[_key(d, p)] = mode
    ct = section.class_teacher.resource.name if section.class_teacher and section.class_teacher.resource else None
    return {
        "kind": "section",
        "id": section_id,
        "cells": cells,
        "class_teacher_id": section.class_teacher_id,
        "class_teacher_name": ct,
    }


def paint_teacher(db: Session, resource_id: str, day_id: str, period_id: str, mode: str) -> str:
    mode = (mode or "unavailable").lower()
    if mode in ("open", "available", "can"):
        mode = "available"
    if mode not in ("available", "unavailable", "preferred", "avoid"):
        raise ValueError("Unknown staff paint mode")
    row = (
        db.query(models.AvailabilityCell)
        .filter_by(resource_id=resource_id, day_id=day_id, period_id=period_id, week_pattern_id=None)
        .first()
    )
    if mode == "available":
        if row:
            db.delete(row)
        return "available"
    if row:
        row.state = mode
    else:
        db.add(models.AvailabilityCell(resource_id=resource_id, day_id=day_id, period_id=period_id, state=mode))
    return mode


def paint_class(db: Session, section_id: str, day_id: str, period_id: str, mode: str) -> str:
    mode = (mode or "open").lower()
    if mode in ("available", "clear", "can"):
        mode = "open"
    if mode not in CLASS_MODES:
        raise ValueError("Unknown class paint mode")
    section = db.get(models.Section, section_id)
    if not section:
        raise ValueError("Class not found")
    if mode in ("cton", "ncton") and not section.class_teacher_id:
        raise ValueError("This class has no class teacher. Set one on the School tab first.")
    day_ids, period_ids = _grid_ids(db, section.academic_year_id)
    cell = (day_id, period_id)
    rows = (
        db.query(models.ConstraintInstance)
        .filter_by(scope="section", scope_id=section_id)
        .filter(models.ConstraintInstance.type_code.in_(CLASS_TYPE_CODES))
        .all()
    )
    target = None
    doomed = []
    for row in rows:
        slots = set(expand_slots(row.params, day_ids, period_ids))
        slots.discard(cell)
        if mode != "open" and _matches_mode(row, mode):
            slots.add(cell)
            target = row
        if not slots:
            doomed.append(row)
            continue
        _write_slots(row, slots)
    for row in doomed:
        db.delete(row)
    if mode != "open" and target is None:
        spec = CLASS_MODES[mode]
        assert spec
        code, extra = spec
        params = {**extra, "slots": [{"day_id": day_id, "period_id": period_id}], "day_ids": [], "period_ids": []}
        params = get_handler(code).validate_params(params)
        db.add(
            models.ConstraintInstance(
                type_code=code,
                severity="hard",
                weight=100,
                scope="section",
                scope_id=section_id,
                params=params,
                enabled=True,
            )
        )
    return mode


def class_constraint_copies(rows, target_ids: list[str]) -> list[dict]:
    out = []
    for tid in target_ids:
        for row in rows:
            out.append(
                {
                    "type_code": row.type_code,
                    "severity": getattr(row, "severity", None) or "hard",
                    "weight": getattr(row, "weight", None) or 100,
                    "scope": "section",
                    "scope_id": tid,
                    "params": deepcopy(getattr(row, "params", None) or {}),
                    "enabled": bool(getattr(row, "enabled", True)),
                    "timetable_id": getattr(row, "timetable_id", None),
                }
            )
    return out


def clone_class_constraints(db: Session, source_id: str, target_ids: list[str], replace: bool = True) -> dict:
    source = db.get(models.Section, source_id)
    if not source:
        raise ValueError("Source class not found")
    dest_ids: list[str] = []
    for tid in target_ids or []:
        if not tid or tid == source_id:
            continue
        if not db.get(models.Section, tid):
            raise ValueError("Target class not found")
        if tid not in dest_ids:
            dest_ids.append(tid)
    if not dest_ids:
        raise ValueError("Pick at least one other class to copy into.")
    rows = (
        db.query(models.ConstraintInstance)
        .filter_by(scope="section", scope_id=source_id)
        .filter(models.ConstraintInstance.type_code.in_(CLASS_TYPE_CODES))
        .all()
    )
    if replace:
        doomed = (
            db.query(models.ConstraintInstance)
            .filter(models.ConstraintInstance.scope == "section")
            .filter(models.ConstraintInstance.scope_id.in_(dest_ids))
            .filter(models.ConstraintInstance.type_code.in_(CLASS_TYPE_CODES))
            .all()
        )
        for row in doomed:
            db.delete(row)
    for spec in class_constraint_copies(rows, dest_ids):
        db.add(models.ConstraintInstance(**spec))
    return {
        "ok": True,
        "source": source_id,
        "targets": dest_ids,
        "constraints": len(rows),
        "copied": len(rows) * len(dest_ids),
    }
