from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.services.quality import quality_report
from app.services.reports import timetable_report, timetable_report_html, timetable_report_xlsx

router = APIRouter(prefix="/v1", tags=["analytics"])


@router.get("/analytics/quality")
def quality(version_id: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not version_id:
        v = (
            db.query(models.TimetableVersion)
            .order_by(models.TimetableVersion.created_at.desc())
            .first()
        )
        version_id = v.id if v else None
    if not version_id:
        raise HTTPException(404, "No version")
    return quality_report(db, version_id)


@router.get("/analytics/substitution-load")
def sub_load(db: Session = Depends(get_db), user=Depends(get_current_user)):
    covers = db.query(models.SubstitutionCover).filter(models.SubstitutionCover.cover_teacher_id.isnot(None)).all()
    counts = {}
    names = {t.id: t.resource.name for t in db.query(models.Teacher).all() if t.resource}
    for c in covers:
        counts[c.cover_teacher_id] = counts.get(c.cover_teacher_id, 0) + 1
    return [{"teacher_id": k, "name": names.get(k), "covers": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]


@router.get("/reports/timetable")
def timetable_report_json(
    version_id: str | None = None,
    academic_year_id: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return timetable_report(db, version_id, academic_year_id)


@router.get("/reports/timetable.html")
def timetable_html(
    version_id: str | None = None,
    academic_year_id: str | None = None,
    view: str = Query("section"),
    entity: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    data = timetable_report(db, version_id, academic_year_id)
    if not data.get("ok"):
        raise HTTPException(404, data.get("error") or "No timetable")
    return HTMLResponse(timetable_report_html(data, view=view, entity=entity))


@router.get("/reports/timetable.xlsx")
def timetable_xlsx(
    version_id: str | None = None,
    academic_year_id: str | None = None,
    view: str = Query("section"),
    entity: str | None = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    data = timetable_report(db, version_id, academic_year_id)
    if not data.get("ok"):
        raise HTTPException(404, data.get("error") or "No timetable")
    raw = timetable_report_xlsx(data, view=view, entity=entity)
    label = (data.get("version") or {}).get("timetable") or "timetable"
    kind = {"section": "class", "teacher": "staff", "room": "classroom", "subject": "subject"}.get(view, view)
    who = f"-{entity}" if entity else ""
    filename = f"{label}-{kind}{who}.xlsx".replace(" ", "_")
    return Response(
        content=raw,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
