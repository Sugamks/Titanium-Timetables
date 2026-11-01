from collections import defaultdict
from datetime import datetime
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.services.audit import actor_label
from app.engine.handlers import get_handler
from app.engine.occupancy import lesson_sections
from app.services.time_grids import (
    ALLOWED_PERIOD_TYPES,
    DEFAULT_BREAK_NAMES,
    TEACHING_TYPE,
    apply_period_time_change,
    as_time,
    break_label,
    create_grid,
    default_period_specs,
    delete_period,
    ensure_days,
    insert_period,
    is_teaching_type,
    renumber_teaching_names,
    set_teaching_period_count,
    teaching_display_name,
    weekday_list,
)
from app.services.integrity import template_integrity
from app.services.constraint_paint import class_grid, clone_class_constraints, paint_class, paint_teacher, teacher_grid
from app.services.cell_groups import _bind_band, _section_ids
from app.services.constraint_presets import apply_preset
from app.services.day_times import as_times_map, day_payload
from app.services.group_grids import band_time_grid_ids
from app.services.school_catalog import (
    add_class,
    add_teacher,
    add_year,
    delete_class,
    delete_teacher,
    nat_key,
    repair_entry_names,
    set_year_short,
    update_class,
    update_teacher,
    _unique_short,
)
from app.services.impact import clone_version
from app.services.lesson_clone import clone_decision, covering_section, existing_keys
from app.services.subjects import category_label, normalize_category
from app.services.workload import forecast_new_section, teacher_workload

router = APIRouter(prefix="/v1", tags=["scheduling"])


class LessonIn(BaseModel):
    subject_id: str
    section_id: str | None = None
    section_ids: list[str] | None = None
    group_ids: list[str] | None = None
    time_grid_id: str | None = None
    week_pattern_id: str | None = None
    term_id: str | None = None
    duration_periods: int = 1
    frequency_per_week: int = 5
    lesson_type: str = "theory"
    teacher_resource_id: str | None = None
    room_resource_id: str | None = None
    teacher_resource_ids: list[str] | None = None
    room_resource_ids: list[str] | None = None
    required_room_type: str | None = None
    priority: int = 50


class LessonPatch(BaseModel):
    subject_id: str | None = None
    section_id: str | None = None
    section_ids: list[str] | None = None
    group_ids: list[str] | None = None
    duration_periods: int | None = None
    frequency_per_week: int | None = None
    teacher_resource_id: str | None = None
    room_resource_id: str | None = None
    teacher_resource_ids: list[str] | None = None
    room_resource_ids: list[str] | None = None
    week_pattern_id: str | None = None
    required_room_type: str | None = None
    priority: int | None = None


class LessonCloneIn(BaseModel):
    source_section_id: str | None = None
    lesson_id: str | None = None
    target_section_ids: list[str]
    skip_existing: bool = True
    time_grid_id: str | None = None


class GroupIn(BaseModel):
    section_id: str
    name: str
    kind: str = "split"
    time_grid_id: str | None = None


class BandIn(BaseModel):
    name: str
    subject_ids: list[str]
    section_ids: list[str]
    time_grid_id: str | None = None


class AvailabilityIn(BaseModel):
    resource_id: str
    day_id: str
    period_id: str
    state: str = "unavailable"
    week_pattern_id: str | None = None


class AvailabilityCellIn(BaseModel):
    day_id: str
    period_id: str
    state: str = "unavailable"


class AvailabilityBulkIn(BaseModel):
    resource_id: str
    week_pattern_id: str | None = None
    cells: list[AvailabilityCellIn]


class CloneClassConstraintsIn(BaseModel):
    source_section_id: str
    target_section_ids: list[str]
    replace: bool = True


class ConstraintPaintIn(BaseModel):
    kind: str
    id: str
    day_id: str
    period_id: str
    mode: str


class ConstraintIn(BaseModel):
    type_code: str
    severity: str = "soft"
    weight: int = 50
    scope: str = "global"
    scope_id: str | None = None
    params: dict | None = None
    enabled: bool = True
    version_id: str | None = None
    timetable_id: str | None = None


class ConstraintPresetIn(BaseModel):
    code: str
    timetable_id: str | None = None
    academic_year_id: str | None = None
    section_id: str | None = None
    teacher_resource_id: str | None = None
    subject_id: str | None = None
    day_id: str | None = None
    period_id: str | None = None
    max: int | None = None
    apply_all: bool = False
    severity: str = "hard"


class ReplaceStaffIn(BaseModel):
    from_resource_id: str
    to_resource_id: str
    section_id: str | None = None
    subject_id: str | None = None


class DayTimesIn(BaseModel):
    times: dict[str, dict]


class TimetableIn(BaseModel):
    name: str
    time_grid_id: str | None = None
    academic_year_id: str | None = None
    description: str | None = None
    period_count: int = 8
    include_saturday: bool = False
    include_sunday: bool = False
    template_type: str = "weekly"


class TimetableUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    is_disabled: bool | None = None
    template_type: str | None = None
    period_count: int | None = None
    include_saturday: bool | None = None
    include_sunday: bool | None = None


class TimetableCloneIn(BaseModel):
    name: str | None = None
    include_plan: bool = False


class PeriodIn(BaseModel):
    name: str | None = None
    period_type: str | None = None
    after_period_id: str | None = None
    start_time: str | None = None
    end_time: str | None = None


class SubjectIn(BaseModel):
    name: str
    short_name: str | None = None
    color: str | None = None
    academic_year_id: str | None = None
    is_difficult: bool = False
    category: str | None = None


class SubjectPatch(BaseModel):
    name: str | None = None
    short_name: str | None = None
    color: str | None = None
    academic_year_id: str | None = None
    is_difficult: bool | None = None
    category: str | None = None


class RoomIn(BaseModel):
    name: str
    room_type: str | None = None
    capacity: int = 30
    floor: str | None = None
    building: str | None = None


class YearIn(BaseModel):
    name: str
    is_current: bool = True
    short_name: str | None = None


class TeacherIn(BaseModel):
    name: str
    department: str | None = None
    short_name: str | None = None


class ClassIn(BaseModel):
    class_name: str
    section_name: str | None = None
    academic_year_id: str
    class_teacher_id: str | None = None
    short_name: str | None = None


class ShortIn(BaseModel):
    short_name: str


class TeacherPatch(BaseModel):
    name: str | None = None
    department: str | None = None
    short_name: str | None = None


class ClassPatch(BaseModel):
    class_name: str | None = None
    section_name: str | None = None
    class_teacher_id: str | None = None
    short_name: str | None = None


def _lesson_out(les: models.Lesson) -> dict:
    from app.engine.occupancy import lesson_band, lesson_groups, lesson_section_ids, lesson_sections

    teachers = [lr.resource.name for lr in les.resources if lr.resource and lr.resource.type == "teacher"]
    rooms = [lr.resource.name for lr in les.resources if lr.resource and lr.resource.type == "room"]
    sections = lesson_sections(les)
    groups = lesson_groups(les)
    band = lesson_band(les)
    year_id = next((s.academic_year_id for s in sections if s.academic_year_id), None)
    return {
        "id": les.id,
        "subject_id": les.subject_id,
        "subject": les.subject.name if les.subject else None,
        "color": les.subject.color if les.subject else None,
        "section_id": sections[0].id if sections else les.section_id,
        "section": ", ".join(s.resource.name for s in sections if s.resource) if sections else (les.section.resource.name if les.section and les.section.resource else None),
        "section_ids": lesson_section_ids(les) or [s.id for s in sections],
        "group_ids": [g.id for g in groups],
        "groups": [g.name for g in groups],
        "band_id": band.id if band else None,
        "band_name": band.name if band else None,
        "academic_year_id": year_id,
        "frequency_per_week": les.frequency_per_week,
        "duration_periods": les.duration_periods,
        "lesson_type": les.lesson_type,
        "week_pattern_id": les.week_pattern_id,
        "required_room_type": les.required_room_type,
        "priority": les.priority or 50,
        "teachers": teachers,
        "rooms": rooms,
        "teacher_resource_ids": [lr.resource_id for lr in les.resources if lr.resource and lr.resource.type == "teacher"],
        "room_resource_ids": [lr.resource_id for lr in les.resources if lr.resource and lr.resource.type == "room"],
        "time_grid_id": les.time_grid_id,
    }


def _loaded_lesson(db: Session, lesson_id: str) -> models.Lesson | None:
    return (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.subject),
            joinedload(models.Lesson.section),
            joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section),
            joinedload(models.Lesson.group_links),
            joinedload(models.Lesson.band_links).joinedload(models.LessonBandMember.band),
        )
        .filter_by(id=lesson_id)
        .first()
    )


