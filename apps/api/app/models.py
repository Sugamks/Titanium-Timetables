import uuid
from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def uid() -> str:
    return str(uuid.uuid4())


class AcademicYear(Base):
    __tablename__ = "academic_year"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(80))
    short_name: Mapped[Optional[str]] = mapped_column(String(16))
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    terms: Mapped[list["Term"]] = relationship(back_populates="academic_year")


class Term(Base):
    __tablename__ = "term"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    academic_year_id: Mapped[str] = mapped_column(ForeignKey("academic_year.id"))
    name: Mapped[str] = mapped_column(String(80))
    academic_year: Mapped[AcademicYear] = relationship(back_populates="terms")


class TimeGrid(Base):
    __tablename__ = "time_grid"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    academic_year_id: Mapped[Optional[str]] = mapped_column(ForeignKey("academic_year.id"))
    name: Mapped[str] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    days: Mapped[list["Day"]] = relationship(back_populates="time_grid", cascade="all, delete-orphan")
    periods: Mapped[list["Period"]] = relationship(back_populates="time_grid", cascade="all, delete-orphan")


class Day(Base):
    __tablename__ = "day"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    time_grid_id: Mapped[str] = mapped_column(ForeignKey("time_grid.id"))
    name: Mapped[str] = mapped_column(String(32))
    weekday: Mapped[int] = mapped_column(Integer)  # 0=Mon
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    custom_times: Mapped[Optional[dict]] = mapped_column(JSON, default=None)
    time_grid: Mapped[TimeGrid] = relationship(back_populates="days")


class Period(Base):
    __tablename__ = "period"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    time_grid_id: Mapped[str] = mapped_column(ForeignKey("time_grid.id"))
    name: Mapped[str] = mapped_column(String(32))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    start_time: Mapped[Optional[time]] = mapped_column(Time)
    end_time: Mapped[Optional[time]] = mapped_column(Time)
    period_type: Mapped[str] = mapped_column(String(24), default="teaching")
    time_grid: Mapped[TimeGrid] = relationship(back_populates="periods")


class WeekPattern(Base):
    __tablename__ = "week_pattern"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(24), unique=True)
    name: Mapped[str] = mapped_column(String(80))


class Resource(Base):
    __tablename__ = "resource"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    type: Mapped[str] = mapped_column(String(24))  # teacher|room|section|student_group|equipment
    name: Mapped[str] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    teacher: Mapped[Optional["Teacher"]] = relationship(back_populates="resource", uselist=False)
    room: Mapped[Optional["Room"]] = relationship(back_populates="resource", uselist=False)
    student_group: Mapped[Optional["StudentGroup"]] = relationship(back_populates="resource", uselist=False)


class Teacher(Base):
    __tablename__ = "teacher"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"), unique=True)
    department: Mapped[Optional[str]] = mapped_column(String(80))
    short_name: Mapped[Optional[str]] = mapped_column(String(16))
    contract_periods: Mapped[int] = mapped_column(Integer, default=28)
    contract_min: Mapped[int] = mapped_column(Integer, default=0)
    contract_max: Mapped[Optional[int]] = mapped_column(Integer)
    resource: Mapped[Resource] = relationship(back_populates="teacher")
    qualifications: Mapped[list["TeacherSubject"]] = relationship(cascade="all, delete-orphan")


class Room(Base):
    __tablename__ = "room"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"), unique=True)
    room_type: Mapped[Optional[str]] = mapped_column(String(40))
    capacity: Mapped[int] = mapped_column(Integer, default=30)
    building: Mapped[Optional[str]] = mapped_column(String(80))
    floor: Mapped[Optional[str]] = mapped_column(String(24))
    equipment: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    resource: Mapped[Resource] = relationship(back_populates="room")


class Section(Base):
    __tablename__ = "section"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"), unique=True)
    academic_year_id: Mapped[Optional[str]] = mapped_column(ForeignKey("academic_year.id"))
    class_name: Mapped[Optional[str]] = mapped_column(String(40))
    section_name: Mapped[Optional[str]] = mapped_column(String(16))
    short_name: Mapped[Optional[str]] = mapped_column(String(16))
    student_count: Mapped[int] = mapped_column(Integer, default=0)
    home_room_id: Mapped[Optional[str]] = mapped_column(ForeignKey("resource.id"))
    class_teacher_id: Mapped[Optional[str]] = mapped_column(ForeignKey("teacher.id"))
    assistant_class_teacher_id: Mapped[Optional[str]] = mapped_column(ForeignKey("teacher.id"))
    resource: Mapped[Resource] = relationship(foreign_keys=[resource_id])
    class_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[class_teacher_id])
    assistant_class_teacher: Mapped[Optional["Teacher"]] = relationship(foreign_keys=[assistant_class_teacher_id])
    groups: Mapped[list["StudentGroup"]] = relationship(back_populates="section")


