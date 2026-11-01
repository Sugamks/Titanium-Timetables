"""School name stored beside the timetable file."""

from pathlib import Path

from app.config import settings


def institution_from_file() -> str | None:
    url = settings.database_url or ""
    if "sqlite" not in url or "///" not in url:
        return None
    path = Path(url.split("///", 1)[-1]).with_name("institution.txt")
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def institution_name() -> str | None:
    from app.services.staff_profile import read_profile

    name = (read_profile().get("institution") or "").strip()
    return name or institution_from_file()
