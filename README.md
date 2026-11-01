# Scheduling Platform

Standalone school timetable app. A FastAPI service stores each timetable in a `.ttl` file (SQLite). A React UI edits the timetable, generates a schedule, and handles day-to-day cover.

Version `0.1.2`. <!-- x-release-please-version -->

## What you can do

- Open or create a `.ttl` timetable file.
- Maintain years, teachers, rooms, subjects, sections, lessons, and groups.
- Paint constraints, design the grid, and generate or repair a timetable (OR-Tools).
- Publish a version, print or export reports (HTML and Excel).
- Record absences and assign substitutions.
- The UI signs in as Staff and skips the login page.

## Requirements

- Windows
- Python 3.11
- Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8)

Redis is not required to start. PostgreSQL is not required. The default database is SQLite inside the `.ttl` file.

## Quick start

From the repo root in PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt
cd apps\web
npm ci
npm run build
cd ..\..
.\.venv\Scripts\python.exe apps\desktop\serve.py
```

The app opens at `http://127.0.0.1:8765`. Close that console window to stop it.

That path is for working in this repo. To install the Windows app, use the MSI below.

## Windows app

Download `TitaniumTimetables.msi` from the latest release:

https://github.com/Sugamks/Titanium-Timetables/releases

Double-click the MSI. It installs for the current Windows user and does not ask for an administrator password. The program files land in `%LocalAppData%\Programs\TitaniumTimetables`. The Start menu shortcut is **Titanium Timetables**.

After install, double-click a `.ttl` file to open that timetable. When a newer release is on GitHub, the app shows **Update available**. Update downloads that MSI, checks its sha256, and installs it.

Build steps for the `.exe` and the MSI are in [INSTALL.md](INSTALL.md).

## Layout

| Path | Role |
| --- | --- |
| `apps/api` | FastAPI app. Entry for reload-only API work is `run.py` (port `8000`). |
| `apps/web` | React + Vite UI. Dev server is port `5174`. |
| `apps/desktop/serve.py` | Runs the API on port `8765` and serves `apps/web/dist`. |
| `apps/desktop/build.ps1` | Builds `dist\TitaniumTimetables\TitaniumTimetables.exe`. |
| `apps/api/migrations` | SQL migrations applied as the schema is ensured. |
| `apps/api/tests` | API tests. |

`npm run dev` proxies `/v1` and `/health` to `http://127.0.0.1:8000`. Start `apps/api/run.py` in another terminal before using the dev UI. `serve.py` is a separate process on port `8765` and serves the built UI.

## Health

`GET /health` returns `ok`, the service name, and the institution name.

## License

No license file is in this repo. All rights stay with the copyright holder.
