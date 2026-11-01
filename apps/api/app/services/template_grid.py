"""Resolve the time grid that belongs to a timetable template."""


def pick_time_grid_id(templates, template_id: str | None, year_id: str | None = None):
    for t in templates or []:
        if getattr(t, "id", None) == template_id:
            return getattr(t, "time_grid_id", None)
    year_ones = [
        t
        for t in (templates or [])
        if not year_id or getattr(t, "academic_year_id", None) == year_id
    ]
    if year_ones:
        return getattr(year_ones[0], "time_grid_id", None)
    return None
