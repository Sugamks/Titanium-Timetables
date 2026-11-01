"""Check Bitbucket Downloads (or any https manifest) and stage a desktop update."""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlparse

import httpx

from app.version import APP_VERSION

MAX_MANIFEST_BYTES = 1_000_000
MAX_DOWNLOAD_BYTES = 800 * 1024 * 1024
MAX_UNPACKED_BYTES = 2_000_000_000
MAX_FILES = 20_000
BITBUCKET_HOSTS = {"bitbucket.org", "api.bitbucket.org"}
GITHUB_HOSTS = {
    "github.com",
    "api.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
}
MSI_NAME = "TitaniumTimetables.msi"


class UpdateError(Exception):
    pass


def is_newer(current: str, remote: str) -> bool:
    return _version_parts(remote) > _version_parts(current)


def allowed_download(manifest_url: str, download_url: str, extra_hosts: str) -> str:
    parsed = urlparse(download_url.strip())
    if parsed.scheme != "https" or not parsed.hostname:
        raise UpdateError("Update downloads must use https")
    if parsed.username or parsed.password:
        raise UpdateError("Update downloads must not include credentials")
    host = parsed.hostname.lower()
    allowed = set(BITBUCKET_HOSTS) | set(GITHUB_HOSTS)
    manifest_host = urlparse(manifest_url).hostname
    if manifest_host:
        allowed.add(manifest_host.lower())
    for item in extra_hosts.split(","):
        item = item.strip().lower()
        if item:
            allowed.add(item)
    if host not in allowed:
        raise UpdateError(f"Update host {host} is not allowed")
    return download_url.strip()


def stage_release(payload: bytes | Path, expected_sha256: str, dest: Path) -> Path:
    digest = _sha256(payload)
    if digest != expected_sha256.strip().lower():
        raise UpdateError("The update file does not match its checksum")
    if dest.exists():
        import shutil

        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    try:
        if isinstance(payload, Path):
            archive = zipfile.ZipFile(payload)
        else:
            archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise UpdateError("The update file is not a zip archive") from exc
    with archive:
        planned = _safe_members(archive, dest)
        for info, target in planned:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, target.open("wb") as out:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    return _payload_root(dest)


def apply_script() -> str:
    return r"""param(
  [Parameter(Mandatory = $true)][int]$PidToWait,
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Dest,
  [Parameter(Mandatory = $true)][string]$Exe
)
$ErrorActionPreference = "Stop"
while (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds 1
}
$internalSrc = Join-Path $Source "_internal"
$internalDest = Join-Path $Dest "_internal"
if (Test-Path $internalSrc) {
  & robocopy $internalSrc $internalDest /MIR /NFL /NDL /NJH /NJS /NC /NS /NP
  if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }
}
& robocopy $Source $Dest /E /NFL /NDL /NJH /NJS /NC /NS /NP /XF .env /XD _internal
if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE }
Start-Process -FilePath $Exe
"""


def check_manifest(
    *,
    current: str,
    manifest_url: str,
    user: str,
    token: str,
    extra_hosts: str,
    fetch,
) -> dict:
    try:
        release = _read_release(current, manifest_url, user, token, extra_hosts, fetch)
    except UpdateError as exc:
        return {"current": current, "configured": True, "available": False, "error": str(exc)}
    except (json.JSONDecodeError, UnicodeError, KeyError, TypeError):
        return {
            "current": current,
            "configured": True,
            "available": False,
            "error": "The update manifest could not be read",
        }
    if release is None:
        return {"current": current, "configured": True, "available": False}
    return {
        "current": current,
        "configured": True,
        "available": True,
        "version": release["version"],
        "notes": release["notes"],
    }


def github_repo() -> str:
    from app.update_target import GITHUB_REPO

    repo = os.environ.get("UPDATE_GITHUB_REPO", "").strip() or (GITHUB_REPO or "").strip()
    if repo and not re_repo(repo):
        raise UpdateError("UPDATE_GITHUB_REPO must look like owner/name")
    return repo


def re_repo(repo: str) -> bool:
    parts = repo.split("/")
    if len(parts) != 2:
        return False
    return all(part and all(ch.isalnum() or ch in "._-" for ch in part) for part in parts)


