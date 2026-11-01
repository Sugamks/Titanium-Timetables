# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.building.api import COLLECT, EXE, PYZ
from PyInstaller.building.build_main import Analysis
from PyInstaller.utils.hooks import collect_all, collect_submodules

SPECDIR = Path(SPECPATH).resolve()
ROOT = SPECDIR.parents[1]
WEB_DIST = ROOT / "apps" / "web" / "dist"
API_DIR = ROOT / "apps" / "api"

import sys

sys.path.insert(0, str(API_DIR))

datas = [(str(API_DIR / "app"), "app")]
migrations = API_DIR / "migrations"
if migrations.is_dir():
    datas.append((str(migrations), "migrations"))
datas.append((str(SPECDIR / "pick-ttl.ps1"), "."))
datas.append((str(SPECDIR / "logo-dark.png"), "."))
binaries = []
hidden = collect_submodules("app") + [
    "jose",
    "jose.jwt",
    "pymysql",
    "openpyxl",
    "passlib",
    "pydantic_settings",
    "cryptography",
] + [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "sqlalchemy.sql.default_comparator",
    "tkinter",
]

if WEB_DIST.joinpath("index.html").is_file():
    datas.append((str(WEB_DIST), "web_dist"))
    datas.append((str(WEB_DIST), "app/web_dist"))

for pkg in ("ortools", "uvicorn", "fastapi", "starlette", "anyio"):
    collected = collect_all(pkg)
    datas += collected[0]
    binaries += collected[1]
    hidden += collected[2]

a = Analysis(
    [str(SPECDIR / "serve.py")],
    pathex=[str(API_DIR), str(SPECDIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TitaniumTimetables",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(SPECDIR / "scheduling.ico"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="TitaniumTimetables",
)
