# Changelog

All notable changes to Scheduling Platform are documented in this file.

The version matches `APP_VERSION` in `apps/api/app/version.py` and `version` in `apps/web/package.json`.

## 0.1.0 — 2026-10-24

Initial standalone release.

- FastAPI scheduling API with SQLite storage, including one SQLite database per `.ttl` timetable file.
- React timetable UI: catalog, lessons, groups, constraints, designer, generate and repair, publish, reports (HTML and Excel), substitutions, audit, and profile.
- Desktop launcher `apps/desktop/serve.py` on `http://127.0.0.1:8765`, serving the built UI and opening the browser.
- POC mode signs in through `/v1/auth/dev-login` and skips the login page.
- Optional PyInstaller build to `dist\TitaniumTimetables\TitaniumTimetables.exe`.
- Per-user Windows association for `.ttl` files via `apps/desktop/register-ttl.ps1`.
