"""Clone class lessons for the selected template only."""


def section_ids_of(lesson) -> list[str]:
    links = getattr(lesson, "section_links", None) or []
    ids = []
    for ls in links:
        sid = getattr(getattr(ls, "section", None), "id", None) or getattr(ls, "section_id", None)
        if sid:
            ids.append(sid)
    if ids:
        return ids
    sid = getattr(lesson, "section_id", None)
    return [sid] if sid else []


def on_grid(lesson, time_grid_id: str | None) -> bool:
    if not time_grid_id:
        return True
    return getattr(lesson, "time_grid_id", None) == time_grid_id


def covering_section(lessons, section_id: str, time_grid_id: str | None = None) -> list:
    out = []
    seen: set = set()
    for les in lessons:
        if section_id not in section_ids_of(les):
            continue
        if not on_grid(les, time_grid_id):
            continue
        lid = getattr(les, "id", None) or id(les)
        if lid in seen:
            continue
        seen.add(lid)
        out.append(les)
    return out


def existing_keys(lessons, section_id: str, time_grid_id: str | None = None) -> set:
    return {(les.subject_id, getattr(les, "time_grid_id", None)) for les in covering_section(lessons, section_id, time_grid_id)}


def clone_decision(src, target_id: str, existing: set, skip_existing: bool) -> str:
    sids = section_ids_of(src)
    if len(sids) > 1:
        return "joined"
    if target_id in sids:
        return "existing"
    key = (src.subject_id, getattr(src, "time_grid_id", None))
    if skip_existing and key in existing:
        return "existing"
    return "clone"
