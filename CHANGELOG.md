# Changelog

All notable changes to Scheduling Platform are documented in this file.

The version matches `APP_VERSION` in `apps/api/app/version.py` and `version` in `apps/web/package.json`.

## [0.1.7](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.6...v0.1.7) (2026-11-15)


### Bug Fixes

* readme guidelines, sidebar styling ([10a7bc2](https://github.com/Sugamks/Titanium-Timetables/commit/10a7bc273b3dc153fa55b223ba44c01cdcf7db9f))

## [0.1.6](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.5...v0.1.6) (2026-11-14)


### Bug Fixes

* adding border to user icons ([0f325a7](https://github.com/Sugamks/Titanium-Timetables/commit/0f325a7c3448253ba6084f1241d22e918bc2015c))
* adding border to user icons ([ebed8f5](https://github.com/Sugamks/Titanium-Timetables/commit/ebed8f5fcb9f4b712df9e79b117455b53ffe8e79))
* release updater stuck issue ([204194a](https://github.com/Sugamks/Titanium-Timetables/commit/204194ab374d04229df37ce291184e95dc98300b))

## [0.1.5](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.4...v0.1.5) (2026-11-14)


### Features

* ui-enh and bug fixes ([603c73e](https://github.com/Sugamks/Titanium-Timetables/commit/603c73ee1e341f19d42b73aabf03d32a265fe622))
* ui-enh and bug fixes ([379d1c1](https://github.com/Sugamks/Titanium-Timetables/commit/379d1c1fa0419bcad44fdf4e6d9dce8c7a39c7c8))

## [0.1.4](https://github.com/Sugamks/Titanium-Timetables/compare/v0.1.3...v0.1.4) (2026-11-01)


### Bug Fixes

* installation issue ([129364b](https://github.com/Sugamks/Titanium-Timetables/commit/129364bcca09ae4bd1c31b4e8c4585143d8bbbc5))
* installation issue ([0387c2f](https://github.com/Sugamks/Titanium-Timetables/commit/0387c2f68338980f8d39fb0e9ced0567887e627f))

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
