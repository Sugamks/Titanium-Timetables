# Registers .ttl for the current Windows user so a double-click opens this timetable app.
# A bare .ttl cannot ask Windows to install the app. That prompt needs the hosting URL.
$ErrorActionPreference = "Stop"
$Serve = Join-Path $PSScriptRoot "serve.py"
$Py = Join-Path $PSScriptRoot "..\..\.venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  $Py = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $Py) { throw "python was not found" }
$Exe = Get-ChildItem -Path (Join-Path $PSScriptRoot "..\..\dist") -Recurse -Filter "TitaniumTimetables.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\build\\" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($Exe) {
  $Command = "`"$($Exe.FullName)`" `"%1`""
} else {
  $Command = "`"$Py`" `"$Serve`" `"%1`""
}
$Icon = Join-Path $PSScriptRoot "scheduling.ico"
New-Item -Path "HKCU:\Software\Classes\SchdTtl\shell\open\command" -Force | Out-Null
New-Item -Path "HKCU:\Software\Classes\SchdTtl\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\SchdTtl" -Name "(default)" -Value "School timetable"
Set-ItemProperty -Path "HKCU:\Software\Classes\.ttl" -Name "(default)" -Value "SchdTtl"
Set-ItemProperty -Path "HKCU:\Software\Classes\SchdTtl\shell\open\command" -Name "(default)" -Value $Command
Set-ItemProperty -Path "HKCU:\Software\Classes\SchdTtl\DefaultIcon" -Name "(default)" -Value "`"$Icon`",0"
Write-Host "Double-click a .ttl file to open it in this app."
Write-Host $Command