def _set_typed_resources(db: Session, lesson_id: str, resource_ids: list[str], resource_type: str) -> None:
    existing = (
        db.query(models.LessonResource)
        .join(models.Resource, models.Resource.id == models.LessonResource.resource_id)
        .filter(models.LessonResource.lesson_id == lesson_id, models.Resource.type == resource_type)
        .all()
    )
    for lr in existing:
        db.delete(lr)
    db.flush()
    for rid in resource_ids:
        res = db.get(models.Resource, rid)
        if not res or res.type != resource_type:
            raise HTTPException(400, f"{resource_type.title()} not found. Add it on the School tab first.")
        db.add(models.LessonResource(lesson_id=lesson_id, resource_id=rid, role="required"))


def _catalog_bands(db: Session) -> list[dict]:
    bands = (
        db.query(models.LessonBand)
        .options(
            joinedload(models.LessonBand.members)
            .joinedload(models.LessonBandMember.lesson)
            .joinedload(models.Lesson.subject),
            joinedload(models.LessonBand.members)
            .joinedload(models.LessonBandMember.lesson)
            .joinedload(models.Lesson.section_links)
            .joinedload(models.LessonSection.section)
            .joinedload(models.Section.resource),
            joinedload(models.LessonBand.members)
            .joinedload(models.LessonBandMember.lesson)
            .joinedload(models.Lesson.section)
            .joinedload(models.Section.resource),
        )
        .all()
    )
    out = []
    for band in bands:
        subjects: list[str] = []
        sections: list[str] = []
        year_ids: list[str] = []
        seen_sub: set[str] = set()
        seen_sec: set[str] = set()
        for link in band.members or []:
            les = link.lesson
            if not les:
                continue
            sub = les.subject.name if les.subject else None
            if sub and sub not in seen_sub:
                seen_sub.add(sub)
                subjects.append(sub)
            for sec in lesson_sections(les):
                name = sec.resource.name if sec.resource else sec.id
                if name not in seen_sec:
                    seen_sec.add(name)
                    sections.append(name)
                if sec.academic_year_id:
                    year_ids.append(sec.academic_year_id)
        out.append(
            {
                "id": band.id,
                "name": band.name,
                "kind": "band",
                "subjects": subjects,
                "sections": sections,
                "academic_year_ids": sorted(set(year_ids)),
                "time_grid_ids": band_time_grid_ids(band),
            }
        )
    return sorted(out, key=lambda band: nat_key(band.get("name")))


@router.get("/catalog")
def catalog(db: Session = Depends(get_db), user=Depends(get_current_user)):
    repair_entry_names(db)
    years = db.query(models.AcademicYear).all()
    years_out = sorted(
        [{"id": y.id, "name": y.name, "short_name": y.short_name, "is_current": y.is_current} for y in years],
        key=lambda y: nat_key(y["name"]),
    )
    grids = db.query(models.TimeGrid).all()
    teachers = sorted(
        db.query(models.Teacher).options(joinedload(models.Teacher.resource)).all(),
        key=lambda t: nat_key(t.resource.name if t.resource else ""),
    )
    teacher_name = {t.id: t.resource.name if t.resource else t.id for t in teachers}
    sections = sorted(
        db.query(models.Section)
        .options(joinedload(models.Section.resource), joinedload(models.Section.class_teacher).joinedload(models.Teacher.resource))
        .all(),
        key=lambda s: (
            nat_key(s.class_name),
            nat_key(s.section_name or ""),
            nat_key(s.resource.name if s.resource else ""),
        ),
    )
    rooms = sorted(
        db.query(models.Room).options(joinedload(models.Room.resource)).all(),
        key=lambda r: nat_key(r.resource.name if r.resource else ""),
    )
    _repair_duplicate_shorts(db)
    _repair_duplicate_colors(db)
    subjects = sorted(db.query(models.Subject).all(), key=lambda s: nat_key(s.name))
    year_ids_by_subject: dict[str, list[str]] = defaultdict(list)
    for sy in db.query(models.SubjectYear).all():
        year_ids_by_subject[sy.subject_id].append(sy.academic_year_id)
    patterns = db.query(models.WeekPattern).all()
    tts = db.query(models.Timetable).filter(models.Timetable.deleted_at.is_(None)).all()
    group_grids_used: dict[str, set[str]] = defaultdict(set)
    for gid, grid in (
        db.query(models.LessonGroup.student_group_id, models.Lesson.time_grid_id)
        .join(models.Lesson, models.Lesson.id == models.LessonGroup.lesson_id)
        .all()
    ):
        if gid and grid:
            group_grids_used[gid].add(grid)
    for les in db.query(models.Lesson.student_group_id, models.Lesson.time_grid_id).all():
        if les.student_group_id and les.time_grid_id:
            group_grids_used[les.student_group_id].add(les.time_grid_id)
    live_grid_ids = {t.time_grid_id for t in tts}
    used_grid_ids = {row[0] for row in db.query(models.Timetable.time_grid_id).all()}
    live_grids = [g for g in grids if g.id in live_grid_ids or g.id not in used_grid_ids]
    return {
        "academic_years": years_out,
        "time_grids": [
            {
                "id": g.id,
                "name": g.name,
                "academic_year_id": g.academic_year_id,
                "days": [day_payload(d) for d in sorted(g.days, key=lambda x: x.sort_order)],
                "periods": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "sort_order": p.sort_order,
                        "period_type": p.period_type,
                        "start_time": str(p.start_time) if p.start_time else None,
                        "end_time": str(p.end_time) if p.end_time else None,
                    }
                    for p in sorted(g.periods, key=lambda x: x.sort_order)
                ],
            }
            for g in live_grids
        ],
        "teachers": [{"id": t.id, "resource_id": t.resource_id, "name": t.resource.name, "short_name": t.short_name, "department": t.department, "contract_periods": t.contract_periods} for t in teachers],
        "sections": [
            {
                "id": s.id,
                "resource_id": s.resource_id,
                "name": s.resource.name,
                "class_name": s.class_name,
                "section_name": s.section_name,
                "short_name": s.short_name,
                "academic_year_id": s.academic_year_id,
                "home_room_id": s.home_room_id,
                "student_count": s.student_count,
                "class_teacher_id": s.class_teacher_id,
                "class_teacher_resource_id": s.class_teacher.resource_id if s.class_teacher else None,
                "class_teacher_name": teacher_name.get(s.class_teacher_id) if s.class_teacher_id else None,
                "assistant_class_teacher_id": s.assistant_class_teacher_id,
            }
            for s in sections
        ],
        "rooms": [{"id": r.id, "resource_id": r.resource_id, "name": r.resource.name, "capacity": r.capacity, "room_type": r.room_type} for r in rooms],
        "subjects": [
            {
                "id": s.id,
                "name": s.name,
                "short_name": s.short_name,
                "color": s.color,
                "is_difficult": s.is_difficult,
                "category": normalize_category(s.category),
                "category_label": category_label(s.category),
                "academic_year_ids": year_ids_by_subject.get(s.id, []),
            }
            for s in subjects
        ],
        "week_patterns": [{"id": w.id, "code": w.code, "name": w.name} for w in patterns],
        "groups": [
            {
                "id": g.id,
                "name": g.name,
                "kind": g.kind or "split",
                "section_id": g.section_id,
                "resource_id": g.resource_id,
                "section": g.section.resource.name if g.section and g.section.resource else None,
                "academic_year_id": g.section.academic_year_id if g.section else None,
                "time_grid_id": g.time_grid_id,
                "time_grid_ids": sorted(
                    ({g.time_grid_id} if g.time_grid_id else set()) | group_grids_used.get(g.id, set())
                ),
            }
            for g in sorted(
                (g for g in db.query(models.StudentGroup).all() if (g.kind or "split") != "all"),
                key=lambda g: nat_key(g.name),
            )
        ],
        "bands": _catalog_bands(db),
        "terms": [
            {"id": t.id, "name": t.name, "academic_year_id": t.academic_year_id}
            for t in sorted(db.query(models.Term).all(), key=lambda t: nat_key(t.name))
        ],
        "timetables": [
            {
                "id": t.id,
                "name": t.name,
                "time_grid_id": t.time_grid_id,
                "academic_year_id": t.academic_year_id,
                "status": t.status,
                "is_disabled": bool(t.is_disabled),
                "locked_version_id": t.locked_version_id,
            }
            for t in sorted(tts, key=lambda t: nat_key(t.name))
        ],
    }


