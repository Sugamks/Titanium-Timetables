from collections import defaultdict
from io import BytesIO
import re

from sqlalchemy.orm import Session, joinedload

from app import models
from app.engine.conflicts import teacher_of
from app.engine.occupancy import allocation_class_fields, duration_block, teaching_periods


def _latest_version(db: Session, version_id: str | None = None, academic_year_id: str | None = None):
    if version_id:
        v = db.get(models.TimetableVersion, version_id)
        if v and not (v.timetable and v.timetable.deleted_at):
            return v
    q = (
        db.query(models.TimetableVersion)
        .join(models.Timetable, models.Timetable.id == models.TimetableVersion.timetable_id)
        .filter(models.Timetable.deleted_at.is_(None))
    )
    if academic_year_id:
        q = q.filter(models.Timetable.academic_year_id == academic_year_id)
    return q.order_by(models.TimetableVersion.created_at.desc()).first()


def _alloc_rows(db: Session, v: models.TimetableVersion) -> tuple[list[dict], list, list]:
    grid_id = v.timetable.time_grid_id
    days = db.query(models.Day).filter_by(time_grid_id=grid_id).order_by(models.Day.sort_order).all()
    periods = db.query(models.Period).filter_by(time_grid_id=grid_id).order_by(models.Period.sort_order).all()
    teaching = teaching_periods(periods)
    rooms = {r.resource_id: (r.resource.name if r.resource else "") for r in db.query(models.Room).all()}
    rows = []
    for a in v.allocations:
        les = a.lesson
        if not les:
            continue
        t = teacher_of(les)
        dur = max(1, les.duration_periods or 1)
        block = duration_block(teaching, a.period_id, dur)
        period_ids = [p.id for p in block] if block else [a.period_id]
        classes = allocation_class_fields(les)
        base = {
            "id": a.id,
            "lesson_id": a.lesson_id,
            "day_id": a.day_id,
            "period_id": a.period_id,
            "period_ids": period_ids,
            "subject": les.subject.name if les.subject else "",
            "short": (les.subject.short_name or les.subject.name) if les.subject else "",
            "color": (les.subject.color if les.subject else None) or "#64748b",
            "section": classes["section"],
            "sections": classes["sections"],
            "teacher": t.name if t else "",
            "room": rooms.get(a.room_resource_id) or "",
        }
        for pid in period_ids:
            rows.append({**base, "period_id": pid})
    return rows, days, periods


def _row_keys(row: dict, key: str) -> list[str]:
    if key == "section":
        names = row.get("sections") or [s.strip() for s in (row.get("section") or "").split(",")]
        return [n for n in names if n]
    name = (row.get(key) or "").strip()
    return [name] if name else []


def _group_cards(rows: list[dict], key: str) -> list[dict]:
    by: dict[str, dict] = {}
    for row in rows:
        for name in _row_keys(row, key):
            slot = f"{row['day_id']}|{row['period_id']}"
            entry = by.setdefault(name, {"name": name, "cells": defaultdict(list)})
            entry["cells"][slot].append(
                {
                    "subject": row["subject"],
                    "short": row["short"],
                    "section": row["section"],
                    "teacher": row["teacher"],
                    "room": row["room"],
                    "color": row["color"],
                }
            )
    out = []
    for name in sorted(by):
        cells = {k: v for k, v in by[name]["cells"].items()}
        out.append({"name": name, "placed": sum(len(v) for v in cells.values()), "cells": cells})
    return out


