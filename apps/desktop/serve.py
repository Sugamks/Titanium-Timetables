"""Run the scheduling API and built web UI, then open a browser."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path


def _frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _bundle_dir() -> Path:
    if _frozen():
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


def _repo_or_install_dir() -> Path:
    if _frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _data_dir() -> Path:
    if os.environ.get("SCHEDULING_DATA_DIR"):
        path = Path(os.environ["SCHEDULING_DATA_DIR"])
    elif _frozen():
        path = _repo_or_install_dir() / "data"
    else:
        path = _repo_or_install_dir() / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _spa_dir() -> Path | None:
    candidates = [
        _bundle_dir() / "web_dist",
        _repo_or_install_dir() / "apps" / "web" / "dist",
        Path(__file__).resolve().parents[1] / "web" / "dist",
    ]
    for path in candidates:
        if (path / "index.html").is_file():
            return path
    return None


def _workshop_db() -> Path | None:
    start = _repo_or_install_dir()
    for folder in [start, *start.parents]:
        cand = folder / "apps" / "api" / "data" / "scheduling.db"
        if cand.is_file() and cand.stat().st_size > 0:
            return cand
    return None


def _ttl_from_argv() -> Path | None:
    for arg in sys.argv[1:]:
        if arg.startswith("-"):
            continue
        if arg.lower().endswith(".ttl"):
            return Path(arg)
    return None


def _handoff(ttl: Path) -> bool:
    """Ask a running desktop app to load this file, then let that app open the window."""
    import json
    import urllib.request

    port = os.environ.get("SCHEDULING_PORT", "8765")
    body = json.dumps({"path": str(ttl)}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/document/reopen",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as res:
            return 200 <= getattr(res, "status", 200) < 300
    except Exception:
        return False


def _default_ttl() -> Path:
    return _repo_or_install_dir() / "untitled.ttl"


def _drop_superseded() -> None:
    raw = os.environ.pop("TTL_SUPERSEDE", "").strip()
    if not raw:
        return
    old = Path(raw)
    current = Path(os.environ.get("TTL_FILE", ""))
    try:
        if current and old.resolve() == current.resolve():
            return
    except OSError:
        pass
    for _ in range(20):
        try:
            if old.is_file():
                old.unlink()
            return
        except OSError:
            time.sleep(0.25)


def _prepare_env() -> None:
    ttl = _ttl_from_argv() or _default_ttl()
    os.environ["TTL_FILE"] = str(ttl)
    _drop_superseded()
    os.environ["TTL_DIALOGS"] = "1"
    install = _repo_or_install_dir()
    data = _data_dir()
    os.chdir(str(data))
    sidecar = install / ".env"
    bundled = _bundle_dir() / ".env"
    if sidecar.is_file():
        os.environ.setdefault("SCHEDULING_ENV_FILE", str(sidecar))
    elif bundled.is_file():
        os.environ.setdefault("SCHEDULING_ENV_FILE", str(bundled))
    os.environ["SCHEDULING_DATA_DIR"] = str(data)
    spa = _spa_dir()
    if spa:
        os.environ["SPA_DIST"] = str(spa)
    api_dir = _bundle_dir() if _frozen() else Path(__file__).resolve().parents[1] / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))


def _base_url() -> str:
    host = os.environ.get("SCHEDULING_HOST", "127.0.0.1")
    port = os.environ.get("SCHEDULING_PORT", "8765")
    return f"http://{host}:{port}/"


def _server_up(url: str) -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(url + "health", timeout=0.6) as res:
            return 200 <= getattr(res, "status", 200) < 500
    except Exception:
        return False


def _open_browser(url: str) -> None:
    if os.environ.get("SCHEDULING_NO_BROWSER") == "1":
        return
    spa = _spa_dir()
    index = (spa / "index.html") if spa else None
    if index and index.is_file():
        url = f"{url}?v={int(index.stat().st_mtime)}"
    webbrowser.open(url)


def _hide_runtime() -> None:
    """Keep the exe folder readable: hide the engine files, leave the exe and .ttl files visible."""
    if not _frozen() or os.name != "nt":
        return
    import ctypes

    hidden = 0x2
    root = _repo_or_install_dir()
    for name in ("_internal", "data"):
        path = root / name
        if path.exists():
            ctypes.windll.kernel32.SetFileAttributesW(str(path), hidden)


def _register_ttl() -> None:
    if not _frozen() or os.name != "nt":
        return
    import winreg

    command = f'"{Path(sys.executable).resolve()}" "%1"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\SchdTtl") as key:
        winreg.SetValue(key, "", winreg.REG_SZ, "School timetable")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\SchdTtl\shell\open\command") as key:
        winreg.SetValue(key, "", winreg.REG_SZ, command)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\SchdTtl\DefaultIcon") as key:
        winreg.SetValue(key, "", winreg.REG_SZ, f'"{Path(sys.executable).resolve()}",0')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\.ttl") as key:
        winreg.SetValue(key, "", winreg.REG_SZ, "SchdTtl")


def _quiet_stdio() -> None:
    if sys.stdout is not None and sys.stderr is not None:
        return
    handle = open(_data_dir() / "server.log", "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = handle
    if sys.stderr is None:
        sys.stderr = handle


def _fail(text: str) -> None:
    try:
        if sys.stderr:
            print(text, file=sys.stderr)
    except Exception:
        pass
    try:
        (_data_dir() / "startup-error.txt").write_text(text, encoding="utf-8")
    except Exception:
        pass
    if os.name == "nt":
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, text[-1200:], "Titanium Timetables", 0x10)


def _logo_path() -> Path | None:
    candidates = [
        _bundle_dir() / "logo-dark.png",
        Path(__file__).resolve().parent / "logo-dark.png",
        _repo_or_install_dir() / "apps" / "web" / "public" / "logo-dark.png",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def _spawn_splash() -> None:
    """Keep Tcl out of the server process.

    A windowed build turns any later Tcl call into a breakpoint crash in
    tcl86t.dll. That drops the open HTTP connection, so Save file shows
    "Failed to fetch". The splash process exits with os._exit and never
    finalizes Tcl.
    """
    env = os.environ.copy()
    env["TITANIUM_SPLASH"] = "1"
    subprocess.Popen([sys.executable], env=env)


def _splash_window(url: str) -> None:
    import tkinter as tk

    root = tk.Tk()
    root.title("Titanium Timetables")
    root.overrideredirect(True)
    bg = "#16192b"
    root.configure(bg=bg)
    width, height = 420, 300
    root.geometry(f"{width}x{height}+{(root.winfo_screenwidth() - width) // 2}+{(root.winfo_screenheight() - height) // 2}")
    root.attributes("-topmost", True)
    logo = _logo_path()
    if logo:
        image = tk.PhotoImage(file=str(logo))
        mark = tk.Label(root, image=image, bg=bg)
        mark.image = image
        mark.pack(pady=(36, 8))
    tk.Label(root, text="Opening…", fg="#9aa3c0", bg=bg, font=("Segoe UI", 11)).pack(pady=(8, 0))
    started = time.time()

    def poll() -> None:
        if _server_up(url):
            _open_browser(url)
            os._exit(0)
        if time.time() - started > 40:
            try:
                root.withdraw()
            except tk.TclError:
                pass
            _fail("Titanium Timetables did not start.")
            os._exit(1)
        root.after(200, poll)

    root.after(200, poll)
    root.mainloop()
    os._exit(0)


def _serve(host: str, port: int) -> None:
    import uvicorn
    from app.main import app

    uvicorn.run(app, host=host, port=port, reload=False, log_level="warning", access_log=False)


def _run() -> None:
    clicked = _ttl_from_argv()
    if clicked is not None and _handoff(clicked):
        return
    url = _base_url()
    if _server_up(url):
        _open_browser(url)
        return
    _prepare_env()
    _hide_runtime()
    _register_ttl()
    host = os.environ.get("SCHEDULING_HOST", "127.0.0.1")
    port = int(os.environ.get("SCHEDULING_PORT", "8765"))
    if _frozen():
        _quiet_stdio()
        _spawn_splash()
        _serve(host, port)
        return
    print(f"Titanium Timetables  {url}")
    print(f"Timetable file  {os.environ.get('TTL_FILE', '')}")
    print("Close this window to stop the app.")
    if os.environ.get("SCHEDULING_NO_BROWSER") != "1":
        threading.Thread(target=lambda: (time.sleep(1.4), _open_browser(url)), daemon=True).start()
    _serve(host, port)


def main() -> None:
    if os.environ.get("TITANIUM_SPLASH") == "1":
        try:
            _splash_window(_base_url())
        except Exception:
            _fail(traceback.format_exc())
            os._exit(1)
        os._exit(0)
    try:
        _run()
    except Exception:
        text = traceback.format_exc()
        _fail(text)
        if sys.stdin and getattr(sys.stdin, "isatty", lambda: False)() and not _frozen():
            try:
                input("Press Enter to close…")
            except Exception:
                pass
        raise SystemExit(1)


if __name__ == "__main__":
    main()
