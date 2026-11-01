import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.services.ttl_dialog import pick_ttl, schedule_restart
from app.services.ttl_file import (
    assert_document,
    copy_document,
    current_path,
    keep_only_template,
    list_saved_files,
    path_for_template,
    saved_folder,
    sqlite_path,
)

router = APIRouter(prefix="/v1", tags=["document"])


class PickIn(BaseModel):
    kind: str
    template_id: str | None = None
    academic_year_id: str | None = None


class ReopenIn(BaseModel):
    path: str


def _open_path():
    path = current_path() or sqlite_path()
    if path is None:
        raise HTTPException(400, "No timetable file is open")
    return path


def _dialog_allowed(request: Request) -> bool:
    if os.environ.get("TTL_DIALOGS") == "1":
        return True
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1"}


def _save_dest(db: Session, template_id: str | None, year_id: str | None) -> tuple[Path | None, str]:
    if not year_id:
        raise HTTPException(400, "Select an academic year first.")
    year = db.get(models.AcademicYear, year_id)
    if year is None:
        raise HTTPException(400, "Academic year not found")
    rows = (
        db.query(models.Timetable)
        .filter(models.Timetable.deleted_at.is_(None), models.Timetable.academic_year_id == year.id)
        .all()
    )
    chosen = next((row for row in rows if template_id and row.id == template_id), None)
    if chosen is None and len(rows) == 1:
        chosen = rows[0]
    if chosen is None:
        if rows:
            raise HTTPException(400, "Select a template first.")
        raise HTTPException(400, "Create a template for this academic year first.")
    try:
        suggested = path_for_template(saved_folder(), chosen.name, year.name).name
        picked = pick_ttl("save", suggested)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if picked is None:
        return None, chosen.id
    if picked.suffix.lower() != ".ttl":
        picked = picked.with_suffix(".ttl")
    return picked, chosen.id


@router.get("/document")
def document_info(user=Depends(get_current_user)):
    path = current_path()
    library = path is None or path.name.lower() == "untitled.ttl"
    return {
        "path": str(path) if path else None,
        "name": path.name if path else None,
        "mode": "library" if library else "file",
        "files": list_saved_files() if library else [],
    }


@router.post("/document/pick")
def document_pick(
    body: PickIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_roles("constructor", "scheduler_admin")),
):
    if body.kind != "save":
        raise HTTPException(400, "Open a timetable by double-clicking the .ttl file.")
    if not _dialog_allowed(request):
        raise HTTPException(400, "Save runs in the desktop app")
    dest, template_id = _save_dest(db, body.template_id, body.academic_year_id)
    if dest is None:
        return {"ok": False, "cancelled": True}
    src = _open_path()
    try:
        if dest.resolve() == src.resolve():
            raise ValueError("Choose a different file. This timetable is already open.")
        saved = copy_document(src, dest)
        keep_only_template(saved, template_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "path": str(saved), "name": saved.name}


@router.post("/document/reopen")
def document_reopen(body: ReopenIn, request: Request):
    if not _dialog_allowed(request):
        raise HTTPException(400, "Open a timetable by double-clicking the .ttl file.")
    path = Path(body.path)
    try:
        assert_document(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    schedule_restart(path)
    return {"ok": True, "restart": True, "path": str(path.resolve()), "name": path.name}
