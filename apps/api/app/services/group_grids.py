"""Period groups and class splits belong to a timetable template."""


def band_time_grid_ids(band) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    stored = getattr(band, "time_grid_id", None)
    if stored:
        seen.add(stored)
        ids.append(stored)
    for link in getattr(band, "members", None) or []:
        les = getattr(link, "lesson", None)
        gid = getattr(les, "time_grid_id", None) if les else None
        if gid and gid not in seen:
            seen.add(gid)
            ids.append(gid)
    return ids


def band_on_grid(band, time_grid_id: str | None) -> bool:
    if not time_grid_id:
        return True
    return time_grid_id in band_time_grid_ids(band)


def split_on_grid(group, time_grid_id: str | None, lesson_group_ids_on_grid: set | None = None) -> bool:
    if not time_grid_id:
        return True
    owned = getattr(group, "time_grid_id", None)
    if owned:
        return owned == time_grid_id
    if lesson_group_ids_on_grid is None:
        return False
    return getattr(group, "id", None) in lesson_group_ids_on_grid
