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


def _relax_not_null(bind, table: str, column: str) -> None:
    """SQLite cannot ALTER a column to nullable. Rebuild absence so room and class rows can omit a teacher."""
    if table != "absence" or column != "teacher_id":
        return
    insp = inspect(bind)
    if table not in insp.get_table_names():
        return
    col = next((c for c in insp.get_columns(table) if c["name"] == column), None)
    if not col or col.get("nullable"):
        return
    with bind.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        conn.execute(
            text(
                """
                CREATE TABLE absence__new (
                    id VARCHAR(36) PRIMARY KEY,
                    teacher_id VARCHAR(36),
                    source VARCHAR(16),
                    on_date DATE,
                    time_in TIME,
                    time_out TIME,
                    leave_for VARCHAR(24),
                    room_resource_id VARCHAR(36),
                    section_id VARCHAR(36),
                    kind VARCHAR(16),
                    reason VARCHAR(24)
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO absence__new (
                    id, teacher_id, source, on_date, time_in, time_out, leave_for,
                    room_resource_id, section_id, kind, reason
                )
                SELECT
                    id, teacher_id, source, on_date, time_in, time_out, leave_for,
                    room_resource_id, section_id, kind, reason
                FROM absence
                """
            )
        )
        conn.execute(text("DROP TABLE absence"))
        conn.execute(text("ALTER TABLE absence__new RENAME TO absence"))
        conn.execute(text("PRAGMA foreign_keys=ON"))


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
    _ensure_columns(bind, "subject", [("category", "category VARCHAR(24)"), ("is_active", "is_active BOOLEAN DEFAULT 1")])
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
            ("blocks", "blocks JSON"),
            ("allowed_room_ids", "allowed_room_ids JSON"),
        ],
    )
    _ensure_columns(
        bind,
        "absence",
        [
            ("room_resource_id", "room_resource_id VARCHAR(36)"),
            ("section_id", "section_id VARCHAR(36)"),
            ("kind", "kind VARCHAR(16)"),
            ("reason", "reason VARCHAR(24)"),
        ],
    )
    _ensure_columns(
        bind,
        "substitution_cover",
        [
            ("cover_type", "cover_type VARCHAR(16)"),
            ("target_period_id", "target_period_id VARCHAR(36)"),
            ("joined_section_id", "joined_section_id VARCHAR(36)"),
            ("cover_room_resource_id", "cover_room_resource_id VARCHAR(36)"),
        ],
    )
    _relax_not_null(bind, "absence", "teacher_id")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
