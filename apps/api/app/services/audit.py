"""Record what changed in this timetable file. The log names the record, not the login."""

from __future__ import annotations

import re

from app import models
from app.services.day_times import as_times_map
from app.services.staff_profile import read_profile
from app.services.subjects import category_label
from app.services.time_grids import break_label

_SKIP_IDS = {
    "clone",
    "replace-staff",
    "paint",
    "presets",
    "clone-class",
    "bulk",
    "pick",
    "reopen",
    "fork-edit",
    "merge",
    "versions",
    "periods",
    "purge",
    "restore",
    "times",
    "lock",
    "extend",
    "remove",
}

_LABEL = {
    "name": "name",
    "short_name": "short name",
    "department": "department",
    "is_active": "status",
    "class_name": "class",
    "section_name": "section",
    "class_teacher_id": "class teacher",
    "color": "color",
    "category_label": "category",
    "is_difficult": "difficult",
    "subject": "subject",
    "section": "class",
    "teachers": "teacher",
    "frequency_per_week": "times a week",
    "duration_periods": "periods",
    "start_time": "start",
    "end_time": "end",
    "period_type_label": "type",
    "description": "description",
    "status": "status",
    "period_count": "period count",
    "include_saturday": "Saturday",
    "include_sunday": "Sunday",
    "is_disabled": "disabled",
    "email": "email",
    "username": "username",
    "institution": "institution",
}

_WATCH = {
    "teacher": ["name", "short_name", "department", "is_active"],
    "class": ["class_name", "section_name", "short_name", "class_teacher_id", "is_active"],
    "subject": ["name", "short_name", "color", "category_label", "is_difficult", "is_active"],
    "academic year": ["name", "short_name"],
    "lesson": ["subject", "section", "teachers", "frequency_per_week", "duration_periods"],
    "bell time": ["name", "start_time", "end_time", "period_type_label"],
    "template": ["name", "description", "status", "period_count", "include_saturday", "include_sunday", "is_disabled"],
    "profile": ["name", "email", "username", "institution"],
    "class split": ["name"],
    "period group": ["name"],
}


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


def _parts(path: str) -> tuple[str, list[str]]:
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2 or parts[0] != "v1":
        return "", []
    return parts[1], parts[2:]


def _view(noun: str, label: str, fields: dict, times: dict | None = None) -> dict:
    row = {"noun": noun, "label": label or noun, "fields": fields}
    if times is not None:
        row["times"] = times
    return row


def _teacher_name(db, teacher_id: str | None) -> str:
    if not teacher_id:
        return "none"
    row = db.get(models.Teacher, teacher_id)
    if row and row.resource:
        return row.resource.name
    return "unknown"


def _resource_name(db, resource_id: str | None) -> str:
    if not resource_id:
        return "none"
    row = db.get(models.Resource, resource_id)
    return row.name if row else "unknown"


def _section_name(db, section_id: str | None) -> str:
    if not section_id:
        return "none"
    row = db.get(models.Section, section_id)
    if row and row.resource:
        return row.resource.name
    return "unknown"


def _person(db, scope: str | None, scope_id: str | None) -> str:
    if not scope_id:
        return ""
    if scope in ("section", "class"):
        name = _section_name(db, scope_id)
        return "" if name == "unknown" else name
    return _resource_name(db, scope_id) if _resource_name(db, scope_id) != "unknown" else _section_name(db, scope_id)


def _lesson_row(db, lesson_id: str | None):
    if not lesson_id:
        return None
    return (
        db.query(models.Lesson)
        .options(
            joinedload_safe(models.Lesson.subject),
            joinedload_safe(models.Lesson.resources),
            joinedload_safe(models.Lesson.section),
            joinedload_safe(models.Lesson.section_links),
        )
        .filter_by(id=lesson_id)
        .first()
    )


def joinedload_safe(attr):
    from sqlalchemy.orm import joinedload

    return joinedload(attr)


def _lesson_bits(les) -> dict | None:
    if not les:
        return None
    sections = []
    for link in les.section_links or []:
        sec = link.section
        if sec and sec.resource:
            sections.append(sec.resource.name)
    if not sections and les.section and les.section.resource:
        sections.append(les.section.resource.name)
    teachers = [
        lr.resource.name
        for lr in (les.resources or [])
        if lr.resource and lr.resource.type == "teacher"
    ]
    return {
        "subject": les.subject.name if les.subject else "",
        "section": ", ".join(sections),
        "teachers": teachers,
        "frequency_per_week": les.frequency_per_week,
        "duration_periods": les.duration_periods,
    }


