import json


def _hhmm(value) -> str | None:
    if value is None or value == "":
        return None
    text = str(value)
    return text[:5] if len(text) >= 5 else text


def as_times_map(raw) -> dict[str, dict[str, str | None]]:
    if not raw:
        return {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, str | None]] = {}
    for pid, spec in raw.items():
        if not isinstance(spec, dict):
            continue
        out[str(pid)] = {
            "start_time": _hhmm(spec.get("start_time")),
            "end_time": _hhmm(spec.get("end_time")),
        }
    return out


def day_payload(day) -> dict:
    return {
        "id": day.id,
        "name": day.name,
        "weekday": getattr(day, "weekday", None),
        "sort_order": getattr(day, "sort_order", 0),
        "custom_times": as_times_map(getattr(day, "custom_times", None)),
    }
