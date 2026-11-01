"""Turn stacked timetable cells into saved split groups that survive regenerate."""

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.occupancy import lesson_sections


def _section_ids(lesson: models.Lesson) -> list[str]:
    return [s.id for s in lesson_sections(lesson)]


def _ensure_split(db: Session, section_id: str, name: str, time_grid_id: str | None = None) -> models.StudentGroup:
    rows = (
        db.query(models.StudentGroup)
        .filter(models.StudentGroup.section_id == section_id, models.StudentGroup.name == name)
        .all()
    )
    for g in rows:
        if (g.kind or "split") == "all":
            continue
        if time_grid_id and g.time_grid_id and g.time_grid_id != time_grid_id:
            continue
        if time_grid_id and not g.time_grid_id:
            g.time_grid_id = time_grid_id
        return g
    sec = db.get(models.Section, section_id)
    label = sec.resource.name if sec and sec.resource else name
    res = models.Resource(type="student_group", name=f"{label} {name}")
    db.add(res)
    db.flush()
    g = models.StudentGroup(resource_id=res.id, section_id=section_id, name=name, kind="split", time_grid_id=time_grid_id)
    db.add(g)
    db.flush()
    return g


def _attach(db: Session, lesson_id: str, group_id: str) -> None:
    exists = (
        db.query(models.LessonGroup)
        .filter_by(lesson_id=lesson_id, student_group_id=group_id)
        .first()
    )
    if not exists:
        db.add(models.LessonGroup(lesson_id=lesson_id, student_group_id=group_id))


def _same_subject_on_section(db: Session, subject_id: str, section_id: str, prefer: models.Lesson | None) -> models.Lesson | None:
    if prefer and section_id in _section_ids(prefer):
        return prefer
    rows = (
        db.query(models.Lesson)
        .options(joinedload(models.Lesson.section_links), joinedload(models.Lesson.section))
        .filter_by(subject_id=subject_id)
        .all()
    )
    for les in rows:
        if section_id in _section_ids(les):
            return les
    return None


def _allocs_for(db: Session, version_id: str, lesson_ids: set[str]) -> list[models.LessonAllocation]:
    if not lesson_ids:
        return []
    return (
        db.query(models.LessonAllocation)
        .filter(
            models.LessonAllocation.version_id == version_id,
            models.LessonAllocation.lesson_id.in_(lesson_ids),
        )
        .all()
    )


def _pair_all_week(db: Session, version_id: str, lessons: list[models.Lesson], seed: tuple[str, str]) -> tuple[int, int]:
    """Move partner sittings onto every seed-lesson slot so the group covers the whole week."""
    lock_ids = {les.id for les in lessons}
    by_lesson: dict[str, list[models.LessonAllocation]] = {les.id: [] for les in lessons}
    for a in _allocs_for(db, version_id, lock_ids):
        by_lesson.setdefault(a.lesson_id, []).append(a)

    primary = max(lessons, key=lambda les: (len(by_lesson.get(les.id) or []), les.frequency_per_week or 0))
    targets: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for a in by_lesson.get(primary.id) or []:
        slot = (a.day_id, a.period_id)
        if slot not in seen:
            seen.add(slot)
            targets.append(slot)
    if seed not in seen:
        targets.insert(0, seed)
        seen.add(seed)
    if not targets:
        targets = [seed]

    occupied_slots = set(targets)
    paired = 0
    for les in lessons:
        pool = list(by_lesson.get(les.id) or [])
        used: set[str] = set()
        for day_id, period_id in targets:
            here = next((a for a in pool if a.day_id == day_id and a.period_id == period_id and a.id not in used), None)
            if here:
                here.lock_level = "full"
                used.add(here.id)
                paired += 1
                continue
            movable = next(
                (a for a in pool if a.id not in used and (a.day_id, a.period_id) not in occupied_slots),
                None,
            )
            if movable:
                movable.day_id = day_id
                movable.period_id = period_id
                movable.lock_level = "full"
                used.add(movable.id)
                paired += 1
                continue
            if len(pool) < max(1, les.frequency_per_week or 1):
                extra = models.LessonAllocation(
                    lesson_id=les.id,
                    version_id=version_id,
                    day_id=day_id,
                    period_id=period_id,
                    occurrence_index=len(pool),
                    lock_level="full",
                )
                db.add(extra)
                db.flush()
                pool.append(extra)
                used.add(extra.id)
                paired += 1
        for a in pool:
            if a.id in used:
                a.lock_level = "full"
    return len(targets), paired