def _lesson_label(fields: dict | None) -> str:
    fields = fields or {}
    subject = fields.get("subject") or "lesson"
    section = fields.get("section")
    if section:
        return f"{subject} for {section}"
    return str(subject)


def _slot(db, day_id: str | None, period_id: str | None) -> str:
    day = db.get(models.Day, day_id) if day_id else None
    period = db.get(models.Period, period_id) if period_id else None
    return " ".join(part for part in (day.name if day else "", period.name if period else "") if part)


def snapshot_for_audit(db, path: str) -> dict | None:
    resource, extra = _parts(path)
    if resource == "profile":
        data = read_profile()
        fields = {key: data.get(key) or "" for key in _WATCH["profile"]}
        return _view("profile", fields.get("name") or "profile", fields)
    if not extra or extra[0] in _SKIP_IDS:
        return None
    ident = extra[0]
    if resource == "teachers":
        row = db.get(models.Teacher, ident)
        if not row:
            return None
        return _view(
            "teacher",
            row.resource.name if row.resource else "teacher",
            {
                "name": row.resource.name if row.resource else "",
                "short_name": row.short_name or "",
                "department": row.department or "",
                "is_active": row.resource.is_active is not False if row.resource else True,
            },
        )
    if resource == "sections":
        row = db.get(models.Section, ident)
        if not row:
            return None
        return _view(
            "class",
            row.resource.name if row.resource else "class",
            {
                "class_name": row.class_name or "",
                "section_name": row.section_name or "",
                "short_name": row.short_name or "",
                "class_teacher_id": row.class_teacher_id or "",
                "is_active": row.resource.is_active is not False if row.resource else True,
            },
        )
    if resource == "subjects":
        row = db.get(models.Subject, ident)
        if not row:
            return None
        return _view(
            "subject",
            row.name,
            {
                "name": row.name,
                "short_name": row.short_name or "",
                "color": row.color or "",
                "category_label": category_label(row.category),
                "is_difficult": bool(row.is_difficult),
                "is_active": row.is_active is not False,
            },
        )
    if resource == "years":
        row = db.get(models.AcademicYear, ident)
        if not row:
            return None
        return _view("academic year", row.name, {"name": row.name, "short_name": row.short_name or ""})
    if resource == "lessons":
        bits = _lesson_bits(_lesson_row(db, ident))
        if not bits:
            return None
        return _view("lesson", _lesson_label(bits), bits)
    if resource == "periods":
        row = db.get(models.Period, ident)
        if not row:
            return None
        return _view(
            "bell time",
            row.name,
            {
                "name": row.name,
                "start_time": str(row.start_time)[:5] if row.start_time else "",
                "end_time": str(row.end_time)[:5] if row.end_time else "",
                "period_type_label": break_label(row.period_type),
            },
        )
    if resource == "days":
        row = db.get(models.Day, ident)
        if not row:
            return None
        return _view("bell time", row.name, {"name": row.name}, as_times_map(row.custom_times))
    if resource == "timetables":
        row = db.get(models.Timetable, ident)
        if not row:
            return None
        grid = db.get(models.TimeGrid, row.time_grid_id)
        days = list(grid.days) if grid else []
        periods = list(grid.periods) if grid else []
        return _view(
            "template",
            row.name,
            {
                "name": row.name,
                "description": row.description or "",
                "status": row.status or "",
                "period_count": len(periods),
                "include_saturday": any(d.weekday == 5 for d in days),
                "include_sunday": any(d.weekday == 6 for d in days),
                "is_disabled": bool(row.is_disabled),
            },
        )
    if resource == "groups":
        row = db.get(models.StudentGroup, ident)
        if not row:
            return None
        where = _section_name(db, row.section_id)
        label = f"{row.name} in {where}" if where not in ("", "none", "unknown") else row.name
        return _view("class split", label, {"name": row.name})
    if resource == "bands":
        row = db.get(models.LessonBand, ident)
        if not row:
            return None
        return _view("period group", row.name, {"name": row.name})
    if resource == "constraints":
        row = db.get(models.ConstraintInstance, ident)
        if not row:
            return None
        kind = db.get(models.ConstraintType, row.type_code)
        title = kind.name if kind else row.type_code
        who = _person(db, row.scope, row.scope_id)
        return _view("constraint", f"{title} for {who}" if who and who != "unknown" else title, {})
    if resource == "allocations":
        row = db.get(models.LessonAllocation, ident)
        if not row:
            return None
        bits = _lesson_bits(_lesson_row(db, row.lesson_id))
        slot = _slot(db, row.day_id, row.period_id)
        label = _lesson_label(bits)
        if slot:
            label = f"{label} on {slot}"
        return _view("lesson", label, bits or {})
    return None


