import os
import sys
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parent.parent
_ROOT_DIR = _API_DIR.parent.parent
if getattr(sys, "frozen", False):
    _ROOT_DIR = Path(sys.executable).resolve().parent
_SQLITE_PREFIX = "sqlite+pysqlite:///"


def app_dir() -> Path:
    """Folder that contains the installed TitaniumTimetables.exe.

    A dev run of run.py has no exe, so saves land in the project folder instead.
    """
    return _ROOT_DIR


def sqlite_data_dir(api_dir: Path) -> Path:
    extra = os.environ.get("SCHEDULING_DATA_DIR")
    if extra:
        return Path(extra)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "data"
    return api_dir / "data"


def _env_files() -> tuple[str, ...]:
    files: list[str] = []
    if getattr(sys, "frozen", False):
        bundle = Path(getattr(sys, "_MEIPASS", _ROOT_DIR))
        packed = bundle / ".env"
        if packed.is_file():
            files.append(str(packed))
    sidecar = _ROOT_DIR / ".env"
    if sidecar.is_file() and str(sidecar) not in files:
        files.append(str(sidecar))
    extra = os.environ.get("SCHEDULING_ENV_FILE")
    if extra and Path(extra).is_file() and extra not in files:
        files.append(extra)
    return tuple(files)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite+pysqlite:///{(_API_DIR / 'data' / 'scheduling.db').as_posix()}"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = ""
    jwt_expire_minutes: int = 480
    scheduling_service_key: str = "dev-scheduling-service-key"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost,http://127.0.0.1:8765,http://localhost:8765"
    spa_url: str = "http://localhost:5173"
    api_url: str = "http://localhost:8000"

    update_manifest_url: str = ""
    update_user: str = ""
    update_token: str = ""
    update_allowed_hosts: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def resolve_sqlite_path(self):
        for field in (
            "jwt_secret",
            "scheduling_service_key",
            "update_manifest_url",
            "update_user",
            "update_token",
            "update_allowed_hosts",
        ):
            val = getattr(self, field, None)
            if isinstance(val, str):
                object.__setattr__(self, field, val.strip())
        ttl = os.environ.get("TTL_FILE", "").strip()
        if ttl:
            from app.services.ttl_file import open_document

            path = open_document(Path(ttl))
            object.__setattr__(self, "database_url", _SQLITE_PREFIX + path.as_posix())
        return self


settings = Settings()