def extend_band_to_slot(db: Session, version_id: str, day_id: str, period_id: str, band_id: str) -> dict:
    """Add one more period to a saved group without dissolving existing grouped slots."""
    band = db.get(models.LessonBand, band_id)
    if not band:
        raise ValueError("Group not found")
    lessons = [m.lesson for m in band.members if m.lesson]
    if not lessons:
        raise ValueError("That group has no lessons")
    ids = {les.id for les in lessons}
    allocs = _allocs_for(db, version_id, ids)
    by_lesson: dict[str, list[models.LessonAllocation]] = {les.id: [] for les in lessons}
    slot_members: dict[tuple[str, str], set[str]] = {}
    for a in allocs:
        by_lesson.setdefault(a.lesson_id, []).append(a)
        slot_members.setdefault((a.day_id, a.period_id), set()).add(a.lesson_id)
    complete = {slot for slot, lids in slot_members.items() if lids >= ids}
    added = 0
    for les in lessons:
        pool = list(by_lesson.get(les.id) or [])
        here = next((a for a in pool if a.day_id == day_id and a.period_id == period_id), None)
        if here:
            here.lock_level = "full"
            added += 1
            continue
        movable = next(
            (
                a
                for a in pool
                if (a.day_id, a.period_id) not in complete and (a.lock_level or "none") == "none"
            ),
            None,
        )
        if not movable:
            movable = next((a for a in pool if (a.day_id, a.period_id) not in complete), None)
        if movable:
            movable.day_id = day_id
            movable.period_id = period_id
            movable.lock_level = "full"
            added += 1
            continue
        if len(pool) < max(1, les.frequency_per_week or 1):
            extra = models.LessonAllocation(
                lesson_id=les.id,
                version_id=version_id,
                day_id=day_id,
                period_id=period_id,
                occurrence_index=len(pool),
                lock_level="full",
            )
            db.add(extra)
            db.flush()
            pool.append(extra)
            by_lesson[les.id] = pool
            added += 1
        else:
            raise ValueError(
                f"{les.subject.name if les.subject else 'A lesson'} already uses all {les.frequency_per_week} periods this week. Increase Periods/week on the Lessons tab, then add this slot."
            )
    db.commit()
    return {"ok": True, "band_id": band.id, "band_name": band.name, "added": added, "lessons": len(lessons)}


def remove_from_band(
    db: Session,
    *,
    version_id: str,
    band_id: str,
    lesson_id: str,
    apply_all: bool = True,
    day_id: str | None = None,
    period_id: str | None = None,
) -> dict:
    """Drop a lesson from a saved group and unstack it from the grouped periods."""
    if not db.get(models.TimetableVersion, version_id):
        raise ValueError("Version not found")
    band = (
        db.query(models.LessonBand)
        .options(joinedload(models.LessonBand.members).joinedload(models.LessonBandMember.lesson))
        .filter_by(id=band_id)
        .first()
    )
    if not band:
        raise ValueError("Group not found")
    seed = db.get(models.Lesson, lesson_id)
    if not seed:
        raise ValueError("Lesson not found")
    member_ids = {m.lesson_id for m in band.members}
    if lesson_id not in member_ids:
        raise ValueError("That lesson is not in this group")

    remove_ids = {
        m.lesson_id
        for m in band.members
        if m.lesson_id == lesson_id or (m.lesson and m.lesson.subject_id and m.lesson.subject_id == seed.subject_id)
    }
    remain_ids = member_ids - remove_ids
    label = band.name

    allocs = _allocs_for(db, version_id, member_ids)
    slots: dict[tuple[str, str], set[str]] = {}
    for a in allocs:
        slots.setdefault((a.day_id, a.period_id), set()).add(a.lesson_id)

    if apply_all:
        grouped_slots = {
            slot
            for slot, lids in slots.items()
            if lids & remove_ids and (lids - remove_ids or len(lids) > 1)
        }
    else:
        if not day_id or not period_id:
            raise ValueError("Choose a period to remove from.")
        grouped_slots = {(day_id, period_id)}

    db.query(models.LessonBandMember).filter(
        models.LessonBandMember.band_id == band.id,
        models.LessonBandMember.lesson_id.in_(list(remove_ids)),
    ).delete(synchronize_session=False)

    dissolved = len(remain_ids) < 2
    if dissolved:
        db.query(models.LessonBandMember).filter(models.LessonBandMember.band_id == band.id).delete(
            synchronize_session=False
        )
        db.delete(band)

    freed = 0
    unlocked = 0
    for a in allocs:
        slot = (a.day_id, a.period_id)
        if a.lesson_id in remove_ids and slot in grouped_slots:
            db.delete(a)
            freed += 1
        elif dissolved and a.lesson_id in remain_ids:
            a.lock_level = "none"
            unlocked += 1
        elif a.lesson_id in remove_ids:
            a.lock_level = "none"
            unlocked += 1

    db.commit()
    return {
        "ok": True,
        "removed": len(remove_ids),
        "freed": freed,
        "unlocked": unlocked,
        "dissolved": dissolved,
        "slots": len(grouped_slots),
        "subject": seed.subject.name if seed.subject else "Lesson",
        "band_name": None if dissolved else label,
    }