_SUBJECT_SWATCHES = (
    "#2563eb",
    "#16a34a",
    "#ca8a04",
    "#dc2626",
    "#7c3aed",
    "#0d9488",
    "#db2777",
    "#ea580c",
    "#4f46e5",
    "#0891b2",
)


def _hsl_hex(h: int, s: float, l: float) -> str:
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2
    if h < 60:
        r, g, b = c, x, 0
    elif h < 120:
        r, g, b = x, c, 0
    elif h < 180:
        r, g, b = 0, c, x
    elif h < 240:
        r, g, b = 0, x, c
    elif h < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x

    def ch(v: float) -> int:
        return round((v + m) * 255)

    return f"#{ch(r):02x}{ch(g):02x}{ch(b):02x}"


def _next_subject_color(used: set[str]) -> str:
    taken = {c.lower() for c in used if c}
    for swatch in _SUBJECT_SWATCHES:
        if swatch.lower() not in taken:
            return swatch
    n = 0
    while n < 360:
        color = _hsl_hex((n * 137) % 360, 0.62, 0.42)
        n += 1
        if color.lower() not in taken:
            return color
    return _SUBJECT_SWATCHES[0]


def _repair_duplicate_colors(db: Session) -> None:
    subjects = sorted(db.query(models.Subject).all(), key=lambda s: nat_key(s.name))
    used: set[str] = set()
    changed = False
    for s in subjects:
        color = (s.color or "").strip()
        if re.fullmatch(r"#[0-9a-fA-F]{6}", color) and color.lower() not in used:
            used.add(color.lower())
            continue
        s.color = _next_subject_color(used)
        used.add(s.color.lower())
        changed = True
    if changed:
        db.commit()


def _repair_duplicate_shorts(db: Session) -> None:
    subjects = db.query(models.Subject).all()
    by_short: dict[str, list] = defaultdict(list)
    for s in subjects:
        key = (s.short_name or "").strip().upper()
        if key:
            by_short[key].append(s)
    changed = False
    used = {k for k, rows in by_short.items() if len(rows) == 1}
    for key, rows in by_short.items():
        if len(rows) < 2:
            continue
        for s in rows:
            nxt = _unique_short(s.name or "", used)
            if nxt and nxt != (s.short_name or "").upper():
                s.short_name = nxt
                changed = True
            used.add(nxt)
    if changed:
        db.commit()


def _subject_out(s: models.Subject, year_ids: list[str] | None = None) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "short_name": s.short_name,
        "color": s.color,
        "is_difficult": bool(s.is_difficult),
        "category": normalize_category(s.category),
        "category_label": category_label(s.category),
        "academic_year_ids": year_ids or [],
    }


@router.post("/subjects")
def create_subject(body: SubjectIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    name = (body.name or "").strip().upper()
    if not name:
        raise HTTPException(400, "Subject name is required")
    if db.query(models.Subject).filter(func.lower(models.Subject.name) == name.lower()).first():
        raise HTTPException(
            400,
            "A subject with this name already exists. Reuse it on the Lessons tab — Grade 1 and Grade 3 English are two lessons, not two subjects.",
        )
    rows = db.query(models.Subject).all()
    used = {s.short_name.upper() for s in rows if s.short_name}
    requested = (body.short_name or "").strip().upper()
    short = requested if requested and requested not in used else _unique_short(name, used)
    used_colors = {(s.color or "").strip().lower() for s in rows if s.color}
    color = (body.color or "").strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color) or color.lower() in used_colors:
        color = _next_subject_color(used_colors)
    s = models.Subject(
        name=name,
        short_name=short,
        color=color,
        is_difficult=bool(body.is_difficult),
        category=normalize_category(body.category),
    )
    db.add(s)
    db.flush()
    year_ids = []
    if body.academic_year_id:
        if not db.get(models.AcademicYear, body.academic_year_id):
            raise HTTPException(400, "Academic year not found")
        db.add(models.SubjectYear(subject_id=s.id, academic_year_id=body.academic_year_id))
        year_ids = [body.academic_year_id]
    db.commit()
    db.refresh(s)
    return _subject_out(s, year_ids)


