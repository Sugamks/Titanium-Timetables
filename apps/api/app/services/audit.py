"""Record who did what on the scheduling platform."""

from __future__ import annotations

from app import models


def actor_label(user: dict | None) -> str:
    if not user:
        return "Unknown"
    username = str(user.get("username") or "").strip()
    if username:
        return username[:80]
    return "Unknown"


def record_audit(
    db,
    user: dict | None,
    *,
    entity: str,
    reason: str,
    entity_id: str | None = None,
    old_value: dict | None = None,
    new_value: dict | None = None,
) -> None:
    payload = dict(new_value or {})
    if user:
        if user.get("username") and "username" not in payload:
            payload["username"] = user.get("username")
    db.add(
        models.ChangeEvent(
            entity=entity,
            entity_id=entity_id,
            actor=actor_label(user),
            reason=reason,
            old_value=old_value,
            new_value=payload or None,
        )
    )