class StudentGroup(Base):
    __tablename__ = "student_group"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"), unique=True)
    section_id: Mapped[Optional[str]] = mapped_column(ForeignKey("section.id"))
    time_grid_id: Mapped[Optional[str]] = mapped_column(ForeignKey("time_grid.id"))
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="split")  # all|split
    resource: Mapped[Resource] = relationship(back_populates="student_group")
    section: Mapped[Optional["Section"]] = relationship(back_populates="groups")


class TeacherSubject(Base):
    __tablename__ = "teacher_subject"
    __table_args__ = (UniqueConstraint("teacher_id", "subject_id", name="uq_teacher_subject"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teacher.id"))
    subject_id: Mapped[str] = mapped_column(ForeignKey("subject.id"))
    qualified: Mapped[bool] = mapped_column(Boolean, default=True)
    teacher: Mapped["Teacher"] = relationship(back_populates="qualifications")
    subject: Mapped["Subject"] = relationship()


class AvailabilityCell(Base):
    __tablename__ = "availability_cell"
    __table_args__ = (
        UniqueConstraint("resource_id", "day_id", "period_id", "week_pattern_id", name="uq_availability_slot"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"))
    day_id: Mapped[str] = mapped_column(ForeignKey("day.id"))
    period_id: Mapped[str] = mapped_column(ForeignKey("period.id"))
    week_pattern_id: Mapped[Optional[str]] = mapped_column(ForeignKey("week_pattern.id"))
    state: Mapped[str] = mapped_column(String(16), default="unavailable")  # available|unavailable|preferred|avoid
    resource: Mapped[Resource] = relationship()


class Subject(Base):
    __tablename__ = "subject"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[Optional[str]] = mapped_column(String(16))
    color: Mapped[Optional[str]] = mapped_column(String(16))
    is_difficult: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[Optional[str]] = mapped_column(String(24), default="other")


class SubjectYear(Base):
    __tablename__ = "subject_year"
    __table_args__ = (UniqueConstraint("subject_id", "academic_year_id", name="uq_subject_year"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subject.id"))
    academic_year_id: Mapped[str] = mapped_column(ForeignKey("academic_year.id"))


class Lesson(Base):
    __tablename__ = "lesson"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subject.id"))
    section_id: Mapped[Optional[str]] = mapped_column(ForeignKey("section.id"))
    student_group_id: Mapped[Optional[str]] = mapped_column(ForeignKey("student_group.id"))
    time_grid_id: Mapped[Optional[str]] = mapped_column(ForeignKey("time_grid.id"))
    term_id: Mapped[Optional[str]] = mapped_column(ForeignKey("term.id"))
    week_pattern_id: Mapped[Optional[str]] = mapped_column(ForeignKey("week_pattern.id"))
    duration_periods: Mapped[int] = mapped_column(Integer, default=1)
    frequency_per_week: Mapped[int] = mapped_column(Integer, default=1)
    lesson_type: Mapped[str] = mapped_column(String(24), default="theory")
    priority: Mapped[int] = mapped_column(Integer, default=50)
    required_room_type: Mapped[Optional[str]] = mapped_column(String(40))
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_unqualified: Mapped[bool] = mapped_column(Boolean, default=False)
    subject: Mapped[Subject] = relationship()
    section: Mapped[Optional[Section]] = relationship()
    student_group: Mapped[Optional["StudentGroup"]] = relationship()
    week_pattern: Mapped[Optional["WeekPattern"]] = relationship()
    resources: Mapped[list["LessonResource"]] = relationship(cascade="all, delete-orphan")
    section_links: Mapped[list["LessonSection"]] = relationship(cascade="all, delete-orphan")
    group_links: Mapped[list["LessonGroup"]] = relationship(cascade="all, delete-orphan")
    band_links: Mapped[list["LessonBandMember"]] = relationship(cascade="all, delete-orphan")


class LessonSection(Base):
    __tablename__ = "lesson_section"
    __table_args__ = (UniqueConstraint("lesson_id", "section_id", name="uq_lesson_section"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson.id"))
    section_id: Mapped[str] = mapped_column(ForeignKey("section.id"))
    lesson: Mapped["Lesson"] = relationship(back_populates="section_links")
    section: Mapped["Section"] = relationship()


class LessonGroup(Base):
    __tablename__ = "lesson_group"
    __table_args__ = (UniqueConstraint("lesson_id", "student_group_id", name="uq_lesson_group"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson.id"))
    student_group_id: Mapped[str] = mapped_column(ForeignKey("student_group.id"))
    lesson: Mapped["Lesson"] = relationship(back_populates="group_links")
    group: Mapped["StudentGroup"] = relationship()


class LessonBand(Base):
    __tablename__ = "lesson_band"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    members: Mapped[list["LessonBandMember"]] = relationship(back_populates="band", cascade="all, delete-orphan")


class LessonBandMember(Base):
    __tablename__ = "lesson_band_member"
    __table_args__ = (UniqueConstraint("lesson_id", name="uq_lesson_band_member_lesson"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    band_id: Mapped[str] = mapped_column(ForeignKey("lesson_band.id"))
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson.id"))
    band: Mapped["LessonBand"] = relationship(back_populates="members")
    lesson: Mapped["Lesson"] = relationship(back_populates="band_links")


class LessonResource(Base):
    __tablename__ = "lesson_resource"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson.id"))
    resource_id: Mapped[str] = mapped_column(ForeignKey("resource.id"))
    role: Mapped[str] = mapped_column(String(16), default="required")  # required|preferred
    lesson: Mapped[Lesson] = relationship(back_populates="resources")
    resource: Mapped[Resource] = relationship()


class Timetable(Base):
    __tablename__ = "timetable"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    academic_year_id: Mapped[Optional[str]] = mapped_column(ForeignKey("academic_year.id"))
    time_grid_id: Mapped[str] = mapped_column(ForeignKey("time_grid.id"))
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="inactive")
    is_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    template_type: Mapped[str] = mapped_column(String(24), default="weekly")
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    locked_version_id: Mapped[Optional[str]] = mapped_column(String(36))
    time_grid: Mapped["TimeGrid"] = relationship()
    academic_year: Mapped[Optional["AcademicYear"]] = relationship()
    versions: Mapped[list["TimetableVersion"]] = relationship(back_populates="timetable")


class TimetableVersion(Base):
    __tablename__ = "timetable_version"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    timetable_id: Mapped[str] = mapped_column(ForeignKey("timetable.id"))
    parent_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("timetable_version.id"))
    number: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="draft")
    label: Mapped[Optional[str]] = mapped_column(String(160))
    created_by: Mapped[Optional[str]] = mapped_column(String(80))
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    timetable: Mapped[Timetable] = relationship(back_populates="versions")
    allocations: Mapped[list["LessonAllocation"]] = relationship(back_populates="version", cascade="all, delete-orphan")


class LessonAllocation(Base):
    __tablename__ = "lesson_allocation"
    __table_args__ = (
        UniqueConstraint("version_id", "day_id", "period_id", "week_pattern_id", "occurrence_index", "lesson_id", name="uq_alloc_slot_lesson"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lesson.id"))
    version_id: Mapped[str] = mapped_column(ForeignKey("timetable_version.id"))
    day_id: Mapped[str] = mapped_column(ForeignKey("day.id"))
    period_id: Mapped[str] = mapped_column(ForeignKey("period.id"))
    week_pattern_id: Mapped[Optional[str]] = mapped_column(ForeignKey("week_pattern.id"))
    room_resource_id: Mapped[Optional[str]] = mapped_column(ForeignKey("resource.id"))
    occurrence_index: Mapped[int] = mapped_column(Integer, default=0)
    lock_level: Mapped[str] = mapped_column(String(24), default="none")
    version: Mapped[TimetableVersion] = relationship(back_populates="allocations")
    lesson: Mapped[Lesson] = relationship()
    day: Mapped[Day] = relationship()
    period: Mapped[Period] = relationship()


class ConstraintType(Base):
    __tablename__ = "constraint_type"
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(32))
    default_severity: Mapped[str] = mapped_column(String(8), default="soft")
    param_schema: Mapped[Optional[dict]] = mapped_column(JSON)


class ConstraintInstance(Base):
    __tablename__ = "constraint_instance"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    type_code: Mapped[str] = mapped_column(ForeignKey("constraint_type.code"))
    severity: Mapped[str] = mapped_column(String(8), default="soft")
    weight: Mapped[int] = mapped_column(Integer, default=50)
    scope: Mapped[str] = mapped_column(String(24), default="global")
    scope_id: Mapped[Optional[str]] = mapped_column(String(36))
    params: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("timetable_version.id"))
    timetable_id: Mapped[Optional[str]] = mapped_column(ForeignKey("timetable.id"))
    constraint_type: Mapped[ConstraintType] = relationship()


class Absence(Base):
    __tablename__ = "absence"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teacher.id"))
    source: Mapped[str] = mapped_column(String(16), default="adhoc")  # leave|adhoc
    on_date: Mapped[date] = mapped_column(Date)
    time_in: Mapped[Optional[time]] = mapped_column(Time)
    time_out: Mapped[Optional[time]] = mapped_column(Time)
    leave_for: Mapped[Optional[str]] = mapped_column(String(24))  # fullday|morning|noon
    teacher: Mapped[Teacher] = relationship()


class Exemption(Base):
    __tablename__ = "exemption"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teacher.id"))
    kind: Mapped[str] = mapped_column(String(16), default="full")  # full|partial
    from_date: Mapped[Optional[date]] = mapped_column(Date)
    to_date: Mapped[Optional[date]] = mapped_column(Date)
    params: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    teacher: Mapped[Teacher] = relationship()


class Duty(Base):
    __tablename__ = "duty"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    teacher_id: Mapped[str] = mapped_column(ForeignKey("teacher.id"))
    on_date: Mapped[date] = mapped_column(Date)
    period_id: Mapped[Optional[str]] = mapped_column(ForeignKey("period.id"))
    title: Mapped[str] = mapped_column(String(120), default="Duty")
    teacher: Mapped[Teacher] = relationship()


class SubstitutionDay(Base):
    __tablename__ = "substitution_day"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    on_date: Mapped[date] = mapped_column(Date)
    based_on_version_id: Mapped[str] = mapped_column(ForeignKey("timetable_version.id"))
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft|published
    covers: Mapped[list["SubstitutionCover"]] = relationship(cascade="all, delete-orphan")


class SubstitutionCover(Base):
    __tablename__ = "substitution_cover"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    substitution_day_id: Mapped[str] = mapped_column(ForeignKey("substitution_day.id"))
    absence_id: Mapped[Optional[str]] = mapped_column(ForeignKey("absence.id"))
    allocation_id: Mapped[Optional[str]] = mapped_column(ForeignKey("lesson_allocation.id"))
    day_id: Mapped[str] = mapped_column(ForeignKey("day.id"))
    period_id: Mapped[str] = mapped_column(ForeignKey("period.id"))
    absent_teacher_id: Mapped[str] = mapped_column(ForeignKey("teacher.id"))
    cover_teacher_id: Mapped[Optional[str]] = mapped_column(ForeignKey("teacher.id"))
    cover_teacher_ids: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|covered|ignored
    score: Mapped[Optional[float]] = mapped_column(Float)
    explanation: Mapped[Optional[dict]] = mapped_column(JSON)
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    updated_by: Mapped[Optional[str]] = mapped_column(String(120))
    action_note: Mapped[Optional[str]] = mapped_column(String(200))


class GenerationJob(Base):
    __tablename__ = "generation_job"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(32), default="generate")
    version_id: Mapped[str] = mapped_column(ForeignKey("timetable_version.id"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[Optional[str]] = mapped_column(String(255))
    best_score: Mapped[Optional[float]] = mapped_column(Float)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    solutions: Mapped[list["GenerationSolution"]] = relationship(cascade="all, delete-orphan")


class GenerationSolution(Base):
    __tablename__ = "generation_solution"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    job_id: Mapped[str] = mapped_column(ForeignKey("generation_job.id"))
    label: Mapped[str] = mapped_column(String(8), default="A")
    score: Mapped[float] = mapped_column(Float, default=0)
    metrics: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    allocations: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    explanation: Mapped[Optional[dict]] = mapped_column(JSON)


class Scenario(Base):
    __tablename__ = "scenario"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source_version_id: Mapped[str] = mapped_column(ForeignKey("timetable_version.id"))
    result_version_id: Mapped[Optional[str]] = mapped_column(ForeignKey("timetable_version.id"))
    name: Mapped[str] = mapped_column(String(160))
    change_spec: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)


class ChangeEvent(Base):
    __tablename__ = "change_event"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[Optional[str]] = mapped_column(String(36))
    actor: Mapped[Optional[str]] = mapped_column(String(80))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    old_value: Mapped[Optional[dict]] = mapped_column(JSON)
    new_value: Mapped[Optional[dict]] = mapped_column(JSON)
    generation_id: Mapped[Optional[str]] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AiCommand(Base):
    __tablename__ = "ai_command"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    prompt: Mapped[str] = mapped_column(Text)
    structured: Mapped[Optional[dict]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="preview")  # preview|applied|rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class LaunchCode(Base):
    __tablename__ = "launch_code"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[Optional[str]] = mapped_column(String(160))
    full_name: Mapped[Optional[str]] = mapped_column(String(160))
    privileges: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)
