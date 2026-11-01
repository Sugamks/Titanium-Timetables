# Changelog

All notable changes to Scheduling Platform are documented in this file.

The version matches `APP_VERSION` in `apps/api/app/version.py` and `version` in `apps/web/package.json`.

## [0.1.3](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.2...v0.1.3) (2026-11-01)


### Bug Fixes

* install issue ([80e4fae](https://github.com/Sugamks/Titanium-Timetables/commit/80e4fae5da06e21d50928d4ab67709f1c85ae2d4))
* install issue ([528fb63](https://github.com/Sugamks/Titanium-Timetables/commit/528fb63d59df1e02e5b3b38d9ff36bc9bb838f85))

## [0.1.2](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.1...v0.1.2) (2026-11-01)


### Bug Fixes

* notification issue, file save issue, title issue ([6759654](https://github.com/Sugamks/Titanium-Timetables/commit/6759654345efeef0743ae2c2db9f35fb7713d863))

## [0.1.1](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.0...v0.1.1) (2026-11-01)


### Features

* adding release pipeline ([7d4f59b](https://github.com/Sugamks/Titanium-Timetables/commit/7d4f59bec6b4debcefe4a05b972c5fbba66c9023))
* adding release pipeline ([6f2ed4b](https://github.com/Sugamks/Titanium-Timetables/commit/6f2ed4bd5ab209d0ab8ee6927ac472c352f15db8))
* release test ([e455078](https://github.com/Sugamks/Titanium-Timetables/commit/e4550782b1ff18e49452e7b74728fe55cbfc8184))
* release test ([f381032](https://github.com/Sugamks/Titanium-Timetables/commit/f381032ccb45a90e4864de51920dcf97ce1cc735))

## 0.1.0 — 2026-10-24

Initial standalone release.

- FastAPI scheduling API with SQLite storage, including one SQLite database per `.ttl` timetable file.
- React timetable UI: catalog, lessons, groups, constraints, designer, generate and repair, publish, reports (HTML and Excel), substitutions, audit, and profile.
- Desktop launcher `apps/desktop/serve.py` on `http://127.0.0.1:8765`, serving the built UI and opening the browser.
- POC mode signs in through `/v1/auth/dev-login` and skips the login page.
- Optional PyInstaller build to `dist\TitaniumTimetables\TitaniumTimetables.exe`.
- Per-user Windows association for `.ttl` files via `apps/desktop/register-ttl.ps1`.
