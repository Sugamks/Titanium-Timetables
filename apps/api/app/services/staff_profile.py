"""This computer's staff profile. The timetable file stores the username only."""

from __future__ import annotations

import json
import os
from pathlib import Path

from app.config import _API_DIR, sqlite_data_dir

_FILE = "staff_profile.json"
_ROLES = ["scheduler_admin", "constructor", "substitutor", "viewer"]


def _empty() -> dict:
    return {
        "name": "",
        "email": "",
        "username": "",
        "roles": list(_ROLES),
        "can_construct": True,
        "institution": "",
    }


def _roles(raw) -> list[str]:
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split(",")]
    picked = [role for role in _ROLES if role in (raw or [])]
    return picked or list(_ROLES)


def profile_path() -> Path:
    extra = os.environ.get("SCHEDULING_DATA_DIR", "").strip()
    root = Path(extra) if extra else sqlite_data_dir(_API_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root / _FILE


def read_profile() -> dict:
    path = profile_path()
    if not path.is_file():
        return _empty()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    roles = _roles(data.get("roles"))
    return {
        "name": str(data.get("name") or "").strip()[:80],
        "email": str(data.get("email") or "").strip()[:120],
        "username": str(data.get("username") or "").strip()[:40],
        "roles": roles,
        "can_construct": "scheduler_admin" in roles or "constructor" in roles,
        "institution": str(data.get("institution") or "").strip()[:120],
    }


def write_profile(
    name: str,
    username: str,
    email: str = "",
    institution: str = "",
    roles: list[str] | None = None,
    can_construct: bool = True,
) -> dict:
    clean_name = " ".join((name or "").split())[:80]
    clean_user = "".join((username or "").split())[:40]
    clean_email = (email or "").strip()[:120]
    if not clean_name:
        raise ValueError("Name is required")
    if not clean_user:
        raise ValueError("Username is required")
    if clean_email and ("@" not in clean_email or "." not in clean_email.split("@")[-1]):
        raise ValueError("Email is not valid")
    picked = _roles(roles)
    if can_construct and "constructor" not in picked:
        picked.insert(1, "constructor")
    if not can_construct:
        picked = [role for role in picked if role not in ("constructor", "scheduler_admin")] or ["viewer"]
    saved = {
        "name": clean_name,
        "email": clean_email,
        "username": clean_user,
        "roles": picked,
        "can_construct": "scheduler_admin" in picked or "constructor" in picked,
        "institution": " ".join((institution or "").split())[:120],
    }
    path = profile_path()
    path.write_text(json.dumps(saved), encoding="utf-8")
    return saved
