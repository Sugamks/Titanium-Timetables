from sqlalchemy.orm import Session

from app import models
from app.engine.conflicts import teacher_of


def compute_impact(db: Session, version_id: str, spec: dict) -> dict:
    version = db.get(models.TimetableVersion, version_id)
    if not version:
        return {"error": "version not found"}
    room_id = spec.get("room_resource_id")
    teacher_rid = spec.get("teacher_resource_id")
    affected = []
    for a in version.allocations:
        hit = False
        if room_id and a.room_resource_id == room_id:
            hit = True
        t = teacher_of(a.lesson)
        if teacher_rid and t and t.id == teacher_rid:
            hit = True
        if hit:
            affected.append(
                {
                    "allocation_id": a.id,
                    "lesson_id": a.lesson_id,
                    "section": a.lesson.section.resource.name if a.lesson.section and a.lesson.section.resource else None,
                    "teacher": t.name if t else None,
                    "day_id": a.day_id,
                    "period_id": a.period_id,
                }
            )
    teachers = {x["teacher"] for x in affected if x["teacher"]}
    sections = {x["section"] for x in affected if x["section"]}
    return {
        "lessons_affected": len(affected),
        "teachers_affected": len(teachers),
        "sections_affected": len(sections),
        "potential_conflicts": len(affected),
        "affected": affected[:80],
        "spec": spec,
        "repair_hint": "POST /v1/repair with freeze of unaffected allocations",
    }


def clone_version(db: Session, source: models.TimetableVersion, status: str, label: str, actor: str) -> models.TimetableVersion:
    next_num = max((v.number for v in source.timetable.versions), default=0) + 1
    nv = models.TimetableVersion(
        timetable_id=source.timetable_id,
        parent_version_id=source.id,
        number=next_num,
        status=status,
        label=label,
        created_by=actor,
    )
    db.add(nv)
    db.flush()
    for a in source.allocations:
        db.add(
            models.LessonAllocation(
                lesson_id=a.lesson_id,
                version_id=nv.id,
                day_id=a.day_id,
                period_id=a.period_id,
                week_pattern_id=a.week_pattern_id,
                room_resource_id=a.room_resource_id,
                occurrence_index=a.occurrence_index,
                lock_level=a.lock_level,
            )
        )
    db.commit()
    db.refresh(nv)
    return nv
