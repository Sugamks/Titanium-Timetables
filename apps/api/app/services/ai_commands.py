import re

from sqlalchemy.orm import Session

from app import models


def parse_prompt(db: Session, prompt: str) -> dict:
    text = prompt.strip()
    low = text.lower()

    # "don't schedule 8A physics on friday" / "move 8A physics away from friday"
    m = re.search(r"(?:don't schedule|do not schedule|move|keep)\s+(.+?)\s+(?:away from|on|off)\s+(\w+)", low)
    if m or "friday" in low or "monday" in low:
        day_name = None
        for d in db.query(models.Day).all():
            if d.name.lower() in low:
                day_name = d
                break
        subject = None
        for s in db.query(models.Subject).all():
            if s.name.lower() in low:
                subject = s
                break
        section = None
        for sec in db.query(models.Section).all():
            label = (sec.resource.name if sec.resource else "").lower()
            if label and label in low.replace(" ", ""):
                section = sec
                break
        if day_name and (subject or "physics" in low):
            return {
                "kind": "add_constraint",
                "constraint": {
                    "type_code": "PreferredDay",
                    "severity": "hard" if "don't" in low or "do not" in low else "soft",
                    "weight": 90,
                    "scope": "subject",
                    "scope_id": subject.id if subject else None,
                    "params": {"day_ids": [day_name.id], "mode": "avoid"},
                },
                "summary": f"Avoid {subject.name if subject else 'subject'} on {day_name.name}",
            }

    m = re.search(r"(?:no more than|at most|<=)\s+(\d+)\s+(?:periods|lessons)", low)
    if m:
        n = int(m.group(1))
        teacher = None
        for t in db.query(models.Teacher).all():
            if t.resource and t.resource.name.split()[0].lower() in low:
                teacher = t
                break
        if teacher:
            return {
                "kind": "add_constraint",
                "constraint": {
                    "type_code": "MaxTeacherLessonsPerDay",
                    "severity": "soft",
                    "weight": 80,
                    "scope": "teacher",
                    "scope_id": teacher.resource_id,
                    "params": {"max": n},
                },
                "summary": f"{teacher.resource.name} Monday/day max {n} lessons",
            }

    if "substitute" in low or "cover" in low:
        teacher = None
        for t in db.query(models.Teacher).all():
            if t.resource and t.resource.name.split()[0].lower() in low:
                teacher = t
                break
        return {
            "kind": "find_substitute",
            "teacher_id": teacher.id if teacher else None,
            "summary": f"Find substitute candidates for {teacher.resource.name if teacher and teacher.resource else 'teacher'}",
        }

    if "why" in low or "cannot" in low or "can't" in low:
        return {
            "kind": "explain_conflict",
            "summary": "Explain why the requested placement is invalid",
            "prompt": text,
        }

    return {
        "kind": "unknown",
        "summary": "Could not map the request to a timetable command. Try: 'Don't schedule 8A Physics on Friday.'",
        "prompt": text,
    }