@router.patch("/subjects/{sid}")
def update_subject(sid: str, body: SubjectPatch, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    s = db.get(models.Subject, sid)
    if not s:
        raise HTTPException(404, "Subject not found")
    if body.name is not None:
        name = body.name.strip().upper()
        if not name:
            raise HTTPException(400, "Subject name is required")
        clash = (
            db.query(models.Subject)
            .filter(func.lower(models.Subject.name) == name.lower(), models.Subject.id != s.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "Another subject already uses this name.")
        s.name = name
    if body.short_name is not None:
        short = body.short_name.strip().upper()[:16]
        if not short:
            raise HTTPException(400, "Short name is required")
        clash = (
            db.query(models.Subject)
            .filter(func.upper(models.Subject.short_name) == short, models.Subject.id != s.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "This short name is already used")
        s.short_name = short
    if body.color is not None:
        color = (body.color or "").strip()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise HTTPException(400, "Color must be a hex code")
        clash = (
            db.query(models.Subject)
            .filter(func.lower(models.Subject.color) == color.lower(), models.Subject.id != s.id)
            .first()
        )
        if clash:
            raise HTTPException(400, "This color is already used")
        s.color = color
    if body.is_difficult is not None:
        s.is_difficult = bool(body.is_difficult)
    if body.category is not None:
        s.category = normalize_category(body.category)
    if body.academic_year_id:
        exists = db.query(models.SubjectYear).filter_by(subject_id=s.id, academic_year_id=body.academic_year_id).first()
        if not exists:
            db.add(models.SubjectYear(subject_id=s.id, academic_year_id=body.academic_year_id))
    db.commit()
    years = [sy.academic_year_id for sy in db.query(models.SubjectYear).filter_by(subject_id=s.id).all()]
    return _subject_out(s, years)


@router.delete("/subjects/{sid}")
def delete_subject(sid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    s = db.get(models.Subject, sid)
    if not s:
        raise HTTPException(404, "Subject not found")
    if db.query(models.Lesson).filter_by(subject_id=s.id).first():
        raise HTTPException(400, "This subject is used by lessons. Remove those lessons first.")
    db.query(models.SubjectYear).filter_by(subject_id=s.id).delete()
    db.query(models.TeacherSubject).filter_by(subject_id=s.id).delete()
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/rooms")
def create_room(body: RoomIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Room name is required")
    clash = (
        db.query(models.Room)
        .join(models.Resource, models.Room.resource_id == models.Resource.id)
        .filter(func.lower(models.Resource.name) == name.lower())
        .first()
    )
    if clash:
        raise HTTPException(400, "A room with this name already exists")
    res = models.Resource(type="room", name=name)
    db.add(res)
    db.flush()
    room = models.Room(
        resource_id=res.id,
        room_type=body.room_type or None,
        capacity=max(1, body.capacity),
        floor=body.floor or None,
        building=body.building or None,
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return {
        "id": room.id,
        "resource_id": room.resource_id,
        "name": name,
        "room_type": room.room_type,
        "capacity": room.capacity,
        "floor": room.floor,
    }


@router.delete("/rooms/{rid}")
def delete_room(rid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    room = db.get(models.Room, rid)
    if not room:
        raise HTTPException(404, "Room not found")
    used = (
        db.query(models.LessonResource)
        .filter_by(resource_id=room.resource_id)
        .first()
    )
    if used:
        raise HTTPException(400, "This room is used by lessons. Remove it from those lessons first.")
    res = db.get(models.Resource, room.resource_id)
    db.delete(room)
    if res:
        db.delete(res)
    db.commit()
    return {"ok": True}


def _school_call(fn):
    try:
        return fn()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/years")
def create_year(body: YearIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    year = _school_call(lambda: add_year(db, body.name, body.is_current, body.short_name))
    return {"id": year.id, "name": year.name, "short_name": year.short_name, "is_current": year.is_current}


@router.patch("/years/{year_id}")
def patch_year(year_id: str, body: ShortIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    year = _school_call(lambda: set_year_short(db, year_id, body.short_name))
    return {"id": year.id, "name": year.name, "short_name": year.short_name}


@router.post("/teachers")
def create_teacher(body: TeacherIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    teacher = _school_call(lambda: add_teacher(db, body.name, body.department, body.short_name))
    return {
        "id": teacher.id,
        "resource_id": teacher.resource_id,
        "name": teacher.resource.name,
        "short_name": teacher.short_name,
        "department": teacher.department,
    }


@router.patch("/teachers/{teacher_id}")
def patch_teacher(teacher_id: str, body: TeacherPatch, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    teacher = _school_call(lambda: update_teacher(db, teacher_id, body.model_dump(exclude_unset=True)))
    return {
        "id": teacher.id,
        "name": teacher.resource.name if teacher.resource else "",
        "short_name": teacher.short_name,
        "department": teacher.department,
    }


@router.delete("/teachers/{teacher_id}")
def remove_teacher(teacher_id: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    _school_call(lambda: delete_teacher(db, teacher_id))
    return {"ok": True}


@router.post("/sections")
def create_section(body: ClassIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    section = _school_call(
        lambda: add_class(
            db, body.class_name, body.section_name, body.academic_year_id, body.class_teacher_id, body.short_name
        )
    )
    return {
        "id": section.id,
        "resource_id": section.resource_id,
        "name": section.resource.name,
        "class_name": section.class_name,
        "section_name": section.section_name,
        "short_name": section.short_name,
        "academic_year_id": section.academic_year_id,
        "class_teacher_id": section.class_teacher_id,
    }


@router.patch("/sections/{section_id}")
def patch_section(section_id: str, body: ClassPatch, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    section = _school_call(lambda: update_class(db, section_id, body.model_dump(exclude_unset=True)))
    return {
        "id": section.id,
        "name": section.resource.name if section.resource else "",
        "class_name": section.class_name,
        "section_name": section.section_name,
        "short_name": section.short_name,
        "class_teacher_id": section.class_teacher_id,
    }


@router.delete("/sections/{section_id}")
def remove_section(section_id: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    _school_call(lambda: delete_class(db, section_id))
    return {"ok": True}


@router.get("/lessons")
def list_lessons(db: Session = Depends(get_db), user=Depends(get_current_user)):
    lessons = db.query(models.Lesson).options(
        joinedload(models.Lesson.resources),
        joinedload(models.Lesson.subject),
        joinedload(models.Lesson.section),
        joinedload(models.Lesson.section_links),
        joinedload(models.Lesson.group_links),
        joinedload(models.Lesson.band_links).joinedload(models.LessonBandMember.band),
    ).all()
    return [_lesson_out(l) for l in lessons]


def _live_templates(db: Session, academic_year_id: str | None = None):
    q = (
        db.query(models.Timetable)
        .filter(models.Timetable.deleted_at.is_(None))
        .filter(or_(models.Timetable.is_disabled.is_(False), models.Timetable.is_disabled.is_(None)))
    )
    if academic_year_id:
        q = q.filter_by(academic_year_id=academic_year_id)
    return q.order_by(models.Timetable.name)


def _default_grid_id(db: Session, section_id: str | None = None, requested_grid_id: str | None = None) -> str | None:
    year_id = None
    if section_id:
        sec = db.get(models.Section, section_id)
        if sec:
            year_id = sec.academic_year_id
    templates = _live_templates(db, year_id).all()
    if not templates:
        return None
    if requested_grid_id and any(t.time_grid_id == requested_grid_id for t in templates):
        return requested_grid_id
    return templates[0].time_grid_id


def _week_pattern_id(db: Session, requested: str | None) -> str | None:
    if requested:
        return requested
    row = db.query(models.WeekPattern).filter_by(code="ALL").first() or db.query(models.WeekPattern).first()
    return row.id if row else None


@router.post("/lessons")
def create_lesson(body: LessonIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if not db.get(models.Subject, body.subject_id):
        raise HTTPException(400, "Subject not found. Add it on the School tab first.")
    section_ids = list(body.section_ids or [])
    if body.section_id and body.section_id not in section_ids:
        section_ids.insert(0, body.section_id)
    for sid in section_ids:
        if not db.get(models.Section, sid):
            raise HTTPException(400, "Section not found. Add it on the School tab first.")
    if body.time_grid_id:
        live = (
            db.query(models.Timetable)
            .filter(models.Timetable.time_grid_id == body.time_grid_id)
            .filter(models.Timetable.deleted_at.is_(None))
            .first()
        )
        if not live:
            raise HTTPException(400, "Select a live template, then add lessons for that template.")
        grid_id = body.time_grid_id
    else:
        grid_id = _default_grid_id(db, section_ids[0] if section_ids else None, None)
    if not grid_id:
        raise HTTPException(400, "Create a timetable template first (Templates), then add lessons.")
    les = models.Lesson(
        subject_id=body.subject_id,
        section_id=section_ids[0] if section_ids else None,
        time_grid_id=grid_id,
        week_pattern_id=_week_pattern_id(db, body.week_pattern_id),
        term_id=body.term_id,
        duration_periods=max(1, body.duration_periods),
        frequency_per_week=max(1, body.frequency_per_week),
        lesson_type=body.lesson_type or "theory",
        required_room_type=body.required_room_type,
        priority=body.priority or 50,
    )
    db.add(les)
    db.flush()
    for sid in section_ids:
        db.add(models.LessonSection(lesson_id=les.id, section_id=sid))
    for gid in body.group_ids or []:
        if not db.get(models.StudentGroup, gid):
            raise HTTPException(400, "Group not found")
        db.add(models.LessonGroup(lesson_id=les.id, student_group_id=gid))
    teacher_ids = list(body.teacher_resource_ids or [])
    if body.teacher_resource_id and body.teacher_resource_id not in teacher_ids:
        teacher_ids.append(body.teacher_resource_id)
    room_ids = list(body.room_resource_ids or [])
    if body.room_resource_id and body.room_resource_id not in room_ids:
        room_ids.append(body.room_resource_id)
    for rid in teacher_ids:
        if not db.get(models.Resource, rid):
            raise HTTPException(400, "Teacher not found. Add it on the School tab first.")
        db.add(models.LessonResource(lesson_id=les.id, resource_id=rid, role="required"))
    for rid in room_ids:
        if not db.get(models.Resource, rid):
            raise HTTPException(400, "Room not found. Add it on the School tab first.")
        db.add(models.LessonResource(lesson_id=les.id, resource_id=rid, role="required"))
    db.commit()
    return _lesson_out(_loaded_lesson(db, les.id))


def _section_ids_of(les: models.Lesson) -> list[str]:
    from app.engine.occupancy import lesson_sections

    return [s.id for s in lesson_sections(les)]


def _lessons_covering_section(db: Session, section_id: str) -> list[models.Lesson]:
    rows = (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section),
            joinedload(models.Lesson.section),
        )
        .all()
    )
    out = []
    seen: set[str] = set()
    for les in rows:
        if section_id in _section_ids_of(les) and les.id not in seen:
            seen.add(les.id)
            out.append(les)
    return out


def _duplicate_lesson(db: Session, src: models.Lesson, target_section_id: str) -> models.Lesson:
    clone = models.Lesson(
        subject_id=src.subject_id,
        section_id=target_section_id,
        time_grid_id=src.time_grid_id,
        week_pattern_id=src.week_pattern_id,
        term_id=src.term_id,
        duration_periods=src.duration_periods,
        frequency_per_week=src.frequency_per_week,
        lesson_type=src.lesson_type or "theory",
        required_room_type=src.required_room_type,
        priority=src.priority or 50,
    )
    db.add(clone)
    db.flush()
    db.add(models.LessonSection(lesson_id=clone.id, section_id=target_section_id))
    for lr in src.resources or []:
        db.add(models.LessonResource(lesson_id=clone.id, resource_id=lr.resource_id, role=lr.role or "required"))
    return clone


@router.post("/lessons/clone")
def clone_lessons(body: LessonCloneIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    targets = [sid for sid in (body.target_section_ids or []) if sid]
    if not targets:
        raise HTTPException(400, "Choose at least one class to clone into.")
    for sid in targets:
        if not db.get(models.Section, sid):
            raise HTTPException(400, "Section not found. Add it on the School tab first.")

    all_lessons = (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section),
            joinedload(models.Lesson.section),
        )
        .all()
    )
    grid_id = body.time_grid_id

    if body.lesson_id:
        src = _loaded_lesson(db, body.lesson_id)
        if not src:
            raise HTTPException(404, "Lesson not found")
        if grid_id and src.time_grid_id != grid_id:
            raise HTTPException(400, "That lesson is not on the selected template.")
        sources = [src]
    elif body.source_section_id:
        if not db.get(models.Section, body.source_section_id):
            raise HTTPException(400, "Source class not found.")
        sources = covering_section(all_lessons, body.source_section_id, grid_id)
        if not sources:
            raise HTTPException(400, "That class has no lessons to clone on this template.")
        targets = [sid for sid in targets if sid != body.source_section_id]
        if not targets:
            raise HTTPException(400, "Choose a different class to clone into.")
    else:
        raise HTTPException(400, "Pick a source class or a lesson to clone.")

    created = 0
    skipped_joined = 0
    skipped_existing = 0
    existing_by_target = {sid: existing_keys(all_lessons, sid, grid_id) for sid in targets}

    for src in sources:
        joined = False
        for sid in targets:
            decision = clone_decision(src, sid, existing_by_target.get(sid, set()), body.skip_existing)
            if decision == "joined":
                joined = True
                break
            if decision == "existing":
                skipped_existing += 1
                continue
            _duplicate_lesson(db, src, sid)
            existing_by_target.setdefault(sid, set()).add((src.subject_id, src.time_grid_id))
            created += 1
        if joined:
            skipped_joined += 1

    db.commit()
    return {
        "ok": True,
        "created": created,
        "skipped_joined": skipped_joined,
        "skipped_existing": skipped_existing,
    }


@router.patch("/lessons/{lesson_id}")
def update_lesson(lesson_id: str, body: LessonPatch, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    les = db.get(models.Lesson, lesson_id)
    if not les:
        raise HTTPException(404, "Lesson not found")
    if body.subject_id:
        if not db.get(models.Subject, body.subject_id):
            raise HTTPException(400, "Subject not found. Add it on the School tab first.")
        les.subject_id = body.subject_id
        db.expire(les, ["subject"])
    section_ids = list(body.section_ids) if body.section_ids is not None else None
    if section_ids is None and body.section_id:
        section_ids = [body.section_id]
    if section_ids is not None:
        if not section_ids:
            raise HTTPException(400, "Choose at least one class.")
        for sid in section_ids:
            if not db.get(models.Section, sid):
                raise HTTPException(400, "Section not found. Add it on the School tab first.")
        db.query(models.LessonSection).filter_by(lesson_id=les.id).delete()
        les.section_id = section_ids[0]
        for sid in section_ids:
            db.add(models.LessonSection(lesson_id=les.id, section_id=sid))
        db.flush()
        db.expire(les, ["section_links", "section", "subject"])
    if body.group_ids is not None:
        db.query(models.LessonGroup).filter_by(lesson_id=les.id).delete()
        for gid in body.group_ids:
            if not db.get(models.StudentGroup, gid):
                raise HTTPException(400, "Group not found")
            db.add(models.LessonGroup(lesson_id=les.id, student_group_id=gid))
    if body.duration_periods is not None:
        les.duration_periods = max(1, body.duration_periods)
    if body.frequency_per_week is not None:
        new_freq = max(1, body.frequency_per_week)
        if new_freq < les.frequency_per_week:
            extras = (
                db.query(models.LessonAllocation)
                .filter(
                    models.LessonAllocation.lesson_id == les.id,
                    models.LessonAllocation.occurrence_index >= new_freq,
                )
                .all()
            )
            for a in extras:
                db.delete(a)
        les.frequency_per_week = new_freq
    if body.week_pattern_id is not None:
        les.week_pattern_id = body.week_pattern_id or None
    if body.required_room_type is not None:
        les.required_room_type = body.required_room_type or None
    if body.priority is not None:
        les.priority = body.priority
    teacher_ids = list(body.teacher_resource_ids) if body.teacher_resource_ids is not None else None
    if teacher_ids is None and body.teacher_resource_id:
        teacher_ids = [body.teacher_resource_id]
    if teacher_ids is not None:
        _set_typed_resources(db, les.id, teacher_ids, "teacher")
    room_ids = list(body.room_resource_ids) if body.room_resource_ids is not None else None
    if room_ids is None and body.room_resource_id is not None:
        room_ids = [body.room_resource_id] if body.room_resource_id else []
    if room_ids is not None:
        _set_typed_resources(db, les.id, room_ids, "room")
    db.commit()
    return _lesson_out(_loaded_lesson(db, les.id))


@router.delete("/lessons/{lesson_id}")
def delete_lesson(lesson_id: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    les = db.get(models.Lesson, lesson_id)
    if not les:
        raise HTTPException(404, "Lesson not found")
    db.query(models.LessonAllocation).filter_by(lesson_id=les.id).delete()
    db.query(models.LessonResource).filter_by(lesson_id=les.id).delete()
    db.query(models.LessonSection).filter_by(lesson_id=les.id).delete()
    db.query(models.LessonGroup).filter_by(lesson_id=les.id).delete()
    db.delete(les)
    db.commit()
    return {"ok": True}


@router.get("/groups")
def list_groups(academic_year_id: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.StudentGroup).all()
    out = []
    for g in rows:
        if (g.kind or "split") == "all":
            continue
        year_id = g.section.academic_year_id if g.section else None
        if academic_year_id and year_id != academic_year_id:
            continue
        out.append(
            {
                "id": g.id,
                "name": g.name,
                "kind": g.kind or "split",
                "section_id": g.section_id,
                "resource_id": g.resource_id,
                "section": g.section.resource.name if g.section and g.section.resource else None,
                "academic_year_id": year_id,
                "time_grid_id": g.time_grid_id,
            }
        )
    return out


@router.post("/groups")
def create_group(body: GroupIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    sec = db.get(models.Section, body.section_id)
    if not sec:
        raise HTTPException(400, "Section not found")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Group name is required")
    if (
        db.query(models.StudentGroup)
        .filter(models.StudentGroup.section_id == sec.id, func.lower(models.StudentGroup.name) == name.lower())
        .first()
    ):
        raise HTTPException(400, "This group already exists for that class")
    label = sec.resource.name if sec.resource else name
    res = models.Resource(type="student_group", name=f"{label} {name}")
    db.add(res)
    db.flush()
    if body.time_grid_id and not db.get(models.TimeGrid, body.time_grid_id):
        raise HTTPException(400, "Template not found.")
    g = models.StudentGroup(
        resource_id=res.id,
        section_id=sec.id,
        name=name,
        kind=body.kind or "split",
        time_grid_id=body.time_grid_id,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return {"id": g.id, "name": g.name, "section_id": g.section_id, "kind": g.kind, "resource_id": g.resource_id}


@router.delete("/groups/{gid}")
def delete_group(gid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    g = db.get(models.StudentGroup, gid)
    if not g:
        raise HTTPException(404)
    if (g.kind or "") == "all":
        raise HTTPException(400, "Cannot delete the All group")
    db.query(models.LessonGroup).filter_by(student_group_id=g.id).delete()
    rid = g.resource_id
    db.delete(g)
    res = db.get(models.Resource, rid)
    if res:
        db.delete(res)
    db.commit()
    return {"ok": True}


@router.post("/bands")
def create_band(body: BandIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Give the period group a name, for example LANGUAGE.")
    subject_ids = [s for s in (body.subject_ids or []) if s]
    section_ids = [s for s in (body.section_ids or []) if s]
    if len(subject_ids) < 2:
        raise HTTPException(400, "Pick at least two subjects to sit in the same period.")
    if not section_ids:
        raise HTTPException(400, "Pick at least one class.")
    lessons = (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.subject),
            joinedload(models.Lesson.section),
            joinedload(models.Lesson.section_links).joinedload(models.LessonSection.section),
        )
        .all()
    )
    if body.time_grid_id:
        lessons = [les for les in lessons if les.time_grid_id == body.time_grid_id]
    found: set[str] = set()
    missing: list[str] = []
    section_name = {
        s.id: (s.resource.name if s.resource else s.id)
        for s in db.query(models.Section).options(joinedload(models.Section.resource)).all()
    }
    subject_name = {s.id: s.name for s in db.query(models.Subject).all()}
    for sid in subject_ids:
        for sec_id in section_ids:
            hit = next((les for les in lessons if les.subject_id == sid and sec_id in _section_ids(les)), None)
            if hit:
                found.add(hit.id)
            else:
                missing.append(f"{subject_name.get(sid) or 'Subject'} · {section_name.get(sec_id) or 'class'}")
    if missing:
        raise HTTPException(
            400,
            {
                "message": "These subject–class lessons are not on this template yet. Add them on Construct → Lessons, then create the period group.",
                "missing": missing,
            },
        )
    band = _bind_band(db, name, found)
    db.commit()
    return {"id": band.id, "name": band.name, "lessons": len(found)}


@router.delete("/bands/{bid}")
def delete_band(bid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    band = db.get(models.LessonBand, bid)
    if not band:
        raise HTTPException(404)
    db.query(models.LessonBandMember).filter_by(band_id=band.id).delete()
    db.delete(band)
    db.commit()
    return {"ok": True}


def _upsert_availability_cell(db: Session, resource_id: str, day_id: str, period_id: str, state: str, week_pattern_id: str | None):
    state = (state or "unavailable").lower()
    if state not in ("available", "unavailable", "preferred", "avoid"):
        raise HTTPException(400, "state must be available, unavailable, preferred, or avoid")
    row = (
        db.query(models.AvailabilityCell)
        .filter_by(resource_id=resource_id, day_id=day_id, period_id=period_id, week_pattern_id=week_pattern_id)
        .first()
    )
    if state == "available":
        if row:
            db.delete(row)
        return "available"
    if row:
        row.state = state
        row.week_pattern_id = week_pattern_id
        return row.state
    db.add(
        models.AvailabilityCell(
            resource_id=resource_id,
            day_id=day_id,
            period_id=period_id,
            week_pattern_id=week_pattern_id,
            state=state,
        )
    )
    return state


@router.get("/availability")
def list_availability(resource_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.AvailabilityCell).filter_by(resource_id=resource_id).all()
    return [
        {
            "id": r.id,
            "resource_id": r.resource_id,
            "day_id": r.day_id,
            "period_id": r.period_id,
            "week_pattern_id": r.week_pattern_id,
            "state": r.state,
        }
        for r in rows
    ]


@router.post("/availability")
def upsert_availability(body: AvailabilityIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    state = _upsert_availability_cell(db, body.resource_id, body.day_id, body.period_id, body.state, body.week_pattern_id)
    db.commit()
    return {"ok": True, "state": state}


@router.post("/availability/bulk")
def upsert_availability_bulk(body: AvailabilityBulkIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if not body.cells:
        raise HTTPException(400, "No cells to save")
    for cell in body.cells:
        _upsert_availability_cell(db, body.resource_id, cell.day_id, cell.period_id, cell.state, body.week_pattern_id)
    db.commit()
    return {"ok": True, "count": len(body.cells)}


@router.get("/constraints/grid")
def constraints_grid(kind: str, target_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    kind = (kind or "").lower()
    if kind == "teacher":
        return teacher_grid(db, target_id)
    if kind in ("section", "class"):
        return class_grid(db, target_id)
    raise HTTPException(400, "kind must be teacher or section")


@router.post("/constraints/paint")
def constraints_paint(body: ConstraintPaintIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    kind = (body.kind or "").lower()
    try:
        if kind == "teacher":
            mode = paint_teacher(db, body.id, body.day_id, body.period_id, body.mode)
        elif kind in ("section", "class"):
            mode = paint_class(db, body.id, body.day_id, body.period_id, body.mode)
        else:
            raise ValueError("kind must be teacher or section")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.add(
        models.ChangeEvent(
            entity="constraint",
            actor=actor_label(user),
            new_value={"kind": kind, "id": body.id, "day_id": body.day_id, "period_id": body.period_id, "mode": mode},
            reason="paint constraint cell",
        )
    )
    db.commit()
    return {"ok": True, "mode": mode}


@router.post("/constraints/clone-class")
def constraints_clone_class(body: CloneClassConstraintsIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        result = clone_class_constraints(db, body.source_section_id, body.target_section_ids, replace=body.replace)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.add(
        models.ChangeEvent(
            entity="constraint",
            actor=actor_label(user),
            new_value=result,
            reason="clone class constraints",
        )
    )
    db.commit()
    return result


@router.get("/workload")
def workload(time_grid_id: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return teacher_workload(db, time_grid_id)


@router.get("/workload/forecast/{section_id}")
def forecast(section_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return forecast_new_section(db, section_id)


@router.get("/constraints/catalog")
def constraint_catalog(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.ConstraintType).all()
    return [{"code": r.code, "name": r.name, "category": r.category, "default_severity": r.default_severity} for r in rows]


@router.get("/constraints")
def list_constraints(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(models.ConstraintInstance).all()
    return [
        {
            "id": r.id,
            "type_code": r.type_code,
            "severity": r.severity,
            "weight": r.weight,
            "scope": r.scope,
            "scope_id": r.scope_id,
            "params": r.params,
            "enabled": r.enabled,
            "version_id": r.version_id,
            "timetable_id": r.timetable_id,
        }
        for r in rows
    ]


@router.post("/constraints")
def create_constraint(body: ConstraintIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if not db.get(models.ConstraintType, body.type_code):
        raise HTTPException(400, "Unknown constraint type")
    try:
        body.params = get_handler(body.type_code).validate_params(body.params)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    row = models.ConstraintInstance(
        type_code=body.type_code,
        severity=body.severity,
        weight=body.weight,
        scope=body.scope,
        scope_id=body.scope_id,
        params=body.params or {},
        enabled=body.enabled,
        version_id=body.version_id,
        timetable_id=body.timetable_id,
    )
    db.add(row)
    db.add(models.ChangeEvent(entity="constraint", actor=actor_label(user), new_value=body.model_dump(), reason="create constraint"))
    db.commit()
    db.refresh(row)
    return {"id": row.id}


@router.post("/constraints/presets")
def constraint_preset(body: ConstraintPresetIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    try:
        return apply_preset(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/lessons/replace-staff")
def replace_staff(body: ReplaceStaffIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    if body.from_resource_id == body.to_resource_id:
        raise HTTPException(400, "Choose two different staff.")
    dest = db.query(models.Teacher).filter_by(resource_id=body.to_resource_id).first()
    src = db.query(models.Teacher).filter_by(resource_id=body.from_resource_id).first()
    if not dest or not src:
        raise HTTPException(400, "Both staff must exist.")
    changed = 0
    rows = db.query(models.LessonResource).filter_by(resource_id=body.from_resource_id).all()
    for lr in rows:
        les = db.get(models.Lesson, lr.lesson_id)
        if not les:
            continue
        if body.subject_id and les.subject_id != body.subject_id:
            continue
        if body.section_id:
            secs = [ls.section_id for ls in les.section_links] + ([les.section_id] if les.section_id else [])
            if body.section_id not in secs:
                continue
        already = (
            db.query(models.LessonResource)
            .filter_by(lesson_id=les.id, resource_id=body.to_resource_id)
            .first()
        )
        if already:
            db.delete(lr)
        else:
            lr.resource_id = body.to_resource_id
        changed += 1
    db.commit()
    return {"ok": True, "updated": changed}


@router.patch("/days/{day_id}/times")
def patch_day_times(day_id: str, body: DayTimesIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    day = db.get(models.Day, day_id)
    if not day:
        raise HTTPException(404)
    current = as_times_map(day.custom_times)
    for pid, spec in (body.times or {}).items():
        if spec is None:
            current.pop(str(pid), None)
            continue
        current[str(pid)] = as_times_map({pid: spec}).get(str(pid), {"start_time": None, "end_time": None})
    day.custom_times = current
    flag_modified(day, "custom_times")
    db.commit()
    db.refresh(day)
    return {"id": day.id, "custom_times": as_times_map(day.custom_times)}


@router.post("/timetables/{tid}/fork-edit")
def fork_edit(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    tt = db.get(models.Timetable, tid)
    if not tt:
        raise HTTPException(404)
    source = None
    if tt.locked_version_id:
        source = db.get(models.TimetableVersion, tt.locked_version_id)
    if not source:
        published = [v for v in tt.versions if v.status == "published"]
        source = published[-1] if published else (sorted(tt.versions, key=lambda v: v.number)[-1] if tt.versions else None)
    if not source:
        raise HTTPException(400, "Publish a timetable first, then fork an edit copy.")
    if not tt.locked_version_id:
        tt.locked_version_id = source.id
        tt.status = "published"
    nv = clone_version(db, source, "draft", f"Edit of {source.label or 'v' + str(source.number)}", user.get("name") or "user")
    return {"id": nv.id, "locked_version_id": tt.locked_version_id, "timetable_id": tid}


@router.post("/timetables/{tid}/merge")
def merge_edit(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    tt = db.get(models.Timetable, tid)
    if not tt or not tt.locked_version_id:
        raise HTTPException(400, "This template is not locked. Publish first, then fork an edit.")
    locked = db.get(models.TimetableVersion, tt.locked_version_id)
    draft = sorted([v for v in tt.versions if v.id != tt.locked_version_id], key=lambda v: v.number)
    source = draft[-1] if draft else None
    if not locked or not source:
        raise HTTPException(400, "No edit copy to merge.")
    db.query(models.LessonAllocation).filter_by(version_id=locked.id).delete()
    for a in source.allocations:
        db.add(
            models.LessonAllocation(
                lesson_id=a.lesson_id,
                version_id=locked.id,
                day_id=a.day_id,
                period_id=a.period_id,
                week_pattern_id=a.week_pattern_id,
                room_resource_id=a.room_resource_id,
                occurrence_index=a.occurrence_index,
                lock_level=a.lock_level,
            )
        )
    locked.status = "published"
    source.status = "archived"
    db.commit()
    return {"ok": True, "version_id": locked.id, "merged_from": source.id}


@router.delete("/constraints/{cid}")
def delete_constraint(cid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    row = db.get(models.ConstraintInstance, cid)
    if not row:
        raise HTTPException(404)
    db.delete(row)
    db.commit()
    return {"ok": True}


def _timetable_out(t: models.Timetable, db: Session) -> dict:
    grid = db.get(models.TimeGrid, t.time_grid_id)
    year = db.get(models.AcademicYear, t.academic_year_id) if t.academic_year_id else None
    days = sorted(grid.days, key=lambda d: d.sort_order) if grid else []
    periods = sorted(grid.periods, key=lambda p: p.sort_order) if grid else []
    if periods and renumber_teaching_names(periods):
        db.commit()
    teaching_n = sum(1 for p in periods if is_teaching_type(p.period_type))
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "academic_year_id": t.academic_year_id,
        "academic_year": year.name if year else None,
        "time_grid_id": t.time_grid_id,
        "status": t.status or "inactive",
        "is_disabled": bool(t.is_disabled),
        "template_type": t.template_type or "weekly",
        "source": "local",
        "is_deleted": bool(t.deleted_at),
        "deleted_at": t.deleted_at.isoformat() if t.deleted_at else None,
        "day_count": len(days),
        "period_count": len(periods),
        "teaching_count": teaching_n,
        "break_count": len(periods) - teaching_n,
        "include_saturday": any(d.weekday == 5 for d in days),
        "include_sunday": any(d.weekday == 6 for d in days),
        "days": [day_payload(d) for d in days],
        "locked_version_id": t.locked_version_id,
        "periods": [_period_out(p) for p in periods],
        "versions": [
            {
                "id": v.id,
                "number": v.number,
                "status": v.status,
                "label": v.label,
                "published_at": v.published_at.isoformat() if v.published_at else None,
                "allocation_count": len(v.allocations),
            }
            for v in sorted(t.versions, key=lambda x: x.number)
        ],
    }


@router.get("/timetables")
def list_timetables(
    academic_year_id: str | None = None,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    q = db.query(models.Timetable)
    if academic_year_id:
        q = q.filter_by(academic_year_id=academic_year_id)
    if not include_deleted:
        q = q.filter(models.Timetable.deleted_at.is_(None))
    tts = q.order_by(models.Timetable.name).all()
    return [_timetable_out(t, db) for t in tts]


def _get_timetable(db: Session, tid: str, *, allow_deleted: bool = False) -> models.Timetable:
    t = db.get(models.Timetable, tid)
    if not t:
        raise HTTPException(404, "Template not found")
    if t.deleted_at and not allow_deleted:
        raise HTTPException(400, "This template was deleted. Restore it first.")
    return t


def _assert_grid_live(db: Session, grid_id: str) -> None:
    live = (
        db.query(models.Timetable)
        .filter_by(time_grid_id=grid_id)
        .filter(models.Timetable.deleted_at.is_(None))
        .first()
    )
    if not live:
        raise HTTPException(400, "This template was deleted. Restore it first.")


@router.get("/timetables/{tid}")
def get_timetable(tid: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = _get_timetable(db, tid, allow_deleted=True)
    return _timetable_out(t, db)


def _template_name_taken(db: Session, name: str, year_id: str | None, exclude_id: str | None = None) -> bool:
    q = db.query(models.Timetable).filter(
        func.lower(models.Timetable.name) == name.lower(),
        models.Timetable.deleted_at.is_(None),
    )
    if year_id:
        q = q.filter(models.Timetable.academic_year_id == year_id)
    if exclude_id:
        q = q.filter(models.Timetable.id != exclude_id)
    return q.first() is not None


def _unique_copy_name(db: Session, base: str, year_id: str | None) -> str:
    stem = (base or "Template").strip() or "Template"
    name = f"{stem} copy"
    n = 2
    while _template_name_taken(db, name, year_id):
        name = f"{stem} copy {n}"
        n += 1
    return name


def _latest_version_row(t: models.Timetable) -> models.TimetableVersion | None:
    versions = sorted(t.versions or [], key=lambda v: v.number)
    if not versions:
        return None
    preferred = [v for v in versions if v.status in ("saved", "published")]
    return (preferred or versions)[-1]


def _sync_weekend_days(db: Session, grid: models.TimeGrid, include_saturday: bool, include_sunday: bool) -> None:
    wanted = weekday_list(include_saturday, include_sunday)
    ensure_days(db, grid, wanted)
    db.flush()
    keep = {wd for wd, _ in wanted}
    for day in list(grid.days):
        if day.weekday in keep:
            continue
        used = db.query(models.LessonAllocation).filter_by(day_id=day.id).first()
        if used:
            raise HTTPException(400, f"Cannot remove {day.name}: lessons are already placed on that day.")
        db.delete(day)


@router.post("/timetables")
def create_timetable(body: TimetableIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Template name is required")
    if body.time_grid_id:
        grid = db.get(models.TimeGrid, body.time_grid_id)
        if not grid:
            raise HTTPException(400, "Time grid not found")
        year_id = body.academic_year_id or grid.academic_year_id
    else:
        year_id = body.academic_year_id
        if not year_id:
            raise HTTPException(400, "Select an academic year first.")
        if not db.get(models.AcademicYear, year_id):
            raise HTTPException(400, "Academic year not found")
        days = weekday_list(body.include_saturday, body.include_sunday)
        grid = create_grid(
            db,
            name=name,
            academic_year_id=year_id,
            days=days,
            period_specs=default_period_specs(body.period_count),
        )
    if not year_id:
        raise HTTPException(400, "Select an academic year first.")
    if _template_name_taken(db, name, year_id):
        raise HTTPException(400, f"A template named “{name}” already exists for this year.")
    t = models.Timetable(
        name=name,
        time_grid_id=grid.id,
        academic_year_id=year_id,
        description=body.description,
        status="inactive",
        is_disabled=False,
        template_type=body.template_type or "weekly",
    )
    db.add(t)
    db.flush()
    db.add(models.TimetableVersion(timetable_id=t.id, number=1, status="draft", label="Draft 1", created_by=user.get("name")))
    db.add(models.ChangeEvent(entity="timetable", entity_id=t.id, actor=actor_label(user), reason=f"create template “{name}”"))
    db.commit()
    t = db.get(models.Timetable, t.id)
    return _timetable_out(t, db)


@router.patch("/timetables/{tid}")
def update_timetable(tid: str, body: TimetableUpdate, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Template name is required")
        if _template_name_taken(db, name, t.academic_year_id, exclude_id=t.id):
            raise HTTPException(400, f"A template named “{name}” already exists for this year.")
        t.name = name
        if t.time_grid:
            t.time_grid.name = name
    if "description" in data:
        t.description = (data["description"] or "").strip() or None
    if "status" in data and data["status"] is not None:
        t.status = data["status"].strip() or t.status
    if "is_disabled" in data and data["is_disabled"] is not None:
        t.is_disabled = bool(data["is_disabled"])
    if "template_type" in data and data["template_type"] is not None:
        t.template_type = data["template_type"].strip() or t.template_type
    if "period_count" in data and data["period_count"] is not None:
        grid = db.get(models.TimeGrid, t.time_grid_id)
        if not grid:
            raise HTTPException(400, "Time grid not found")
        try:
            set_teaching_period_count(db, grid, int(data["period_count"]))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if "include_saturday" in data or "include_sunday" in data:
        grid = db.get(models.TimeGrid, t.time_grid_id)
        if not grid:
            raise HTTPException(400, "Time grid not found")
        days = sorted(grid.days, key=lambda d: d.sort_order)
        want_sat = data["include_saturday"] if "include_saturday" in data else any(d.weekday == 5 for d in days)
        want_sun = data["include_sunday"] if "include_sunday" in data else any(d.weekday == 6 for d in days)
        _sync_weekend_days(db, grid, bool(want_sat), bool(want_sun))
    db.add(models.ChangeEvent(entity="timetable", entity_id=t.id, actor=actor_label(user), reason="update template", new_value=data))
    db.commit()
    db.refresh(t)
    return _timetable_out(t, db)


@router.delete("/timetables/{tid}")
def soft_delete_timetable(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid, allow_deleted=True)
    if t.deleted_at:
        raise HTTPException(400, "Template is already deleted")
    t.deleted_at = datetime.utcnow()
    db.add(models.ChangeEvent(entity="timetable", entity_id=t.id, actor=actor_label(user), reason="soft delete template"))
    db.commit()
    db.refresh(t)
    return _timetable_out(t, db)


@router.post("/timetables/{tid}/clone")
def clone_timetable(tid: str, body: TimetableCloneIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    src = _get_timetable(db, tid)
    src_grid = db.get(models.TimeGrid, src.time_grid_id)
    if not src_grid:
        raise HTTPException(400, "Time grid not found")
    name = (body.name or "").strip() or _unique_copy_name(db, src.name, src.academic_year_id)
    if _template_name_taken(db, name, src.academic_year_id):
        raise HTTPException(400, f"A template named “{name}” already exists for this year.")
    days = [(d.weekday, d.name) for d in sorted(src_grid.days, key=lambda d: d.sort_order)]
    specs = [
        {
            "sort_order": p.sort_order,
            "name": p.name,
            "start_time": p.start_time,
            "end_time": p.end_time,
            "period_type": p.period_type,
        }
        for p in sorted(src_grid.periods, key=lambda p: p.sort_order)
    ]
    grid = create_grid(db, name, src.academic_year_id, days, specs)
    db.refresh(grid)
    dest = models.Timetable(
        name=name,
        time_grid_id=grid.id,
        academic_year_id=src.academic_year_id,
        description=src.description,
        status="inactive",
        is_disabled=False,
        template_type=src.template_type or "weekly",
    )
    db.add(dest)
    db.flush()
    nv = models.TimetableVersion(timetable_id=dest.id, number=1, status="draft", label="Draft 1", created_by=user.get("name"))
    db.add(nv)
    db.flush()
    copied = 0
    if body.include_plan:
        src_v = _latest_version_row(src)
        if src_v:
            day_map = {d.weekday: nd.id for d in src_grid.days for nd in grid.days if nd.weekday == d.weekday}
            period_map = {p.sort_order: np.id for p in src_grid.periods for np in grid.periods if np.sort_order == p.sort_order}
            for a in src_v.allocations:
                day = db.get(models.Day, a.day_id)
                period = db.get(models.Period, a.period_id)
                new_day = day_map.get(day.weekday) if day else None
                new_period = period_map.get(period.sort_order) if period else None
                if not new_day or not new_period:
                    continue
                db.add(
                    models.LessonAllocation(
                        lesson_id=a.lesson_id,
                        version_id=nv.id,
                        day_id=new_day,
                        period_id=new_period,
                        week_pattern_id=a.week_pattern_id,
                        room_resource_id=a.room_resource_id,
                        occurrence_index=a.occurrence_index,
                        lock_level=a.lock_level,
                    )
                )
                copied += 1
    db.add(models.ChangeEvent(entity="timetable", entity_id=dest.id, actor=actor_label(user), reason=f"clone template from “{src.name}”"))
    db.commit()
    dest = db.get(models.Timetable, dest.id)
    out = _timetable_out(dest, db)
    out["cloned_from"] = src.id
    out["placements_copied"] = copied
    return out


@router.get("/timetables/{tid}/integrity")
def timetable_integrity(tid: str, version_id: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = _get_timetable(db, tid, allow_deleted=True)
    return template_integrity(db, t, version_id)


@router.delete("/timetables/{tid}/purge")
def purge_timetable(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid, allow_deleted=True)
    if not t.deleted_at:
        raise HTTPException(400, "Delete the template first. Permanent delete is only for already-deleted templates.")
    for v in list(t.versions or []):
        db.query(models.LessonAllocation).filter_by(version_id=v.id).delete()
        db.delete(v)
    db.add(models.ChangeEvent(entity="timetable", entity_id=t.id, actor=actor_label(user), reason=f"purge template “{t.name}”"))
    db.delete(t)
    db.commit()
    return {"ok": True, "id": tid}


@router.post("/timetables/{tid}/restore")
def restore_timetable(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid, allow_deleted=True)
    if not t.deleted_at:
        raise HTTPException(400, "Template is not deleted")
    t.deleted_at = None
    db.add(models.ChangeEvent(entity="timetable", entity_id=t.id, actor=actor_label(user), reason="restore template"))
    db.commit()
    db.refresh(t)
    return _timetable_out(t, db)


@router.post("/timetables/{tid}/versions")
def new_draft(tid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid)
    n = max((v.number for v in t.versions), default=0) + 1
    v = models.TimetableVersion(timetable_id=t.id, number=n, status="draft", label=f"Draft {n}", created_by=user.get("name"))
    db.add(v)
    db.commit()
    return {"id": v.id, "number": n}


def _period_out(p: models.Period) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sort_order": p.sort_order,
        "period_type": p.period_type or TEACHING_TYPE,
        "period_type_label": break_label(p.period_type),
        "is_teaching": is_teaching_type(p.period_type),
        "start_time": str(p.start_time)[:5] if p.start_time else None,
        "end_time": str(p.end_time)[:5] if p.end_time else None,
    }


def _period_has_allocations(db: Session, period_id: str) -> bool:
    return db.query(models.LessonAllocation).filter_by(period_id=period_id).first() is not None


@router.post("/timetables/{tid}/periods")
def add_period(tid: str, body: PeriodIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    t = _get_timetable(db, tid)
    ptype = (body.period_type or TEACHING_TYPE).strip()
    if ptype not in ALLOWED_PERIOD_TYPES:
        raise HTTPException(400, "Use teaching, lunch_break, short_break, or prayer_break")
    teaching_n = sum(1 for p in (t.time_grid.periods if t.time_grid else []) if is_teaching_type(p.period_type))
    name = (body.name or "").strip() or DEFAULT_BREAK_NAMES.get(ptype) or teaching_display_name(teaching_n + 1)
    grid = db.get(models.TimeGrid, t.time_grid_id)
    if not grid:
        raise HTTPException(400, "Time grid not found")
    try:
        row = insert_period(
            db,
            grid,
            name=name,
            period_type_code=ptype,
            after_period_id=body.after_period_id,
            start_time=as_time(body.start_time),
            end_time=as_time(body.end_time),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    db.add(models.ChangeEvent(entity="period", entity_id=row.id, actor=actor_label(user), reason="add period", new_value=_period_out(row)))
    db.commit()
    db.refresh(row)
    return _period_out(row)


@router.patch("/periods/{pid}")
def update_period(pid: str, body: PeriodIn, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    row = db.get(models.Period, pid)
    if not row:
        raise HTTPException(404, "Period not found")
    _assert_grid_live(db, row.time_grid_id)
    if body.period_type:
        ptype = body.period_type.strip()
        if ptype not in ALLOWED_PERIOD_TYPES:
            raise HTTPException(400, "Use teaching, lunch_break, short_break, or prayer_break")
        if is_teaching_type(row.period_type) and not is_teaching_type(ptype) and _period_has_allocations(db, row.id):
            raise HTTPException(400, "Move or remove lessons from this period before turning it into a break")
        row.period_type = ptype
    if body.name is not None and body.name.strip():
        row.name = body.name.strip()
    siblings = (
        db.query(models.Period)
        .filter_by(time_grid_id=row.time_grid_id)
        .order_by(models.Period.sort_order)
        .all()
    )
    renumber_teaching_names(siblings)
    if body.start_time is not None or body.end_time is not None:
        apply_period_time_change(
            db,
            row,
            start=as_time(body.start_time) if body.start_time is not None else None,
            end=as_time(body.end_time) if body.end_time is not None else None,
        )
    if body.period_type:
        reason = f"change {row.name or 'period'} type"
    elif body.start_time is not None or body.end_time is not None:
        reason = f"change {row.name or 'period'} time"
    else:
        reason = f"update {row.name or 'period'}"
    db.add(models.ChangeEvent(entity="period", entity_id=row.id, actor=actor_label(user), reason=reason, new_value=_period_out(row)))
    db.commit()
    db.refresh(row)
    return _period_out(row)


@router.delete("/periods/{pid}")
def remove_period(pid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    row = db.get(models.Period, pid)
    if not row:
        raise HTTPException(404, "Period not found")
    _assert_grid_live(db, row.time_grid_id)
    if _period_has_allocations(db, row.id):
        raise HTTPException(400, "This period has lessons placed on it. Remove those first.")
    delete_period(db, row)
    db.add(models.ChangeEvent(entity="period", entity_id=pid, actor=actor_label(user), reason="delete period"))
    db.commit()
    return {"ok": True}