def _blank(value) -> str:
    if value is None or value == "":
        return "none"
    return str(value)


def _show(db, key: str, value) -> str:
    if key == "is_active":
        return "Active" if value is not False else "Inactive"
    if key in ("is_difficult", "include_saturday", "include_sunday", "is_disabled"):
        return "yes" if value else "no"
    if key == "class_teacher_id":
        return _teacher_name(db, value or None)
    if key == "teachers":
        if isinstance(value, list) and value:
            return ", ".join(str(item) for item in value)
        return "none"
    return _blank(value)


def _norm(key: str, value):
    if key == "is_active":
        return value is not False
    if key in ("is_difficult", "include_saturday", "include_sunday", "is_disabled"):
        return bool(value)
    if key == "teachers":
        if isinstance(value, list):
            return tuple(sorted(str(item) for item in value))
        return tuple()
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return value


def _same(key: str, old, new) -> bool:
    return _norm(key, old) == _norm(key, new)


def _with_bits(head: str, bits: list[str]) -> str:
    if bits:
        return head + ": " + ", ".join(bits)
    return head


def _added(db, resource: str, result: dict) -> str | None:
    if resource == "teachers" and result.get("name"):
        bits = []
        if result.get("department"):
            bits.append(f"department {result['department']}")
        if result.get("short_name"):
            bits.append(f"short name {result['short_name']}")
        if result.get("is_active") is False:
            bits.append("status Inactive")
        return _with_bits(f"Added teacher {result['name']}", bits)
    if resource == "sections" and result.get("name"):
        bits = []
        if result.get("class_teacher_id"):
            bits.append(f"class teacher {_teacher_name(db, result['class_teacher_id'])}")
        if result.get("short_name"):
            bits.append(f"short name {result['short_name']}")
        return _with_bits(f"Added class {result['name']}", bits)
    if resource == "subjects" and result.get("name"):
        bits = []
        if result.get("short_name"):
            bits.append(f"short name {result['short_name']}")
        if result.get("category_label"):
            bits.append(f"category {result['category_label']}")
        return _with_bits(f"Added subject {result['name']}", bits)
    if resource == "years" and result.get("name"):
        bits = [f"short name {result['short_name']}"] if result.get("short_name") else []
        return _with_bits(f"Added academic year {result['name']}", bits)
    if resource == "lessons" and result.get("subject"):
        bits = []
        teachers = result.get("teachers") or []
        if teachers:
            bits.append("teacher " + ", ".join(teachers))
        if result.get("frequency_per_week"):
            bits.append(f"{result['frequency_per_week']} times a week")
        if result.get("duration_periods") not in (None, 1):
            bits.append(f"{result['duration_periods']} periods")
        return _with_bits(f"Added lesson {_lesson_label(result)}", bits)
    if resource == "groups" and result.get("name"):
        where = _section_name(db, result.get("section_id"))
        label = result["name"] if where in ("", "none", "unknown") else f"{result['name']} in {where}"
        return f"Added class split {label}"
    if resource == "bands" and result.get("name"):
        return f"Added period group {result['name']}"
    if resource == "timetables" and result.get("name"):
        return f"Added template {result['name']}"
    if resource == "periods" and result.get("name"):
        start = result.get("start_time") or "none"
        end = result.get("end_time") or "none"
        return f"Added bell time {result['name']}: {start} to {end}"
    if resource == "constraints":
        return None
    return None


def _updated(db, before: dict, result: dict) -> str:
    noun = before.get("noun") or "item"
    label = before.get("label") or noun
    changes = []
    for key in _WATCH.get(noun, []):
        if key not in result:
            continue
        old = (before.get("fields") or {}).get(key)
        new = result.get(key)
        if _same(key, old, new):
            continue
        changes.append(f"{_LABEL.get(key, key)} {_show(db, key, old)} to {_show(db, key, new)}")
    if changes:
        return f"Updated {noun} {label}: " + ", ".join(changes)
    return f"Updated {noun} {label}"


def _template_name(db, version_id: str | None) -> str:
    if not version_id:
        return ""
    row = db.get(models.TimetableVersion, version_id)
    if row and row.timetable:
        return row.timetable.name
    return ""


