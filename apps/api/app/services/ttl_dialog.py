"""Windows file dialog and restart so a chosen .ttl becomes the open timetable."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path


def pick_script() -> Path:
    env = os.environ.get("TTL_PICK_SCRIPT")
    if env:
        return Path(env)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        bundled = Path(meipass) / "pick-ttl.ps1"
        if bundled.is_file():
            return bundled
    return Path(__file__).resolve().parents[3] / "desktop" / "pick-ttl.ps1"


def _same_path(left: Path, right: Path) -> bool:
    try:
        return left.resolve() == right.resolve()
    except OSError:
        return False


def pick_ttl(kind: str, suggested: str | None = None) -> Path | None:
    if kind not in ("open", "save"):
        raise ValueError("Choose open or save")
    script = pick_script()
    if not script.is_file():
        raise ValueError("File dialog script is missing")
    cmd = ["powershell", "-NoProfile", "-STA", "-File", str(script), "-Kind", kind]
    if suggested:
        cmd.extend(["-Name", suggested])
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    line = (proc.stdout or "").strip().splitlines()
    if not line:
        return None
    return Path(line[-1].strip())


def schedule_restart(path: Path, supersede: Path | None = None) -> None:
    path = Path(path).resolve()
    if supersede is not None and not _same_path(path, Path(supersede)):
        os.environ["TTL_SUPERSEDE"] = str(Path(supersede).resolve())
    else:
        os.environ.pop("TTL_SUPERSEDE", None)
    try:
        from app.database import engine

        engine.dispose()
    except Exception:
        pass
    if getattr(sys, "frozen", False):
        cmd = [sys.executable, str(path)]
    else:
        serve = Path(__file__).resolve().parents[3] / "desktop" / "serve.py"
        cmd = [sys.executable, str(serve), str(path)]
    flags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0
    subprocess.Popen(cmd, creationflags=flags)
    timer = threading.Timer(0.6, lambda: os._exit(0))
    timer.daemon = True
    timer.start()
