# Installation

Install and run Scheduling Platform `0.1.0` on Windows. Commands assume PowerShell and the repo root `c:\scheduling-standalone`.

## 1. Install tools

Install both of these before the project dependencies:

- Python 3.11. The virtualenv in this tree was created with 3.11 (`cpython-311`).
- Node.js `^20.19.0` or `>=22.12.0`. Vite 8 refuses older Node.

Check:

```powershell
py -3.11 --version
node --version
npm --version
```

## 2. Python environment

Create the virtualenv once. Skip this if `.venv` already exists.

```powershell
py -3.11 -m venv .venv
```

Install the API dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt
```

This installs FastAPI, Uvicorn, SQLAlchemy, OR-Tools, PyMySQL, and the other packages listed in `apps/api/requirements.txt`. It does not install Redis or MySQL.

## 3. Web UI

`apps/web/package-lock.json` is the lockfile. `npm ci` installs that exact tree.

```powershell
cd apps\web
npm ci
npm run build
cd ..\..
```

`npm run build` writes `apps/web/dist`. `apps/desktop/serve.py` serves that folder. Without it, the API still starts and the browser has no pages.

## 4. Run

```powershell
.\.venv\Scripts\python.exe apps\desktop\serve.py
```

- UI and API: `http://127.0.0.1:8765`
- Health: `http://127.0.0.1:8765/health`
- Stop: close the console window.

`serve.py` sets these for the process, which override the same names in `.env`:

| Variable | Value | Effect |
| --- | --- | --- |
| `POC_MODE` | `true` | UI calls `/v1/auth/dev-login` and opens the timetable. No password. |
| `ALLOW_DEV_LOGIN` | `true` | Dev login endpoint stays enabled. |
| `TTL_DIALOGS` | `1` | The app can show the Windows file picker for `.ttl` files. |

Optional timetable path. The argument must end in `.ttl`.

```powershell
.\.venv\Scripts\python.exe apps\desktop\serve.py "C:\path\to\file.ttl"
```

With no argument, the file is `%USERPROFILE%\Documents\Timetables\untitled.ttl`. The folder and file are created on first use. A `.ttl` file is a SQLite database. Do not open it in a text editor.

To keep the browser closed:

```powershell
$env:SCHEDULING_NO_BROWSER = "1"
.\.venv\Scripts\python.exe apps\desktop\serve.py
```

Port and bind address:

```powershell
$env:SCHEDULING_HOST = "127.0.0.1"
$env:SCHEDULING_PORT = "8765"
```

If startup fails, the traceback is printed and copied to `data\startup-error.txt` under the data directory (`SCHEDULING_DATA_DIR`, or `data` at the repo root).

## 5. Optional `.env`

Settings load from a `.env` file at the repo root. They do not load from `apps/api/.env`. Copy the sample and edit it:

```powershell
Copy-Item .env.example .env
```

Unset values use the defaults in `apps/api/app/config.py`.

When `TTL_FILE` is set (the desktop launcher always sets it), the database is that `.ttl` file. Otherwise the API uses `apps/api/data/scheduling.db`.

## 6. Open `.ttl` files from Explorer

This writes per-user registry keys (`HKCU\Software\Classes\.ttl`). It does not need an administrator. If `dist\TitaniumTimetables\TitaniumTimetables.exe` exists, double-click uses the exe. Otherwise it uses `.venv` and `serve.py`.

```powershell
powershell -ExecutionPolicy Bypass -File apps\desktop\register-ttl.ps1
```

## 7. Development

Use two terminals. The UI proxies `/v1` and `/health` to `http://127.0.0.1:8000` (`apps/web/vite.config.ts`). That is the port `apps/api/run.py` binds.

Terminal 1, from `apps\api` (this process does not force POC mode):

```powershell
..\..\.venv\Scripts\python.exe run.py
```

Terminal 2, from `apps\web`:

```powershell
npm run dev
```

Open `http://localhost:5174`.

With `POC_MODE=true` (the default in code), the UI signs in as Staff. With `POC_MODE=false` and `ALLOW_DEV_LOGIN=true`, use the dev login button on `/login`.

## 8. Tests

`pytest` is not in `apps/api/requirements.txt`. Install it into the virtualenv, then run from `apps\api` so `app` imports resolve:

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
cd apps\api
..\..\.venv\Scripts\python.exe -m pytest
```

## 9. Windows executable

From the repo root. This runs `npm run build`, installs PyInstaller into the virtualenv, and writes `dist\TitaniumTimetables\TitaniumTimetables.exe`.

```powershell
powershell -ExecutionPolicy Bypass -File apps\desktop\build.ps1
powershell -ExecutionPolicy Bypass -File apps\desktop\package-windows.ps1
```

`package-windows.ps1` writes `dist\TitaniumTimetables.msi`. It calls `build.ps1` unless you pass `-SkipBuild`. The MSI does not ship a `.env`. GitHub Actions workflow `.github/workflows/release.yml` publishes the GitHub release, builds this MSI, and attaches `TitaniumTimetables.msi` to that release.

Run `dist\TitaniumTimetables\TitaniumTimetables.exe`. Data for a frozen build lives in a `data` folder beside the exe, unless `SCHEDULING_DATA_DIR` is set.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Browser opens and shows no app page | `apps\web\dist\index.html` is missing. Run `npm run build` in `apps\web`. |
| Dev UI calls fail with `ECONNREFUSED 127.0.0.1:8000` | `run.py` is not running. Start it from `apps\api`. |
| `node` or `npm run build` errors about the engine | Node is older than `20.19.0` and not `22.12` or newer. |
| Port already in use | Another `serve.py` or uvicorn is still running. Close that window, or set `SCHEDULING_PORT`. |