def _day_times(db, before: dict, body: dict) -> str:
    day_name = before.get("label") or "a day"
    old_map = before.get("times") or {}
    changes = []
    for pid, spec in (body.get("times") or {}).items():
        period = db.get(models.Period, pid)
        pname = period.name if period else "period"
        old = old_map.get(str(pid)) or {}
        if spec is None:
            if old:
                changes.append(f"{pname} cleared")
            continue
        new = as_times_map({pid: spec}).get(str(pid), {})
        bits = []
        if (old.get("start_time") or None) != (new.get("start_time") or None):
            bits.append(f"start {_blank(old.get('start_time'))} to {_blank(new.get('start_time'))}")
        if (old.get("end_time") or None) != (new.get("end_time") or None):
            bits.append(f"end {_blank(old.get('end_time'))} to {_blank(new.get('end_time'))}")
        if bits:
            changes.append(f"{pname} " + ", ".join(bits))
    if not changes:
        return f"Updated bell times for {day_name}"
    return f"Updated bell times for {day_name}: " + "; ".join(changes)


def _special(db, method: str, resource: str, extra: list[str], body: dict, result: dict, before: dict | None) -> str | None:
    if resource == "document" and extra[:1] == ["pick"]:
        name = (result.get("name") or "").strip()
        return f"Saved timetable file {name}" if name else "Saved the timetable file"
    if resource == "document" and extra[:1] == ["reopen"]:
        name = (result.get("name") or "").strip()
        return f"Opened timetable file {name}" if name else "Opened a timetable file"
    if resource == "designer" and extra[:1] == ["cell-group"]:
        return "Saved a subject group on the week"
    if resource == "lessons" and extra[:1] == ["clone"]:
        source = _section_name(db, body.get("source_section_id"))
        if source in ("", "none", "unknown") and body.get("lesson_id"):
            bits = _lesson_bits(_lesson_row(db, body.get("lesson_id")))
            source = _lesson_label(bits)
        targets = [_section_name(db, sid) for sid in (body.get("target_section_ids") or [])]
        targets = [name for name in targets if name not in ("", "none", "unknown")]
        into = ", ".join(targets) if targets else ""
        if source in ("", "none", "unknown") and not into:
            return "Cloned lessons into other classes"
        if source in ("", "none", "unknown"):
            return f"Cloned lessons into {into}"
        if not into:
            return f"Cloned lessons from {source}"
        return f"Cloned lessons from {source} into {into}"
    if resource == "lessons" and extra[:1] == ["replace-staff"]:
        src = _resource_name(db, body.get("from_resource_id"))
        dest = _resource_name(db, body.get("to_resource_id"))
        count = result.get("updated")
        if count is None:
            return f"Replaced teacher {src} with {dest}"
        return f"Replaced teacher {src} with {dest} on {count} lessons"
    if resource == "constraints" and extra[:1] == ["paint"]:
        who = _resource_name(db, body.get("id"))
        if who == "unknown":
            who = _section_name(db, body.get("id"))
        slot = _slot(db, body.get("day_id"), body.get("period_id"))
        mode = result.get("mode") or body.get("mode") or "painted"
        return f"Painted {who} on {slot}: {mode}"
    if resource == "constraints" and extra[:1] == ["clone-class"]:
        source = _section_name(db, body.get("source_section_id"))
        targets = [_section_name(db, sid) for sid in (body.get("target_section_ids") or [])]
        targets = [name for name in targets if name not in ("", "unknown")]
        into = ", ".join(targets) if targets else "the chosen classes"
        return f"Cloned constraints from {source} into {into}"
    if resource == "constraints" and extra[:1] == ["presets"]:
        who = _resource_name(db, body.get("teacher_resource_id"))
        if who == "unknown":
            who = _section_name(db, body.get("section_id"))
        code = body.get("code") or "preset"
        if who not in ("", "none", "unknown"):
            return f"Applied constraint preset {code} for {who}"
        return f"Applied constraint preset {code}"
    if resource == "constraints" and method == "POST" and not extra:
        kind = db.get(models.ConstraintType, body.get("type_code"))
        title = kind.name if kind else (body.get("type_code") or "constraint")
        who = _person(db, body.get("scope"), body.get("scope_id"))
        if who and who != "unknown":
            return f"Added constraint {title} for {who}"
        return f"Added constraint {title}"
    if resource == "days" and "times" in extra and before:
        return _day_times(db, before, body)
    if resource == "allocations" and method == "POST" and not extra:
        bits = _lesson_bits(_lesson_row(db, body.get("lesson_id")))
        slot = _slot(db, body.get("day_id"), body.get("period_id"))
        label = _lesson_label(bits)
        if body.get("allocation_id"):
            return f"Moved {label} to {slot}" if slot else f"Moved {label}"
        return f"Placed {label} on {slot}" if slot else f"Placed {label}"
    if resource == "allocations" and "lock" in extra:
        level = body.get("lock_level") or result.get("lock_level")
        label = (before or {}).get("label") or "a lesson"
        if level in (None, "", "none"):
            return f"Unlocked {label}"
        return f"Locked {label}"
    if resource == "allocations" and method == "DELETE" and before:
        return f"Removed {before.get('label') or 'a lesson'}"
    if resource == "generate":
        name = _template_name(db, body.get("version_id"))
        return f"Generated timetable {name}" if name else "Generated a timetable"
    if resource == "repair":
        name = _template_name(db, body.get("version_id"))
        return f"Repaired timetable {name}" if name else "Repaired a timetable"
    if resource in ("publish", "save", "go-live", "versions") and extra:
        name = _template_name(db, extra[0])
        if resource == "go-live":
            verb = "Published"
        elif resource == "versions":
            verb = "Approved"
        else:
            verb = "Saved"
        return f"{verb} timetable {name}" if name else f"{verb} a timetable"
    if resource == "timetables" and "clone" in extra and before:
        return f"Cloned template {before.get('label') or 'template'}"
    if resource == "timetables" and "restore" in extra and before:
        return f"Restored template {before.get('label') or 'template'}"
    if resource == "timetables" and "purge" in extra and before:
        return f"Deleted template {before.get('label') or 'template'}"
    if resource == "profile" and method in ("PUT", "PATCH") and before:
        return _updated(db, before, result)
    return None


