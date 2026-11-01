from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user, require_roles
from app.database import get_db
from app.engine.conflicts import allocation_conflicts
from app.services.ai_commands import parse_prompt
from app.services.audit import actor_label

router = APIRouter(prefix="/v1/ai", tags=["ai"])


class PromptIn(BaseModel):
    prompt: str
    version_id: str | None = None
    lesson_id: str | None = None
    day_id: str | None = None
    period_id: str | None = None


@router.post("/commands")
def create_command(body: PromptIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
    structured = parse_prompt(db, body.prompt)
    if structured.get("kind") == "explain_conflict" and body.version_id and body.lesson_id and body.day_id:
        structured["preview"] = allocation_conflicts(
            db,
            body.version_id,
            {"lesson_id": body.lesson_id, "day_id": body.day_id, "period_id": body.period_id},
        )
    row = models.AiCommand(prompt=body.prompt, structured=structured, status="preview")
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "status": row.status, "structured": structured}


@router.post("/commands/{cid}/apply")
def apply_command(cid: str, db: Session = Depends(get_db), user=Depends(require_roles("constructor"))):
    row = db.get(models.AiCommand, cid)
    if not row or row.status != "preview":
        raise HTTPException(400, "Command not in preview")
    structured = row.structured or {}
    if structured.get("kind") == "add_constraint" and structured.get("constraint"):
        c = structured["constraint"]
        db.add(
            models.ConstraintInstance(
                type_code=c["type_code"],
                severity=c.get("severity") or "soft",
                weight=c.get("weight") or 50,
                scope=c.get("scope") or "global",
                scope_id=c.get("scope_id"),
                params=c.get("params") or {},
                enabled=True,
            )
        )
        db.add(models.ChangeEvent(entity="constraint", actor=actor_label(user), reason="ai apply", new_value=c))
        row.status = "applied"
        db.commit()
        return {"ok": True, "applied": "constraint"}
    row.status = "rejected"
    db.commit()
    return {"ok": False, "message": "This command type is preview-only (find_substitute / unknown). Use Operations UI."}
