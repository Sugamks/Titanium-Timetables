from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    pass


connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, echo=False, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _ensure_columns(bind, table: str, specs: list[tuple[str, str]]) -> None:
    insp = inspect(bind)
    if table not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns(table)}
    for name, ddl in specs:
        if name in cols:
            continue
        with bind.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def ensure_schema(bind=engine) -> None:
    """Add columns that create_all will not attach to an existing SQLite file."""
    _ensure_columns(bind, "section", [("academic_year_id", "academic_year_id VARCHAR(36)")])
    _ensure_columns(
        bind,
        "timetable",
        [
            ("description", "description TEXT"),
            ("status", "status VARCHAR(24)"),
            ("is_disabled", "is_disabled BOOLEAN"),
            ("template_type", "template_type VARCHAR(24)"),
            ("deleted_at", "deleted_at DATETIME"),
        ],
    )
    _ensure_columns(
        bind,
        "student_group",
        [
            ("section_id", "section_id VARCHAR(36)"),
            ("kind", "kind VARCHAR(16)"),
            ("time_grid_id", "time_grid_id VARCHAR(36)"),
        ],
    )
    _ensure_columns(bind, "teacher", [("contract_min", "contract_min INTEGER"), ("contract_max", "contract_max INTEGER")])
    _ensure_columns(bind, "section", [("home_room_id", "home_room_id VARCHAR(36)")])
    _ensure_columns(
        bind,
        "section",
        [
            ("class_teacher_id", "class_teacher_id VARCHAR(36)"),
            ("assistant_class_teacher_id", "assistant_class_teacher_id VARCHAR(36)"),
        ],
    )
    _ensure_columns(bind, "subject", [("category", "category VARCHAR(24)")])
    _ensure_columns(bind, "academic_year", [("short_name", "short_name VARCHAR(16)")])
    _ensure_columns(bind, "teacher", [("short_name", "short_name VARCHAR(16)")])
    _ensure_columns(bind, "section", [("short_name", "short_name VARCHAR(16)")])
    _ensure_columns(bind, "constraint_instance", [("timetable_id", "timetable_id VARCHAR(36)")])
    _ensure_columns(bind, "day", [("custom_times", "custom_times JSON")])
    _ensure_columns(bind, "timetable", [("locked_version_id", "locked_version_id VARCHAR(36)")])
    _ensure_columns(
        bind,
        "exemption",
        [
            ("from_date", "from_date DATE"),
            ("to_date", "to_date DATE"),
        ],
    )
    _ensure_columns(
        bind,
        "substitution_cover",
        [
            ("absence_id", "absence_id VARCHAR(36)"),
            ("cover_teacher_ids", "cover_teacher_ids JSON"),
            ("updated_at", "updated_at DATETIME"),
            ("updated_by", "updated_by VARCHAR(120)"),
            ("action_note", "action_note VARCHAR(200)"),
        ],
    )
    _ensure_columns(
        bind,
        "lesson",
        [
            ("priority", "priority INTEGER"),
            ("required_room_type", "required_room_type VARCHAR(40)"),
            ("locked", "locked BOOLEAN"),
            ("allow_unqualified", "allow_unqualified BOOLEAN"),
        ],
    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
