from collections import defaultdict

from sqlalchemy.orm import Session

from app import models
from app.engine.conflicts import teacher_of


def lessons_for_workload(lessons, time_grid_id: str | None):
    if not time_grid_id:
        return list(lessons)
    return [les for les in lessons if getattr(les, "time_grid_id", None) == time_grid_id]


def teacher_workload(db: Session, time_grid_id: str | None = None) -> list[dict]:
    lessons = lessons_for_workload(db.query(models.Lesson).all(), time_grid_id)
    by_teacher: dict[str, dict] = {}
    for les in lessons:
        t = teacher_of(les)
        if not t:
            continue
        teacher = db.query(models.Teacher).filter_by(resource_id=t.id).first()
        rec = by_teacher.setdefault(
            t.id,
            {
                "resource_id": t.id,
                "teacher_id": teacher.id if teacher else None,
                "name": t.name,
                "department": teacher.department if teacher else None,
                "contract": teacher.contract_periods if teacher else 28,
                "teaching": 0,
                "lessons": [],
            },
        )
        load = les.frequency_per_week * les.duration_periods
        rec["teaching"] += load
        rec["lessons"].append(
            {
                "lesson_id": les.id,
                "subject": les.subject.name if les.subject else "",
                "section": les.section.resource.name if les.section and les.section.resource else "",
                "periods": load,
            }
        )
    out = []
    for rec in by_teacher.values():
        rec["utilization"] = round(100 * rec["teaching"] / max(1, rec["contract"]), 1)
        out.append(rec)
    return sorted(out, key=lambda r: r["name"])


def forecast_new_section(db: Session, copy_from_section_id: str) -> dict:
    src = db.query(models.Lesson).filter_by(section_id=copy_from_section_id).all()
    extra = defaultdict(int)
    for les in src:
        extra[les.subject.name if les.subject else "Subject"] += les.frequency_per_week
    wl = teacher_workload(db)
    shortages = []
    for subj, need in extra.items():
        # naive: teachers whose lessons include that subject
        capacity = 0
        for t in wl:
            if any(l["subject"] == subj for l in t["lessons"]):
                capacity += max(0, t["contract"] - t["teaching"])
        if capacity < need:
            shortages.append({"subject": subj, "required": need, "available": capacity, "short": need - capacity})
    return {"required": dict(extra), "shortages": shortages}
