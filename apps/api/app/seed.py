from datetime import time

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app import models

CATALOG = [
    ("TeacherUnavailable", "Teacher unavailable", "availability", "hard"),
    ("RoomUnavailable", "Room unavailable", "availability", "hard"),
    ("ClassUnavailable", "Class unavailable", "availability", "hard"),
    ("MaxTeacherLessonsPerDay", "Max teacher lessons per day", "load", "soft"),
    ("MaxConsecutiveLessons", "Max consecutive lessons", "load", "soft"),
    ("MaxTeacherWindows", "Max teacher windows", "load", "soft"),
    ("MinTeacherWindows", "Min teacher windows", "load", "soft"),
    ("ContractHours", "Contract hours", "load", "hard"),
    ("PreferredPeriod", "Preferred period", "placement", "soft"),
    ("PreferredDay", "Preferred day", "placement", "soft"),
    ("PreferredRoom", "Preferred room", "placement", "soft"),
    ("SameRoom", "Same room", "placement", "soft"),
    ("DifferentRoom", "Different room", "placement", "soft"),
    ("LessonsTogether", "Lessons together", "relationship", "soft"),
    ("LessonsApart", "Lessons apart", "relationship", "soft"),
    ("SameTime", "Same time", "relationship", "soft"),
    ("DifferentTime", "Different time", "relationship", "soft"),
    ("Before", "Before", "relationship", "soft"),
    ("After", "After", "relationship", "soft"),
    ("Consecutive", "Consecutive", "relationship", "soft"),
    ("SubjectDistribution", "Subject distribution", "pedagogy", "soft"),
    ("MaxSubjectPerDay", "Max subject per day", "pedagogy", "soft"),
    ("AvoidConsecutiveDifficult", "Avoid consecutive difficult", "pedagogy", "soft"),
    ("ForbidCategoryInPeriods", "No subject category in these periods", "pedagogy", "hard"),
    ("ClassTeacherOnlyInPeriods", "Class teacher only in these periods", "pedagogy", "hard"),
    ("NotClassTeacherInPeriods", "Not class teacher in these periods", "pedagogy", "hard"),
]

IMPORT_TABLES = [
    "lesson_allocation",
    "lesson_resource",
    "lesson_section",
    "lesson_group",
    "lesson",
    "teacher_subject",
    "subject_year",
    "availability_cell",
    "substitution_cover",
    "substitution_day",
    "absence",
    "exemption",
    "duty",
    "generation_solution",
    "generation_job",
    "scenario",
    "timetable_version",
    "timetable",
    "period",
    "day",
    "time_grid",
    "student_group",
    "teacher",
    "room",
    "section",
    "subject",
    "term",
    "academic_year",
    "resource",
    "constraint_instance",
    "change_event",
    "ai_command",
    "launch_code",
]


def seed_catalog(db: Session) -> None:
    existing = {c.code for c in db.query(models.ConstraintType).all()}
    for code, name, cat, sev in CATALOG:
        if code not in existing:
            db.add(models.ConstraintType(code=code, name=name, category=cat, default_severity=sev))
    for code, name in (("ALL", "Every week"), ("WEEK_A", "Week A"), ("WEEK_B", "Week B")):
        if not db.query(models.WeekPattern).filter_by(code=code).first():
            db.add(models.WeekPattern(code=code, name=name))
    db.commit()


def ensure_default_time_grid(db: Session) -> None:
    """Lessons attach to a time grid owned by this timetable file."""
    if db.query(models.TimeGrid).first():
        return
    year = db.query(models.AcademicYear).filter_by(is_current=True).first() or db.query(models.AcademicYear).first()
    g = models.TimeGrid(name="Default week", academic_year_id=year.id if year else None, is_active=True)
    db.add(g)
    db.flush()
    for i, n in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]):
        db.add(models.Day(time_grid_id=g.id, name=n, weekday=i, sort_order=i))
    for i in range(1, 9):
        db.add(
            models.Period(
                time_grid_id=g.id,
                name=f"P{i}",
                sort_order=i,
                start_time=time(7 + i, 30),
                period_type="teaching",
            )
        )
    db.commit()


def clear_all_imports(db: Session) -> dict[str, int]:
    """Wipe constructed timetable rows. Keep the constraint catalog and week patterns."""
    bind = db.get_bind()
    existing = set(inspect(bind).get_table_names())
    cleared: dict[str, int] = {}
    with bind.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        for table in IMPORT_TABLES:
            if table not in existing:
                continue
            count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
            conn.execute(text(f"DELETE FROM {table}"))
            cleared[table] = int(count)
        conn.execute(text("PRAGMA foreign_keys=ON"))
    return cleared


def purge_local_master_data(db: Session) -> None:
    """No-op. Local subjects/rooms are platform-owned and must not be wiped on startup."""
    return


def ensure_all_groups(db: Session) -> None:
    """Every section gets an implicit 'All' group so divisions can split against whole-class lessons."""
    existing = {(g.section_id, (g.kind or "split")) for g in db.query(models.StudentGroup).all() if g.section_id}
    created = False
    for sec in db.query(models.Section).all():
        if (sec.id, "all") in existing:
            continue
        label = sec.resource.name if sec.resource else sec.id
        res = models.Resource(type="student_group", name=f"{label} All")
        db.add(res)
        db.flush()
        db.add(models.StudentGroup(resource_id=res.id, section_id=sec.id, name="All", kind="all"))
        created = True
    if created:
        db.commit()


def ensure_lesson_sections(db: Session) -> None:
    """Copy legacy lesson.section_id into lesson_section so combined-class queries work."""
    linked = {(row.lesson_id, row.section_id) for row in db.query(models.LessonSection).all()}
    added = False
    for les in db.query(models.Lesson).all():
        if les.section_id and (les.id, les.section_id) not in linked:
            db.add(models.LessonSection(lesson_id=les.id, section_id=les.section_id))
            added = True
    if added:
        db.commit()
