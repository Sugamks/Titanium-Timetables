param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("open", "save")]
  [string]$Kind,
  [string]$Name = ""
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
if ($Kind -eq "save") {
  $dlg = New-Object System.Windows.Forms.SaveFileDialog
  $dlg.Title = "Save a copy of this timetable"
} else {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = "Open a timetable"
}
$dlg.Filter = "Timetable (*.ttl)|*.ttl"
$dlg.DefaultExt = "ttl"
$dlg.AddExtension = $true
if ($Kind -eq "save" -and $Name) {
  $dlg.FileName = $Name
}
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.FileName
}
