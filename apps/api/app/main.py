import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.auth import decode_token
from app.config import settings
from app.database import Base, SessionLocal, engine, ensure_schema
from app.routers import ai, analytics, designer, document, jobs, operations, publish, scheduling, updates
from app.version import APP_VERSION
from app.seed import ensure_all_groups, ensure_default_time_grid, ensure_lesson_sections, seed_catalog
from app.services.audit import record_audit
from app.services.institution import institution_name
from app.services.staff_profile import read_profile

app = FastAPI(title="Titanium Timetables", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_AUDIT_SKIP = (
    "/health",
    "/v1/app/update",
)


@app.middleware("http")
async def audit_mutations(request: Request, call_next):
    response = await call_next(request)
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return response
    path = request.url.path
    if not path.startswith("/v1/") or any(path.startswith(skip) for skip in _AUDIT_SKIP):
        return response
    if response.status_code >= 400:
        return response
    user = None
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        try:
            user = decode_token(auth.split(" ", 1)[1])
        except Exception:
            user = None
    if not user or not str(user.get("username") or "").strip():
        profile = read_profile()
        if profile.get("username"):
            user = {"sub": "local", "name": profile.get("name") or "", "username": profile["username"]}
    parts = [p for p in path.split("/") if p]
    entity = parts[1] if len(parts) > 1 else "app"
    db = SessionLocal()
    try:
        record_audit(db, user, entity=entity, reason=f"{request.method} {path}")
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    return response

app.include_router(scheduling.router)
app.include_router(document.router)
app.include_router(designer.router)
app.include_router(jobs.router)
app.include_router(operations.router)
app.include_router(publish.router)
app.include_router(analytics.router)
app.include_router(ai.router)
app.include_router(updates.router)


@app.on_event("startup")
def startup():
    if settings.database_url.startswith("sqlite"):
        Path("data").mkdir(exist_ok=True)
        Path("../../data").mkdir(exist_ok=True)
    Base.metadata.create_all(bind=engine)
    ensure_schema(engine)
    db = SessionLocal()
    try:
        seed_catalog(db)
        ensure_default_time_grid(db)
        ensure_all_groups(db)
        ensure_lesson_sections(db)
    finally:
        db.close()


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "titanium-timetables",
        "institution": institution_name(),
    }


def _spa_dir() -> Path | None:
    env = os.environ.get("SPA_DIST")
    here = Path(__file__).resolve().parent
    candidates = [Path(env) if env else None, here / "web_dist"]
    try:
        candidates.append(here.parents[1] / "web" / "dist")
    except IndexError:
        pass
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(Path(meipass) / "web_dist")
    for path in candidates:
        if path and (path / "index.html").is_file():
            return path
    return None


_spa = _spa_dir()
if _spa:
    _assets = _spa / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    def _page(path: Path) -> FileResponse:
        response = FileResponse(path)
        if path.suffix.lower() == ".html":
            response.headers["Cache-Control"] = "no-cache"
        return response

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        target = (_spa / full_path) if full_path else (_spa / "index.html")
        if full_path and target.is_file():
            return _page(target)
        return _page(_spa / "index.html")
