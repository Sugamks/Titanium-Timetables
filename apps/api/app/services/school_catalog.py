"""Teachers, classes, and academic years typed in by the school."""

from __future__ import annotations

import re

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models


def _clean(value: str | None) -> str:
    return " ".join((value or "").split())


def nat_key(value: str | None) -> tuple:
    parts = re.split(r"(\d+)", (value or "").casefold())
    return tuple((0, int(part)) if part.isdigit() else (1, part) for part in parts if part)


def _name_words(name: str) -> list[str]:
    return [w for w in re.split(r"[^A-Za-z0-9]+", (name or "").upper()) if w]


def _short_from_name(name: str) -> str:
    words = _name_words(name)
    if len(words) >= 2:
        return "".join(w[0] for w in words)[:8]
    return (words[0][:3] if words else "")


def _unique_short(name: str, used: set[str]) -> str:
    taken = {u.upper() for u in used if u}
    base = _short_from_name(name)
    if base and base not in taken:
        return base
    words = _name_words(name)
    if len(words) >= 2:
        last = words[-1][:3]
        if last and last not in taken:
            return last
    letters = "".join(words)
    for n in range(3, min(8, len(letters)) + 1):
        cand = letters[:n]
        if cand and cand not in taken:
            return cand
    stem = base or "SUB"
    i = 2
    while f"{stem}{i}" in taken:
        i += 1
    return f"{stem}{i}"


def choose_short(name: str, requested: str | None, used: set[str]) -> str:
    short = _clean(requested).upper()[:16]
    taken = {u.upper() for u in used if u}
    if short:
        if short in taken:
            raise ValueError("This short name is already used")
        return short
    return _unique_short(name, taken)


def class_section_short(class_name: str, section_name: str, used: set[str]) -> str:
    """Initials of the class name plus the section, so GRADE 1 + A is G1A."""
    section = "".join(_name_words(section_name))
    class_part = _short_from_name(class_name)
    taken = {u.upper() for u in used if u}
    base = f"{class_part}{section}"[:16]
    if base and base not in taken:
        return base
    stem = (base or "SUB")[:14]
    i = 2
    while f"{stem}{i}"[:16] in taken:
        i += 1
    return f"{stem}{i}"[:16]


def choose_class_short(class_name: str, section_name: str, requested: str | None, used: set[str]) -> str:
    short = _clean(requested).upper()[:16]
    taken = {u.upper() for u in used if u}
    if short:
        if short in taken:
            raise ValueError("This short name is already used")
        return short
    return class_section_short(class_name, section_name, taken)


def _apply_short(name: str, current: str | None, used: set[str]) -> str:
    short = (current or "").strip().upper()
    if short and short not in used:
        used.add(short)
        return short
    short = _unique_short(name, used)
    used.add(short)
    return short


def _year_name(value: str | None) -> str:
    name = _clean(value).replace("–", "-").replace("—", "-")
    return re.sub(r"\s*-\s*", "-", name)


def add_year(db: Session, name: str, is_current: bool = True, short_name: str | None = None) -> models.AcademicYear:
    name = _year_name(name).upper()
    if not name:
        raise ValueError("Academic year name is required")
    key = name.casefold()
    clash = next((year for year in db.query(models.AcademicYear).all() if _year_name(year.name).casefold() == key), None)
    if clash:
        raise ValueError("This academic year already exists")
    if is_current:
        for year in db.query(models.AcademicYear).all():
            year.is_current = False
    used = {(y.short_name or "").upper() for y in db.query(models.AcademicYear).all()}
    year = models.AcademicYear(name=name, is_current=is_current, short_name=choose_short(name, short_name, used))
    db.add(year)
    db.commit()
    db.refresh(year)
    return year


