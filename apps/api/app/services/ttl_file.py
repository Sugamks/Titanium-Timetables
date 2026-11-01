"""One .ttl file is one template in one academic year."""

from __future__ import annotations

import sqlite3
from pathlib import Path

FORMAT = "schd-ttl"
VERSION = 1
_SQLITE_HEADER = b"SQLite format 3\x00"
_INVALID_FILE_CHARS = '<>:"/\\|?*'


def open_document(path: Path) -> Path:
    path = Path(path)
    if path.suffix.lower() != ".ttl":
        raise ValueError("Timetable file must end with .ttl")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        _create(path)
    else:
        assert_document(path)
    return path.resolve()


def assert_document(path: Path) -> None:
    path = Path(path)
    if path.suffix.lower() != ".ttl":
        raise ValueError("Timetable file must end with .ttl")
    if not path.is_file():
        raise ValueError("Timetable file was not found")
    with path.open("rb") as handle:
        header = handle.read(16)
    if header != _SQLITE_HEADER:
        raise ValueError("This file is not a timetable")
    conn = sqlite3.connect(path)
    try:
        try:
            row = conn.execute("SELECT format, version FROM ttl_document LIMIT 1").fetchone()
        except sqlite3.Error as exc:
            raise ValueError("This file is not a timetable") from exc
    finally:
        conn.close()
    if not row or row[0] != FORMAT or int(row[1]) != VERSION:
        raise ValueError("This file is not a timetable")


