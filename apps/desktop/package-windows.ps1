# Builds TitaniumTimetables.exe and a per-user MSI.
# The MSI installs to %LocalAppData%\Programs\TitaniumTimetables.
# Saved .ttl files are written in that same folder, next to TitaniumTimetables.exe.
#
# The Microsoft Store does not accept this MSI. Store submissions must be MSIX,
# and a Store package cannot write files next to the installed exe.
param(
  [string]$Version = "1.0.0.0",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
  throw "Version must look like 1.0.0 or 1.0.0.0"
}
if ($Version.Split(".").Count -eq 3) { $Version = "$Version.0" }

if (-not $SkipBuild) {
  & (Join-Path $PSScriptRoot "build.ps1")
}

$Built = Get-ChildItem -Path (Join-Path $Root "dist") -Recurse -Filter "TitaniumTimetables.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\msi-stage\\' -and (Test-Path (Join-Path $_.DirectoryName "_internal")) } |
  Sort-Object { $_.FullName.Length } |
  Select-Object -First 1
if (-not $Built) {
  throw "TitaniumTimetables.exe was not found. Run apps\desktop\build.ps1 first."
}

$Stage = Join-Path $Root "dist\msi-stage"
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
& robocopy $Built.DirectoryName $Stage /E /XF *.ttl /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Could not stage $Built.DirectoryName" }

$Msi = Join-Path $Root "dist\TitaniumTimetables.msi"
$Wxs = Join-Path $PSScriptRoot "scheduling.wxs"
$Wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $Wix) {
  $Wix = Get-ChildItem -Path "${env:ProgramFiles}\WiX Toolset*" -Recurse -Filter "wix.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
}
if (-not $Wix) {
  throw @"
WiX is not installed, so the MSI was not built.
The exe is ready: $($Built.FullName)
Install WiX, then run this script again with -SkipBuild:
  winget install WiXToolset.WiXCLI
"@
}
$WixExe = if ($Wix.Source) { $Wix.Source } else { $Wix.FullName }

Write-Host "Building $Msi"
& $WixExe extension add WixToolset.Util.wixext
if ($LASTEXITCODE -ne 0) { throw "wix extension add failed" }
& $WixExe build --acceptEula wix7 -ext WixToolset.Util.wixext -bindpath "SourceDir=$Stage" -d "Version=$Version" -o $Msi $Wxs
if ($LASTEXITCODE -ne 0) { throw "wix build failed" }

Write-Host "Exe folder: $($Built.DirectoryName)"
Write-Host "MSI: $Msi"
Write-Host "Installs to %LocalAppData%\Programs\TitaniumTimetables"
Write-Host "That folder holds TitaniumTimetables.exe and the .ttl files."
Write-Host "Start menu: Titanium Timetables, and Timetable files (opens the folder)."