def _bind_band(db: Session, name: str, lesson_ids: set[str]) -> models.LessonBand:
    links = (
        db.query(models.LessonBandMember)
        .filter(models.LessonBandMember.lesson_id.in_(list(lesson_ids)))
        .all()
        if lesson_ids
        else []
    )
    band_ids = {row.band_id for row in links}
    band = db.get(models.LessonBand, next(iter(band_ids))) if len(band_ids) == 1 else None
    if band:
        band.name = name
    else:
        band = models.LessonBand(name=name)
        db.add(band)
        db.flush()
    db.query(models.LessonBandMember).filter(models.LessonBandMember.lesson_id.in_(list(lesson_ids))).delete()
    for lid in lesson_ids:
        db.add(models.LessonBandMember(band_id=band.id, lesson_id=lid))
    return band


def save_cell_groups(
    db: Session,
    *,
    version_id: str,
    day_id: str,
    period_id: str,
    members: list[dict],
    apply_all: bool = False,
    band_name: str | None = None,
) -> dict:
    version = db.get(models.TimetableVersion, version_id)
    if not version:
        raise ValueError("Version not found")
    if len(members) < 2:
        raise ValueError("Stack at least two lessons in the cell, then save a group.")

    lessons: list[tuple[models.Lesson, str]] = []
    related: set[str] = set()
    for m in members:
        les = db.get(models.Lesson, m.get("lesson_id"))
        if not les:
            raise ValueError("Lesson not found")
        name = (m.get("group_name") or (les.subject.name if les.subject else "") or "Group").strip()
        if not name:
            raise ValueError("Each stacked lesson needs a group name.")
        lessons.append((les, name))
        related.update(_section_ids(les))
    if not related:
        raise ValueError("Those lessons have no classes.")
    label = (band_name or "").strip()
    if not label:
        raise ValueError("Give this group a name (for example II Language).")

    created = 0
    attached = 0
    band_lessons: set[str] = set()
    for les, name in lessons:
        for sid in related:
            g = _ensure_split(db, sid, name, version.timetable.time_grid_id if version.timetable else None)
            created += 1
            target = _same_subject_on_section(db, les.subject_id, sid, les)
            if target:
                _attach(db, target.id, g.id)
                band_lessons.add(target.id)
                attached += 1
    band = _bind_band(db, label, band_lessons or {les.id for les, _ in lessons})

    lock_ids = {les.id for les, _ in lessons}
    weekly = max((les.frequency_per_week or 1) for les, _ in lessons)
    slots = 1
    locked = 0
    if apply_all and weekly > 1:
        slots, locked = _pair_all_week(db, version_id, [les for les, _ in lessons], (day_id, period_id))
    else:
        allocs = (
            db.query(models.LessonAllocation)
            .filter_by(version_id=version_id, day_id=day_id, period_id=period_id)
            .all()
        )
        for a in allocs:
            if a.lesson_id in lock_ids:
                a.lock_level = "full"
                locked += 1

    db.commit()
    return {
        "ok": True,
        "sections": len(related),
        "attached": attached,
        "locked": locked,
        "created_or_reused": created,
        "weekly": weekly,
        "slots": slots,
        "apply_all": apply_all,
        "subjects": [les.subject.name if les.subject else name for les, name in lessons],
        "band_id": band.id,
        "band_name": band.name,
    }
