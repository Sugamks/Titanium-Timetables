from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.services.staff_profile import read_profile

PRIVILEGE_ROLES = {
    "scheduler_admin": {"TIMETABLE.SETTINGS", "TIMETABLE.CAN_LOCK_UNLOCK"},
    "constructor": {
        "TIMETABLE.CREATE_TIMETABLE",
        "TIMETABLE.MODULE",
        "TIMETABLE.AUTO_ALLOCATE_TIMETABLE",
    },
    "substitutor": {"SUBSTITUTION.MODULE"},
    "viewer": {
        "TIMETABLE.MY_TIMETABLE",
        "TIMETABLE.STAFF_TIMETABLE_REPORT",
        "TIMETABLE.SECTION_TIMETABLE_REPORT",
    },
}


def map_privileges(privileges: list[str], is_super_admin: bool = False) -> list[str]:
    priv = set(privileges or [])
    roles: list[str] = []
    if is_super_admin or priv & PRIVILEGE_ROLES["scheduler_admin"]:
        roles.append("scheduler_admin")
    if priv & PRIVILEGE_ROLES["constructor"] or "scheduler_admin" in roles:
        roles.append("constructor")
    if priv & PRIVILEGE_ROLES["substitutor"] or "scheduler_admin" in roles:
        roles.append("substitutor")
    if priv & PRIVILEGE_ROLES["viewer"] or roles:
        roles.append("viewer")
    if not roles:
        roles = ["viewer"]
    # unique preserve order
    seen = set()
    out = []
    for r in roles:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _jwt_key() -> str:
    secret = (settings.jwt_secret or "").strip()
    if not secret:
        raise HTTPException(status_code=401, detail="JWT_SECRET is not set")
    return secret


def create_token(sub: str, roles: list[str], name: str = "", extra: Optional[dict] = None) -> str:
    payload = {
        "sub": sub,
        "roles": roles,
        "name": name,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _jwt_key(), algorithm="HS256")


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token.strip().strip('"'), _jwt_key(), algorithms=["HS256"])
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.") from exc
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def require_service_key(x_scheduling_key: Optional[str] = Header(default=None)):
    if x_scheduling_key != settings.scheduling_service_key:
        raise HTTPException(status_code=401, detail="Invalid service key")
    return True


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    if not authorization or not authorization.lower().startswith("bearer "):
        profile = read_profile()
        roles = profile.get("roles") or ["scheduler_admin", "constructor", "substitutor", "viewer"]
        return {
            "sub": "local",
            "name": profile.get("name") or "Staff",
            "email": profile.get("email") or None,
            "username": profile.get("username") or "",
            "roles": roles,
            "can_construct": bool(profile.get("can_construct")),
            "institution": profile.get("institution") or None,
        }
    payload = decode_token(authorization.split(" ", 1)[1])
    return payload


def require_roles(*needed: str):
    def _inner(user=Depends(get_current_user)):
        roles = set(user.get("roles") or [])
        if "scheduler_admin" in roles:
            return user
        if not roles.intersection(needed):
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user

    return _inner
