$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

Write-Host "Building web UI..."
Set-Location (Join-Path $Root "apps\web")
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Set-Location $Root
$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { $Py = "python" }

Write-Host "Installing PyInstaller..."
& $Py -m pip install -q "pyinstaller>=6.10"
if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller failed" }

Write-Host "Packaging TitaniumTimetables.exe..."
& $Py -m PyInstaller --noconfirm --clean (Join-Path $Root "apps\desktop\scheduling.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$Out = Join-Path $Root "dist\TitaniumTimetables"
Write-Host "Done. Run: $Out\TitaniumTimetables.exe"
Write-Host "MSI: powershell -ExecutionPolicy Bypass -File apps\desktop\package-windows.ps1"