def add_teacher(db: Session, name: str, department: str | None = None, short_name: str | None = None) -> models.Teacher:
    name = _clean(name).upper()
    department = _clean(department).upper()
    if not name:
        raise ValueError("Teacher name is required")
    clash = (
        db.query(models.Teacher)
        .join(models.Resource, models.Teacher.resource_id == models.Resource.id)
        .filter(models.Resource.type == "teacher", func.lower(models.Resource.name) == name.lower())
        .first()
    )
    if clash:
        raise ValueError("A teacher with this name already exists")
    resource = models.Resource(type="teacher", name=name)
    db.add(resource)
    db.flush()
    used = {(t.short_name or "").upper() for t in db.query(models.Teacher).all()}
    teacher = models.Teacher(
        resource_id=resource.id,
        department=department or None,
        short_name=choose_short(name, short_name, used),
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def add_class(
    db: Session,
    class_name: str,
    section_name: str | None,
    academic_year_id: str,
    class_teacher_id: str | None = None,
    short_name: str | None = None,
) -> models.Section:
    class_name = _clean(class_name).upper()
    section_name = _clean(section_name).upper()
    if not class_name:
        raise ValueError("Class name is required")
    year = db.get(models.AcademicYear, academic_year_id)
    if not year:
        raise ValueError("Academic year not found")
    teacher = None
    if class_teacher_id:
        teacher = db.get(models.Teacher, class_teacher_id)
        if not teacher:
            raise ValueError("Class teacher not found")
    clash = (
        db.query(models.Section)
        .filter(
            models.Section.academic_year_id == year.id,
            func.lower(models.Section.class_name) == class_name.lower(),
            func.lower(func.coalesce(models.Section.section_name, "")) == section_name.lower(),
        )
        .first()
    )
    if clash:
        raise ValueError("This class already exists in that year")
    label = f"{class_name}{section_name}".strip()
    resource = models.Resource(type="section", name=label)
    db.add(resource)
    db.flush()
    used = {(s.short_name or "").upper() for s in db.query(models.Section).all()}
    section = models.Section(
        resource_id=resource.id,
        academic_year_id=year.id,
        class_name=class_name,
        section_name=section_name or None,
        class_teacher_id=teacher.id if teacher else None,
        short_name=choose_class_short(class_name, section_name, short_name, used),
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def delete_class(db: Session, section_id: str) -> None:
    section = db.get(models.Section, section_id)
    if not section:
        raise ValueError("Class not found")
    if db.query(models.Lesson).filter_by(section_id=section.id).first():
        raise ValueError("This class is used by lessons. Remove those lessons first.")
    if db.query(models.LessonSection).filter_by(section_id=section.id).first():
        raise ValueError("This class is used by lessons. Remove those lessons first.")
    if db.query(models.StudentGroup).filter_by(section_id=section.id).first():
        raise ValueError("This class has student groups. Remove those first.")
    if section.resource_id and db.query(models.LessonResource).filter_by(resource_id=section.resource_id).first():
        raise ValueError("This class is used by lessons. Remove those lessons first.")
    resource = db.get(models.Resource, section.resource_id) if section.resource_id else None
    if section.resource_id:
        db.query(models.AvailabilityCell).filter_by(resource_id=section.resource_id).delete()
    db.delete(section)
    if resource:
        db.delete(resource)
    db.commit()


def delete_teacher(db: Session, teacher_id: str) -> None:
    teacher = db.get(models.Teacher, teacher_id)
    if not teacher:
        raise ValueError("Teacher not found")
    assigned = (
        db.query(models.Section)
        .filter(
            or_(
                models.Section.class_teacher_id == teacher.id,
                models.Section.assistant_class_teacher_id == teacher.id,
            )
        )
        .first()
    )
    if assigned:
        raise ValueError("This teacher is assigned to a class. Clear that class first.")
    if db.query(models.LessonResource).filter_by(resource_id=teacher.resource_id).first():
        raise ValueError("This teacher is used by lessons. Remove those lessons first.")
    resource = db.get(models.Resource, teacher.resource_id)
    db.delete(teacher)
    if resource:
        db.delete(resource)
    db.commit()


def _save_short(row, peers, requested: str) -> None:
    short = _clean(requested).upper()[:16]
    if not short:
        raise ValueError("Short name is required")
    if any((peer.short_name or "").upper() == short and peer.id != row.id for peer in peers):
        raise ValueError("This short name is already used")
    row.short_name = short


def set_year_short(db: Session, year_id: str, short_name: str) -> models.AcademicYear:
    year = db.get(models.AcademicYear, year_id)
    if not year:
        raise ValueError("Academic year not found")
    _save_short(year, db.query(models.AcademicYear).all(), short_name)
    db.commit()
    return year


def set_teacher_short(db: Session, teacher_id: str, short_name: str) -> models.Teacher:
    teacher = db.get(models.Teacher, teacher_id)
    if not teacher:
        raise ValueError("Teacher not found")
    _save_short(teacher, db.query(models.Teacher).all(), short_name)
    db.commit()
    return teacher


def set_section_short(db: Session, section_id: str, short_name: str) -> models.Section:
    section = db.get(models.Section, section_id)
    if not section:
        raise ValueError("Class not found")
    _save_short(section, db.query(models.Section).all(), short_name)
    db.commit()
    return section


def update_teacher(db: Session, teacher_id: str, fields: dict) -> models.Teacher:
    teacher = db.get(models.Teacher, teacher_id)
    if not teacher or not teacher.resource:
        raise ValueError("Teacher not found")
    if "name" in fields:
        name = _clean(fields["name"]).upper()
        if not name:
            raise ValueError("Teacher name is required")
        clash = (
            db.query(models.Teacher)
            .join(models.Resource, models.Teacher.resource_id == models.Resource.id)
            .filter(
                models.Resource.type == "teacher",
                func.lower(models.Resource.name) == name.lower(),
                models.Teacher.id != teacher.id,
            )
            .first()
        )
        if clash:
            raise ValueError("A teacher with this name already exists")
        teacher.resource.name = name
    if "department" in fields:
        department = _clean(fields["department"]).upper()
        teacher.department = department or None
    if "short_name" in fields:
        _save_short(teacher, db.query(models.Teacher).all(), fields["short_name"])
    db.commit()
    db.refresh(teacher)
    return teacher


def update_class(db: Session, section_id: str, fields: dict) -> models.Section:
    section = db.get(models.Section, section_id)
    if not section or not section.resource:
        raise ValueError("Class not found")
    class_name = section.class_name
    section_name = section.section_name or ""
    if "class_name" in fields:
        class_name = _clean(fields["class_name"]).upper()
        if not class_name:
            raise ValueError("Class name is required")
    if "section_name" in fields:
        section_name = _clean(fields["section_name"]).upper()
    if "class_name" in fields or "section_name" in fields:
        clash = (
            db.query(models.Section)
            .filter(
                models.Section.academic_year_id == section.academic_year_id,
                func.lower(models.Section.class_name) == class_name.lower(),
                func.lower(func.coalesce(models.Section.section_name, "")) == section_name.lower(),
                models.Section.id != section.id,
            )
            .first()
        )
        if clash:
            raise ValueError("This class already exists in that year")
        section.class_name = class_name
        section.section_name = section_name or None
        section.resource.name = f"{class_name}{section_name}".strip()
    if "class_teacher_id" in fields:
        teacher_id = fields["class_teacher_id"] or None
        if teacher_id:
            teacher = db.get(models.Teacher, teacher_id)
            if not teacher:
                raise ValueError("Class teacher not found")
            section.class_teacher_id = teacher.id
        else:
            section.class_teacher_id = None
    if "short_name" in fields:
        _save_short(section, db.query(models.Section).all(), fields["short_name"])
    db.commit()
    db.refresh(section)
    return section


def repair_entry_names(db: Session) -> None:
    """Uppercase saved names and fill a short code the same way subjects do."""
    changed = False
    years = db.query(models.AcademicYear).all()
    used: set[str] = set()
    for year in sorted(years, key=lambda y: nat_key(y.name)):
        name = _year_name(year.name).upper()
        if year.name != name:
            year.name = name
            changed = True
        short = _apply_short(name, year.short_name, used)
        if year.short_name != short:
            year.short_name = short
            changed = True
    used = set()
    for teacher in sorted(db.query(models.Teacher).all(), key=lambda t: nat_key(t.resource.name if t.resource else "")):
        resource = teacher.resource
        name = _clean(resource.name if resource else "").upper()
        if resource and name and resource.name != name:
            resource.name = name
            changed = True
        department = _clean(teacher.department).upper() or None
        if teacher.department != department:
            teacher.department = department
            changed = True
        short = _apply_short(name, teacher.short_name, used)
        if teacher.short_name != short:
            teacher.short_name = short
            changed = True
    used = set()
    for section in sorted(db.query(models.Section).all(), key=lambda s: nat_key(s.class_name or "")):
        class_name = _clean(section.class_name).upper()
        section_name = _clean(section.section_name).upper()
        if section.class_name != class_name:
            section.class_name = class_name
            changed = True
        stored_section = section.section_name or ""
        if stored_section != section_name:
            section.section_name = section_name or None
            changed = True
        label = f"{class_name}{section_name}".strip()
        resource = section.resource
        if resource and label and resource.name != label:
            resource.name = label
            changed = True
        legacy = {
            _short_from_name(label),
            _short_from_name(class_name),
            _unique_short(label, set()),
        }
        legacy.discard("")
        current = (section.short_name or "").strip().upper()
        taken = {u.upper() for u in used if u}
        if current and current not in taken and current not in legacy:
            short = current
        else:
            short = class_section_short(class_name, section_name, taken)
        used.add(short)
        if section.short_name != short:
            section.short_name = short
            changed = True
    if changed:
        db.commit()