def _ensure_marker(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS ttl_document (format TEXT NOT NULL, version INTEGER NOT NULL)")
        row = conn.execute("SELECT format, version FROM ttl_document LIMIT 1").fetchone()
        if not row:
            conn.execute(
                "INSERT INTO ttl_document (format, version) VALUES (?, ?)",
                (FORMAT, VERSION),
            )
        conn.commit()
    finally:
        conn.close()


def copy_document(src: Path, dest: Path) -> Path:
    src = Path(src).resolve()
    dest = Path(dest)
    if dest.suffix.lower() != ".ttl":
        raise ValueError("Timetable file must end with .ttl")
    dest = dest.resolve()
    if dest == src:
        raise ValueError("Choose a different file name")
    if src.suffix.lower() == ".ttl":
        assert_document(src)
    elif not src.is_file():
        raise ValueError("No timetable file is open")
    else:
        with src.open("rb") as handle:
            if handle.read(16) != _SQLITE_HEADER:
                raise ValueError("No timetable file is open")
    dest.parent.mkdir(parents=True, exist_ok=True)
    src_conn = sqlite3.connect(src)
    dest_conn = sqlite3.connect(dest)
    try:
        src_conn.backup(dest_conn)
        dest_conn.commit()
    finally:
        dest_conn.close()
        src_conn.close()
    if src.suffix.lower() != ".ttl":
        _ensure_marker(dest)
    assert_document(dest)
    return dest


def sqlite_path() -> Path | None:
    from app.config import settings

    prefix = "sqlite+pysqlite:///"
    url = settings.database_url
    if not url.startswith(prefix):
        return None
    path = Path(url[len(prefix) :])
    return path if path.is_file() else None


def current_path() -> Path | None:
    path = sqlite_path()
    if path is None or path.suffix.lower() != ".ttl":
        return None
    return path


def checkpoint_current() -> None:
    path = current_path()
    if path is None or not path.is_file():
        return
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()


def file_stem(template_name: str) -> str:
    cleaned = "".join(ch for ch in (template_name or "").strip() if ch not in _INVALID_FILE_CHARS and ord(ch) >= 32)
    cleaned = " ".join(cleaned.split()).rstrip(". ")
    if not cleaned:
        raise ValueError("Template name is required")
    reserved = {"CON", "PRN", "AUX", "NUL"}
    reserved.update(f"COM{n}" for n in range(1, 10))
    reserved.update(f"LPT{n}" for n in range(1, 10))
    if cleaned.upper() in reserved:
        cleaned = f"{cleaned} timetable"
    return cleaned[:120]


def path_for_template(folder: Path, template_name: str, academic_year: str) -> Path:
    return Path(folder) / f"{file_stem(template_name)}-{file_stem(academic_year)}.ttl"


def _ids(query) -> list[str]:
    return [row.id for row in query.all()]


def _drop_grid(session, grid_id: str) -> None:
    from app import models

    lesson_ids = _ids(session.query(models.Lesson.id).filter(models.Lesson.time_grid_id == grid_id))
    if lesson_ids:
        session.query(models.LessonAllocation).filter(models.LessonAllocation.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
        session.query(models.LessonResource).filter(models.LessonResource.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
        session.query(models.LessonSection).filter(models.LessonSection.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
        session.query(models.LessonGroup).filter(models.LessonGroup.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
        session.query(models.LessonBandMember).filter(models.LessonBandMember.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
        session.query(models.Lesson).filter(models.Lesson.id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.Day).filter_by(time_grid_id=grid_id).delete(synchronize_session=False)
    session.query(models.Period).filter_by(time_grid_id=grid_id).delete(synchronize_session=False)
    grid = session.get(models.TimeGrid, grid_id)
    if grid is not None:
        session.delete(grid)
    session.flush()


def drop_template(session, template_id: str) -> None:
    from app import models

    timetable = session.get(models.Timetable, template_id)
    if timetable is None:
        return
    grid_id = timetable.time_grid_id
    version_ids = _ids(session.query(models.TimetableVersion.id).filter_by(timetable_id=template_id))
    if version_ids:
        job_ids = _ids(session.query(models.GenerationJob.id).filter(models.GenerationJob.version_id.in_(version_ids)))
        if job_ids:
            session.query(models.GenerationSolution).filter(models.GenerationSolution.job_id.in_(job_ids)).delete(synchronize_session=False)
        session.query(models.GenerationJob).filter(models.GenerationJob.version_id.in_(version_ids)).delete(synchronize_session=False)
        session.query(models.Scenario).filter(
            models.Scenario.source_version_id.in_(version_ids) | models.Scenario.result_version_id.in_(version_ids)
        ).delete(synchronize_session=False)
        day_ids = _ids(session.query(models.SubstitutionDay.id).filter(models.SubstitutionDay.based_on_version_id.in_(version_ids)))
        if day_ids:
            session.query(models.SubstitutionCover).filter(models.SubstitutionCover.substitution_day_id.in_(day_ids)).delete(synchronize_session=False)
        session.query(models.SubstitutionDay).filter(models.SubstitutionDay.based_on_version_id.in_(version_ids)).delete(synchronize_session=False)
        session.query(models.LessonAllocation).filter(models.LessonAllocation.version_id.in_(version_ids)).delete(synchronize_session=False)
        session.query(models.ConstraintInstance).filter(models.ConstraintInstance.version_id.in_(version_ids)).delete(synchronize_session=False)
        session.query(models.TimetableVersion).filter(models.TimetableVersion.parent_version_id.in_(version_ids)).update(
            {models.TimetableVersion.parent_version_id: None},
            synchronize_session=False,
        )
        session.query(models.TimetableVersion).filter(models.TimetableVersion.id.in_(version_ids)).delete(synchronize_session=False)
    session.query(models.ConstraintInstance).filter(models.ConstraintInstance.timetable_id == template_id).delete(synchronize_session=False)
    session.delete(timetable)
    session.flush()
    if not grid_id:
        return
    if session.query(models.Timetable).filter_by(time_grid_id=grid_id).first():
        return
    _drop_grid(session, grid_id)


def keep_only_template(path: Path, template_id: str) -> None:
    """One file, one template. Drop every other template and the rows only those templates used."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app import models

    engine = create_engine(f"sqlite+pysqlite:///{Path(path).resolve().as_posix()}")
    session = sessionmaker(bind=engine)()
    try:
        if session.get(models.Timetable, template_id) is None:
            raise ValueError("Template was not found in the saved file")
        others = _ids(session.query(models.Timetable.id).filter(models.Timetable.id != template_id))
        for other_id in others:
            drop_template(session, other_id)
        _isolate_template(session, template_id)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        engine.dispose()


def _rows_except(session, model, keep: set[str]):
    query = session.query(model)
    if keep:
        query = query.filter(model.id.notin_(list(keep)))
    return query.all()


def _drop_lessons(session, lesson_ids: list[str]) -> None:
    from app import models

    if not lesson_ids:
        return
    session.query(models.LessonAllocation).filter(models.LessonAllocation.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.LessonResource).filter(models.LessonResource.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.LessonSection).filter(models.LessonSection.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.LessonGroup).filter(models.LessonGroup.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.LessonBandMember).filter(models.LessonBandMember.lesson_id.in_(lesson_ids)).delete(synchronize_session=False)
    session.query(models.Lesson).filter(models.Lesson.id.in_(lesson_ids)).delete(synchronize_session=False)


def _isolate_template(session, template_id: str) -> None:
    from app import models

    timetable = session.get(models.Timetable, template_id)
    if timetable is None:
        return
    grid_id = timetable.time_grid_id
    year_id = timetable.academic_year_id
    lessons = session.query(models.Lesson).filter(models.Lesson.time_grid_id == grid_id).all() if grid_id else []
    lesson_ids = [lesson.id for lesson in lessons]
    stray = _ids(session.query(models.Lesson.id).filter(models.Lesson.id.notin_(lesson_ids or [""])))
    if not lesson_ids:
        stray = _ids(session.query(models.Lesson.id))
    _drop_lessons(session, stray)
    section_ids = {lesson.section_id for lesson in lessons if lesson.section_id}
    subject_ids = {lesson.subject_id for lesson in lessons if lesson.subject_id}
    group_ids = {lesson.student_group_id for lesson in lessons if lesson.student_group_id}
    if lesson_ids:
        section_ids.update(
            row.section_id
            for row in session.query(models.LessonSection).filter(models.LessonSection.lesson_id.in_(lesson_ids))
        )
        group_ids.update(
            row.student_group_id
            for row in session.query(models.LessonGroup).filter(models.LessonGroup.lesson_id.in_(lesson_ids))
        )
    resource_ids = set()
    if lesson_ids:
        resource_ids.update(
            row.resource_id
            for row in session.query(models.LessonResource).filter(models.LessonResource.lesson_id.in_(lesson_ids))
        )
    for section in session.query(models.Section).filter(models.Section.id.in_(list(section_ids) or [""])).all() if section_ids else []:
        if section.class_teacher_id:
            teacher = session.get(models.Teacher, section.class_teacher_id)
            if teacher is not None:
                resource_ids.add(teacher.resource_id)
        if section.assistant_class_teacher_id:
            teacher = session.get(models.Teacher, section.assistant_class_teacher_id)
            if teacher is not None:
                resource_ids.add(teacher.resource_id)
        if section.resource_id:
            resource_ids.add(section.resource_id)
        if section.home_room_id:
            resource_ids.add(section.home_room_id)
    for row in session.query(models.Teacher).filter(models.Teacher.resource_id.in_(list(resource_ids) or [""])).all() if resource_ids else []:
        resource_ids.add(row.resource_id)
    teacher_ids = {
        row.id
        for row in (
            session.query(models.Teacher).filter(models.Teacher.resource_id.in_(list(resource_ids))).all()
            if resource_ids
            else []
        )
    }
    for group in _rows_except(session, models.StudentGroup, group_ids):
        session.delete(group)
    session.flush()
    for section in _rows_except(session, models.Section, section_ids):
        section.class_teacher_id = None
        section.assistant_class_teacher_id = None
        session.delete(section)
    session.flush()
    for link in session.query(models.TeacherSubject).all():
        if link.teacher_id not in teacher_ids or link.subject_id not in subject_ids:
            session.delete(link)
    for teacher in _rows_except(session, models.Teacher, teacher_ids):
        session.query(models.Duty).filter_by(teacher_id=teacher.id).delete(synchronize_session=False)
        session.delete(teacher)
    for subject in _rows_except(session, models.Subject, subject_ids):
        session.query(models.SubjectYear).filter_by(subject_id=subject.id).delete(synchronize_session=False)
        session.delete(subject)
    session.flush()
    if year_id:
        for year in session.query(models.AcademicYear).filter(models.AcademicYear.id != year_id).all():
            session.query(models.Term).filter_by(academic_year_id=year.id).delete(synchronize_session=False)
            session.query(models.SubjectYear).filter_by(academic_year_id=year.id).delete(synchronize_session=False)
            session.delete(year)
    used_resources = set(resource_ids)
    for section in session.query(models.Section).all():
        if section.resource_id:
            used_resources.add(section.resource_id)
    for teacher in session.query(models.Teacher).all():
        used_resources.add(teacher.resource_id)
    for group in session.query(models.StudentGroup).all():
        used_resources.add(group.resource_id)
    for room in session.query(models.Room).all():
        if room.resource_id not in used_resources:
            session.delete(room)
        else:
            used_resources.add(room.resource_id)
    session.flush()
    for resource in session.query(models.Resource).all():
        if resource.id not in used_resources:
            session.query(models.AvailabilityCell).filter_by(resource_id=resource.id).delete(synchronize_session=False)
            session.query(models.LessonResource).filter_by(resource_id=resource.id).delete(synchronize_session=False)
            session.delete(resource)
    session.flush()


def saved_folder() -> Path:
    from app.config import app_dir

    return app_dir()


def list_saved_files() -> list[dict]:
    folder = saved_folder()
    if not folder.is_dir():
        return []
    rows = []
    for path in sorted(folder.glob("*.ttl"), key=lambda item: item.name.lower()):
        if path.name.lower() == "untitled.ttl":
            continue
        rows.append({"name": path.name, "path": str(path)})
    return rows


def _create(path: Path) -> None:
    conn = sqlite3.connect(path)
    try:
        conn.execute("CREATE TABLE ttl_document (format TEXT NOT NULL, version INTEGER NOT NULL)")
        conn.execute(
            "INSERT INTO ttl_document (format, version) VALUES (?, ?)",
            (FORMAT, VERSION),
        )
        conn.commit()
    finally:
        conn.close()