def _fallback(method: str, path: str) -> str:
    parts = [p for p in path.split("/") if p and p != "v1"]
    head = parts[0] if parts else "item"
    nouns = {
        "teachers": "teacher",
        "sections": "class",
        "subjects": "subject",
        "lessons": "lesson",
        "years": "academic year",
        "timetables": "template",
        "periods": "bell time",
        "constraints": "constraint",
        "bands": "period group",
        "groups": "class split",
        "profile": "profile",
        "document": "timetable file",
        "days": "bell time",
        "operations": "substitution",
        "allocations": "lesson",
        "rooms": "room",
        "designer": "card",
    }
    noun = nouns.get(head, head.replace("-", " "))
    verb = {"POST": "Added", "PUT": "Updated", "PATCH": "Updated", "DELETE": "Deleted"}.get(method, "Changed")
    return f"{verb} {noun}"


def describe_mutation(
    db,
    method: str,
    path: str,
    body: dict | None,
    result: dict | None,
    before: dict | None,
) -> str:
    body = body or {}
    result = result or {}
    resource, extra = _parts(path)
    text = _special(db, method, resource, extra, body, result, before)
    if not text and method == "DELETE" and before:
        text = f"Deleted {before.get('noun') or 'item'} {before.get('label') or ''}".strip()
    if not text and method == "POST":
        text = _added(db, resource, result)
    if not text and method in ("PATCH", "PUT") and before:
        text = _updated(db, before, result)
    if not text:
        text = _fallback(method, path)
    return text[:500]


_HTTP_REASON = re.compile(r"^(GET|POST|PUT|PATCH|DELETE)\s+(/v1/\S+)")
_NOISE_PREFIXES = ("/v1/generate", "/v1/repair", "/v1/jobs/", "/v1/impact", "/v1/preview")


def present_audit_reason(db, reason: str | None) -> str | None:
    """Turn a stored log line into a sentence. Drop calls that did not change a record."""
    text = (reason or "").strip()
    if not text:
        return None
    if text in ("Added designer", "Updated designer", "Deleted designer"):
        return None
    if text == "Saved timetable file timetable file":
        return "Saved the timetable file"
    match = _HTTP_REASON.match(text)
    if not match:
        if text.lower().startswith("apply solution "):
            return "Applied solution " + text.split(" ", 2)[2]
        return text
    path = match.group(2).split("?", 1)[0]
    if path.startswith(_NOISE_PREFIXES):
        return None
    method = match.group(1)
    before = None
    if method in ("PATCH", "PUT", "DELETE"):
        try:
            before = snapshot_for_audit(db, path)
        except Exception:
            before = None
    sentence = describe_mutation(db, method, path, {}, {}, before)
    if not sentence or _HTTP_REASON.match(sentence):
        return None
    return sentence
