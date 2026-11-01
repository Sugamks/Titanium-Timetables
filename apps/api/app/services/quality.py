from collections import defaultdict

from sqlalchemy.orm import Session

from app import models
from app.engine.conflicts import hard_health, teacher_of


def quality_report(db: Session, version_id: str) -> dict:
    version = db.get(models.TimetableVersion, version_id)
    health = hard_health(db, version_id)
    allocs = version.allocations if version else []
    teacher_gaps = defaultdict(int)
    period_order = {p.id: p.sort_order for p in db.query(models.Period).all()}
    by_teacher_day = defaultdict(list)
    for a in allocs:
        t = teacher_of(a.lesson)
        if not t:
            continue
        by_teacher_day[(t.id, t.name, a.day_id)].append(period_order.get(a.period_id, 0))
    gap_details = []
    total_gaps = 0
    for (tid, tname, day_id), idxs in by_teacher_day.items():
        idxs = sorted(idxs)
        if len(idxs) >= 2:
            g = (idxs[-1] - idxs[0] + 1) - len(idxs)
            if g:
                teacher_gaps[tname] += g
                total_gaps += g
                gap_details.append({"teacher": tname, "gaps": g, "day_id": day_id})
    rooms = db.query(models.Room).count() or 1
    used = len({a.room_resource_id for a in allocs if a.room_resource_id})
    pref = max(0, 100 - total_gaps - (0 if health["ok"] else 20))
    return {
        "version_id": version_id,
        "hard_ok": health["ok"],
        "hard_health": health,
        "metrics": {
            "hard_constraints": 100 if health["ok"] else 60,
            "teacher_gaps": max(0, 100 - total_gaps * 3),
            "room_utilization": min(100, int(100 * used / rooms)),
            "preference_score": pref,
            "overall": pref if health["ok"] else min(pref, 70),
        },
        "teacher_gap_details": sorted(gap_details, key=lambda x: -x["gaps"])[:20],
        "allocation_count": len(allocs),
    }