def timetable_report(db: Session, version_id: str | None = None, academic_year_id: str | None = None) -> dict:
    v = _latest_version(db, version_id, academic_year_id)
    if not v:
        return {"ok": False, "error": "No timetable version yet. Generate first.", "days": [], "periods": []}
    rows, days, periods = _alloc_rows(db, v)
    lessons = (
        db.query(models.Lesson)
        .options(
            joinedload(models.Lesson.resources),
            joinedload(models.Lesson.subject),
            joinedload(models.Lesson.section),
            joinedload(models.Lesson.section_links),
        )
        .all()
    )
    if academic_year_id:
        filtered = []
        for les in lessons:
            year_id = les.section.academic_year_id if les.section else None
            if year_id == academic_year_id:
                filtered.append(les)
        lessons = filtered
    placed = defaultdict(int)
    for row in rows:
        placed[row["lesson_id"]] += 1
    unplaced = []
    class_need: dict[str, int] = defaultdict(int)
    teacher_need: dict[str, int] = defaultdict(int)
    for les in lessons:
        need = (les.frequency_per_week or 0) * max(1, les.duration_periods or 1)
        have = placed.get(les.id, 0)
        t = teacher_of(les)
        classes = allocation_class_fields(les)
        section = classes["section"]
        for name in classes["sections"]:
            class_need[name] += need
        if t:
            teacher_need[t.name] += need
        if have < need:
            unplaced.append(
                {
                    "id": les.id,
                    "subject": les.subject.name if les.subject else "",
                    "section": section,
                    "teacher": t.name if t else "",
                    "need": les.frequency_per_week,
                    "placed": have,
                    "missing": max(0, les.frequency_per_week - (have // max(1, les.duration_periods or 1))),
                }
            )
    teaching_slots = sum(1 for p in periods if (p.period_type or "teaching") == "teaching") * max(1, len(days))
    section_groups = _group_cards(rows, "section")
    teacher_groups = _group_cards(rows, "teacher")
    placed_by_teacher = {g["name"]: g["placed"] for g in teacher_groups}
    placed_by_section = {g["name"]: g["placed"] for g in section_groups}
    teacher_load = [
        {
            "name": name,
            "required": need,
            "placed": placed_by_teacher.get(name, 0),
            "free": max(0, teaching_slots - placed_by_teacher.get(name, 0)),
        }
        for name, need in sorted(teacher_need.items())
    ]
    class_load = [
        {
            "name": name,
            "required": need,
            "placed": placed_by_section.get(name, 0),
            "free": max(0, teaching_slots - placed_by_section.get(name, 0)),
        }
        for name, need in sorted(class_need.items())
    ]

    return {
        "ok": True,
        "version": {
            "id": v.id,
            "number": v.number,
            "status": v.status,
            "label": v.label,
            "timetable": v.timetable.name if v.timetable else "",
        },
        "days": [{"id": d.id, "name": d.name} for d in days],
        "periods": [
            {
                "id": p.id,
                "name": p.name,
                "period_type": p.period_type or "teaching",
                "start_time": str(p.start_time)[:5] if p.start_time else None,
            }
            for p in periods
        ],
        "sections": section_groups,
        "teachers": teacher_groups,
        "rooms": _group_cards(rows, "room"),
        "subjects": _group_cards(rows, "subject"),
        "unplaced": unplaced,
        "teacher_load": teacher_load,
        "class_load": class_load,
        "teaching_slots": teaching_slots,
    }


def timetable_report_html(data: dict, view: str = "section", entity: str | None = None) -> str:
    days = data.get("days") or []
    periods = data.get("periods") or []
    groups = {
        "section": data.get("sections") or [],
        "teacher": data.get("teachers") or [],
        "room": data.get("rooms") or [],
        "subject": data.get("subjects") or [],
    }.get(view, data.get("sections") or [])
    if entity:
        groups = [g for g in groups if g["name"] == entity]
    title = (data.get("version") or {}).get("timetable") or "Timetable"
    chunks = [
        "<html><head><meta charset='utf-8'><title>",
        title,
        "</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px}h2{margin:24px 0 8px}",
        "table{border-collapse:collapse;width:100%;margin-bottom:24px;font-size:12px}",
        "th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top}th{background:#f8fafc}",
        ".card{padding:4px 6px;margin:2px 0;border-radius:4px;color:#fff;font-weight:600}",
        "@media print{button{display:none}}</style></head><body>",
        f"<h1>{title}</h1><p>View: {view.title()}</p>",
    ]
    if view == "unplaced":
        chunks.append("<table><thead><tr><th>Subject</th><th>Class</th><th>Teacher</th><th>Missing</th></tr></thead><tbody>")
        for u in data.get("unplaced") or []:
            chunks.append(
                f"<tr><td>{u.get('subject','')}</td><td>{u.get('section','')}</td><td>{u.get('teacher','')}</td><td>{u.get('missing',0)}</td></tr>"
            )
        chunks.append("</tbody></table></body></html>")
        return "".join(chunks)
    if view in ("teacher_load", "class_load"):
        rows = data.get(view) or []
        chunks.append("<table><thead><tr><th>Name</th><th>Placed</th><th>Required</th><th>Free slots</th></tr></thead><tbody>")
        for r in rows:
            chunks.append(
                f"<tr><td>{r.get('name','')}</td><td>{r.get('placed',0)}</td><td>{r.get('required',0)}</td><td>{r.get('free',0)}</td></tr>"
            )
        chunks.append("</tbody></table></body></html>")
        return "".join(chunks)
    if not groups:
        chunks.append("<p>No placements for this view yet.</p></body></html>")
        return "".join(chunks)
    for g in groups:
        chunks.append(f"<h2>{g['name']}</h2><table><thead><tr><th>Period</th>")
        for d in days:
            chunks.append(f"<th>{d['name']}</th>")
        chunks.append("</tr></thead><tbody>")
        for p in periods:
            chunks.append(f"<tr><th>{p['name']}</th>")
            for d in days:
                cards = (g.get("cells") or {}).get(f"{d['id']}|{p['id']}", [])
                inner = "".join(
                    f"<div class='card' style='background:{c.get('color') or '#64748b'}'>{c.get('short') or c.get('subject')} · {c.get('section') or c.get('teacher')}</div>"
                    for c in cards
                )
                chunks.append(f"<td>{inner}</td>")
            chunks.append("</tr>")
        chunks.append("</tbody></table>")
    chunks.append("</body></html>")
    return "".join(chunks)


def _sheet_name(name: str, used: set[str]) -> str:
    raw = re.sub(r"[:\\/?*\[\]]", " ", (name or "Sheet")).strip() or "Sheet"
    base = raw[:31]
    candidate = base
    n = 2
    while candidate.lower() in used:
        suffix = f" {n}"
        candidate = (base[: 31 - len(suffix)] + suffix)
        n += 1
    used.add(candidate.lower())
    return candidate


def _hex6(color: str | None) -> str:
    raw = (color or "64748B").lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in raw):
        return "64748B"
    return raw.upper()


def _contrast_font(hex6: str) -> str:
    r, g, b = int(hex6[0:2], 16), int(hex6[2:4], 16), int(hex6[4:6], 16)
    return "FFFFFF" if (0.299 * r + 0.587 * g + 0.114 * b) < 155 else "111111"


def _card_code(card: dict) -> str:
    return (card.get("short") or card.get("subject") or "").strip()


def _matrix_cell_text(cards: list[dict], view: str) -> str:
    blocks: list[str] = []
    for card in cards:
        subject = (card.get("subject") or card.get("short") or "").strip()
        short = (card.get("short") or "").strip()
        title = subject
        if short and subject and short.lower() != subject.lower():
            title = f"{short}  {subject}"
        extras: list[str] = []
        if view == "teacher":
            if card.get("section"):
                extras.append(card["section"])
        elif view == "section":
            if card.get("teacher"):
                extras.append(card["teacher"])
        else:
            if card.get("section"):
                extras.append(card["section"])
            if card.get("teacher"):
                extras.append(card["teacher"])
        if card.get("room"):
            extras.append(card["room"])
        blocks.append("\n".join([title, *extras]) if title or extras else "")
    return "\n\n".join(b for b in blocks if b)


def _view_title(view: str) -> str:
    return {
        "section": "Class timetable",
        "teacher": "Staff timetable",
        "room": "Classroom timetable",
        "subject": "Subject timetable",
        "unplaced": "Unplaced lessons",
        "teacher_load": "Teacher load",
        "class_load": "Class load",
    }.get(view, "Timetable")


def timetable_report_xlsx(data: dict, view: str = "section", entity: str | None = None) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.page import PageMargins

    title = (data.get("version") or {}).get("timetable") or "Timetable"
    wb = Workbook()
    thin = Border(
        left=Side(style="thin", color="94A3B8"),
        right=Side(style="thin", color="94A3B8"),
        top=Side(style="thin", color="94A3B8"),
        bottom=Side(style="thin", color="94A3B8"),
    )
    head_fill = PatternFill("solid", fgColor="1E293B")
    head_font = Font(bold=True, color="FFFFFF", name="Calibri", size=10)
    title_font = Font(bold=True, name="Calibri", size=14, color="0F172A")
    sub_font = Font(name="Calibri", size=10, color="475569")
    cell_font = Font(name="Calibri", size=9, color="0F172A")
    wrap = Alignment(wrap_text=True, vertical="center", horizontal="center")
    left = Alignment(wrap_text=True, vertical="center", horizontal="left")

    def style_sheet(ws, heading: str, subtitle: str, col_count: int):
        ws.page_setup.orientation = "landscape"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.page_margins = PageMargins(left=0.4, right=0.4, top=0.5, bottom=0.4)
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=col_count)
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=col_count)
        ws["A1"] = heading
        ws["A1"].font = title_font
        ws["A2"] = subtitle
        ws["A2"].font = sub_font
        ws.row_dimensions[1].height = 22
        ws.row_dimensions[2].height = 16
        ws.freeze_panes = "B4"

    used: set[str] = set()
    days = data.get("days") or []
    periods = data.get("periods") or []
    subtitle = title + (f" · {entity}" if entity else "")

    if view == "unplaced":
        ws = wb.active
        ws.title = _sheet_name("Unplaced", used)
        style_sheet(ws, _view_title(view), subtitle, 4)
        headers = ["Subject", "Class", "Teacher", "Missing cards"]
        for i, h in enumerate(headers, 1):
            cell = ws.cell(3, i, h)
            cell.fill = head_fill
            cell.font = head_font
            cell.alignment = wrap
            cell.border = thin
        for r, u in enumerate(data.get("unplaced") or [], 4):
            values = [u.get("subject", ""), u.get("section", ""), u.get("teacher", ""), u.get("missing", 0)]
            for i, val in enumerate(values, 1):
                cell = ws.cell(r, i, val)
                cell.font = cell_font
                cell.border = thin
                cell.alignment = left
        for i, w in enumerate([28, 22, 28, 16], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()

    if view in ("teacher_load", "class_load"):
        ws = wb.active
        ws.title = _sheet_name(_view_title(view), used)
        style_sheet(ws, _view_title(view), subtitle, 4)
        headers = ["Name", "Placed", "Required", "Free slots"]
        for i, h in enumerate(headers, 1):
            cell = ws.cell(3, i, h)
            cell.fill = head_fill
            cell.font = head_font
            cell.alignment = wrap
            cell.border = thin
        for r, row in enumerate(data.get(view) or [], 4):
            values = [row.get("name", ""), row.get("placed", 0), row.get("required", 0), row.get("free", 0)]
            for i, val in enumerate(values, 1):
                cell = ws.cell(r, i, val)
                cell.font = cell_font
                cell.border = thin
                cell.alignment = left if i == 1 else wrap
        for i, w in enumerate([32, 12, 12, 14], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()

    groups = {
        "section": data.get("sections") or [],
        "teacher": data.get("teachers") or [],
        "room": data.get("rooms") or [],
        "subject": data.get("subjects") or [],
    }.get(view, data.get("sections") or [])
    if entity:
        groups = [g for g in groups if g["name"] == entity]
    teaching = [p for p in periods if (p.get("period_type") or "teaching") == "teaching"]
    if not teaching:
        teaching = periods
    n_periods = len(teaching) or 1
    ws = wb.active
    ws.title = _sheet_name(_view_title(view), used)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToPage = False
    ws.page_setup.scale = 100
    ws.page_margins = PageMargins(left=0.4, right=0.4, top=0.5, bottom=0.4)
    ws.sheet_properties.pageSetUpPr.fitToPage = False
    ws.freeze_panes = "B3"
    ws.print_title_rows = "1:2"
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 100
    ws.sheet_view.zoomScaleNormal = 100

    day_fill = PatternFill("solid", fgColor="F2F2F2")
    day_font = Font(name="Calibri", size=12, bold=True, color="111111")
    num_font = Font(name="Calibri", size=9, color="334155")
    name_font = Font(name="Calibri", size=12, bold=True, color="111111")
    wrap_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    wrap_left = Alignment(horizontal="left", vertical="center", wrap_text=True)
    hair = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    corner = ws.cell(1, 1, "")
    corner.border = hair
    corner.fill = day_fill
    ws.merge_cells(start_row=1, start_column=1, end_row=2, end_column=1)
    ws.column_dimensions["A"].width = 22
    ws.row_dimensions[1].height = 24
    ws.row_dimensions[2].height = 32

    for d_i, d in enumerate(days):
        start = 2 + d_i * n_periods
        end = start + n_periods - 1
        if n_periods > 1:
            ws.merge_cells(start_row=1, start_column=start, end_row=1, end_column=end)
        day_cell = ws.cell(1, start, d.get("name") or "")
        day_cell.font = day_font
        day_cell.alignment = wrap_center
        day_cell.fill = day_fill
        for p_i, p in enumerate(teaching or [{"name": "", "start_time": None}]):
            col = start + p_i
            top = ws.cell(1, col)
            top.border = hair
            top.fill = day_fill
            top.alignment = wrap_center
            label = f"{p_i + 1}"
            pname = (p.get("name") or "").strip()
            if pname:
                label = f"{p_i + 1}\n{pname}"
            if p.get("start_time"):
                label = f"{label}\n{p['start_time']}"
            num = ws.cell(2, col, label)
            num.font = num_font
            num.alignment = wrap_center
            num.border = hair
            num.fill = PatternFill("solid", fgColor="FFFFFF")
            ws.column_dimensions[get_column_letter(col)].width = 18

    if not groups:
        empty = ws.cell(3, 1, "Nothing placed for this view yet.")
        empty.font = name_font
        buf = BytesIO()
        wb.save(buf)
        return buf.getvalue()

    for r_i, g in enumerate(groups):
        row = 3 + r_i
        ws.row_dimensions[row].height = 48
        name_cell = ws.cell(row, 1, g.get("name") or "")
        name_cell.font = name_font
        name_cell.alignment = wrap_left
        name_cell.border = hair
        for d_i, d in enumerate(days):
            for p_i, p in enumerate(teaching):
                col = 2 + d_i * n_periods + p_i
                cards = (g.get("cells") or {}).get(f"{d['id']}|{p['id']}", [])
                cell = ws.cell(row, col, _matrix_cell_text(cards, view))
                cell.alignment = wrap_center
                cell.border = hair
                if cards:
                    fill = _hex6(cards[0].get("color"))
                    cell.fill = PatternFill("solid", fgColor=fill)
                    cell.font = Font(name="Calibri", size=10, color=_contrast_font(fill))
                else:
                    cell.font = Font(name="Calibri", size=10, color="111111")

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