def release_from_github(payload: dict, current: str) -> dict | None:
    if not isinstance(payload, dict):
        raise UpdateError("The GitHub release could not be read")
    version = str(payload.get("tag_name") or "").strip().lstrip("vV")
    _version_parts(version)
    if not is_newer(current, version):
        return None
    assets = payload.get("assets") or []
    asset = next((item for item in assets if item.get("name") == MSI_NAME), None)
    if asset is None:
        return None
    url = allowed_download("https://api.github.com/", str(asset.get("browser_download_url") or ""), "")
    digest = str(asset.get("digest") or "")
    sha = digest.split(":", 1)[1].strip().lower() if digest.lower().startswith("sha256:") else ""
    if len(sha) != 64 or any(char not in "0123456789abcdef" for char in sha):
        raise UpdateError("The release file has no checksum")
    notes = str(payload.get("body") or "")[:4000]
    return {"version": version, "notes": notes, "url": url, "sha256": sha}


def public_status() -> dict:
    current = APP_VERSION
    try:
        repo = github_repo()
    except UpdateError as exc:
        return {"current": current, "configured": False, "available": False, "error": str(exc)}
    if not repo:
        return {"current": current, "configured": False, "available": False}
    try:
        raw = http_get(f"https://api.github.com/repos/{repo}/releases/latest", "", "", MAX_MANIFEST_BYTES)
        release = release_from_github(json.loads(raw.decode("utf-8")), current)
    except UpdateError as exc:
        if str(exc).endswith("404"):
            return {"current": current, "configured": True, "available": False}
        return {"current": current, "configured": True, "available": False, "error": str(exc)}
    except (json.JSONDecodeError, UnicodeError, TypeError):
        return {"current": current, "configured": True, "available": False, "error": "The GitHub release could not be read"}
    if release is None:
        return {"current": current, "configured": True, "available": False}
    return {
        "current": current,
        "configured": True,
        "available": True,
        "version": release["version"],
        "notes": release["notes"],
    }


def install_available_update() -> Path:
    if not getattr(sys, "frozen", False):
        raise UpdateError("Install the packaged app to apply updates")
    repo = github_repo()
    if not repo:
        raise UpdateError("No update repository is configured")
    raw = http_get(f"https://api.github.com/repos/{repo}/releases/latest", "", "", MAX_MANIFEST_BYTES)
    release = release_from_github(json.loads(raw.decode("utf-8")), APP_VERSION)
    if release is None:
        raise UpdateError("No update is available")
    folder = _updates_dir()
    msi_path = folder / MSI_NAME
    digest = download_file(release["url"], "", "", msi_path, MAX_DOWNLOAD_BYTES)
    if digest != release["sha256"]:
        msi_path.unlink(missing_ok=True)
        raise UpdateError("The update file does not match its checksum")
    return msi_path


def apply_msi_script() -> str:
    return r"""param(
  [Parameter(Mandatory = $true)][int]$PidToWait,
  [Parameter(Mandatory = $true)][string]$Msi,
  [Parameter(Mandatory = $true)][string]$Exe
)
$ErrorActionPreference = "Stop"
while (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds 1
}
$proc = Start-Process -FilePath msiexec.exe -ArgumentList @("/i", $Msi, "/qn", "/norestart") -Wait -PassThru
if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) { exit $proc.ExitCode }
if (Test-Path -LiteralPath $Exe) { Start-Process -FilePath $Exe }
"""


def launch_helper(source: Path) -> None:
    if source.suffix.lower() == ".msi":
        _launch_msi(source)
        return
    install = Path(sys.executable).resolve().parent
    exe = install / "TitaniumTimetables.exe"
    script = _updates_dir() / "apply-update.ps1"
    script.write_text(apply_script(), encoding="utf-8")
    kwargs: dict = {"close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000200 | 0x08000000
    subprocess.Popen(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-PidToWait",
            str(os.getpid()),
            "-Source",
            str(source),
            "-Dest",
            str(install),
            "-Exe",
            str(exe),
        ],
        **kwargs,
    )


def _launch_msi(msi_path: Path) -> None:
    install = Path(sys.executable).resolve().parent
    exe = install / "TitaniumTimetables.exe"
    script = _updates_dir() / "apply-update.ps1"
    script.write_text(apply_msi_script(), encoding="utf-8")
    kwargs: dict = {"close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000200 | 0x08000000
    subprocess.Popen(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-PidToWait",
            str(os.getpid()),
            "-Msi",
            str(msi_path),
            "-Exe",
            str(exe),
        ],
        **kwargs,
    )


def http_get(url: str, user: str, token: str, limit: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    for chunk in _iter_download(url, user, token):
        size += len(chunk)
        if size > limit:
            raise UpdateError("The update file is too large")
        chunks.append(chunk)
    return b"".join(chunks)


def download_file(url: str, user: str, token: str, dest: Path, limit: int) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    size = 0
    partial = dest.with_suffix(dest.suffix + ".partial")
    try:
        with partial.open("wb") as out:
            for chunk in _iter_download(url, user, token):
                size += len(chunk)
                if size > limit:
                    raise UpdateError("The update file is too large")
                hasher.update(chunk)
                out.write(chunk)
        partial.replace(dest)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    return hasher.hexdigest()


def _iter_download(url: str, user: str, token: str):
    current = url
    header = ""
    if user and token:
        import base64

        header = "Basic " + base64.b64encode(f"{user}:{token}".encode()).decode()
    with httpx.Client(follow_redirects=False, timeout=120.0) as client:
        for _ in range(6):
            headers = {"User-Agent": "TitaniumTimetables-Updater"}
            host = (urlparse(current).hostname or "").lower()
            if header and host in BITBUCKET_HOSTS:
                headers["Authorization"] = header
            response = client.get(current, headers=headers)
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if not location:
                    raise UpdateError("The update server sent a redirect without a location")
                current = urljoin(current, location)
                if urlparse(current).scheme != "https":
                    raise UpdateError("Update downloads must use https")
                continue
            if response.status_code >= 400:
                raise UpdateError(f"Update server returned {response.status_code}")
            yield response.content
            return
    raise UpdateError("The update server redirected too many times")


def _read_release(current: str, manifest_url: str, user: str, token: str, extra_hosts: str, fetch) -> dict | None:
    raw = fetch(manifest_url, user, token, MAX_MANIFEST_BYTES)
    data = json.loads(raw.decode("utf-8"))
    if not isinstance(data, dict):
        raise UpdateError("The update manifest could not be read")
    version = str(data["version"]).strip()
    _version_parts(version)
    notes = str(data.get("notes") or "")[:4000]
    url = allowed_download(manifest_url, str(data["url"]), extra_hosts)
    sha = str(data["sha256"]).strip().lower()
    if len(sha) != 64 or any(char not in "0123456789abcdef" for char in sha):
        raise UpdateError("The update manifest checksum is invalid")
    if not is_newer(current, version):
        return None
    return {"version": version, "notes": notes, "url": url, "sha256": sha}


def _version_parts(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("vV").split("-", 1)[0]
    bits = [bit for bit in text.split(".") if bit != ""]
    if not bits or len(bits) > 3 or any(not bit.isdigit() for bit in bits):
        raise UpdateError(f"Unrecognized version {value}")
    nums = [int(bit) for bit in bits]
    while len(nums) < 3:
        nums.append(0)
    return nums[0], nums[1], nums[2]


def _sha256(payload: bytes | Path) -> str:
    if isinstance(payload, Path):
        hasher = hashlib.sha256()
        with payload.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest()
    return hashlib.sha256(payload).hexdigest()


def _safe_members(archive: zipfile.ZipFile, dest: Path) -> list[tuple[zipfile.ZipInfo, Path]]:
    dest_resolved = dest.resolve()
    planned: list[tuple[zipfile.ZipInfo, Path]] = []
    total = 0
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        if not name or name.endswith("/"):
            continue
        if name.startswith("/") or name.startswith("\\"):
            raise UpdateError("The update archive has an unsafe path")
        parts = PurePosixPath(name).parts
        if not parts or any(part in ("", ".", "..") for part in parts) or ":" in parts[0]:
            raise UpdateError("The update archive has an unsafe path")
        target = dest_resolved.joinpath(*parts)
        if os.path.commonpath([str(dest_resolved), str(target)]) != str(dest_resolved):
            raise UpdateError("The update archive has an unsafe path")
        total += max(info.file_size, 0)
        if total > MAX_UNPACKED_BYTES:
            raise UpdateError("The update archive is too large")
        planned.append((info, target))
    if len(planned) > MAX_FILES:
        raise UpdateError("The update archive has too many files")
    return planned


def _payload_root(dest: Path) -> Path:
    if (dest / "TitaniumTimetables.exe").is_file():
        return dest
    folders = [path for path in dest.iterdir() if path.is_dir()]
    files = [path for path in dest.iterdir() if path.is_file()]
    if len(folders) == 1 and not files and (folders[0] / "TitaniumTimetables.exe").is_file():
        return folders[0]
    raise UpdateError("The update archive does not contain TitaniumTimetables.exe")


def _updates_dir() -> Path:
    override = os.environ.get("SCHEDULING_DATA_DIR")
    if override:
        root = Path(override)
    elif getattr(sys, "frozen", False):
        root = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "TitaniumTimetables"
    else:
        root = Path(__file__).resolve().parents[3] / "data"
    path = root / "updates"
    path.mkdir(parents=True, exist_ok=True)
    return path
