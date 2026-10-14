param(
  [Parameter(Mandatory)] [string]$AppDir,
  [string]$InstanceRoot,
  [switch]$InspectOnly,
  [ValidateRange(0,15)] [int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Stop'
$installRoot = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\')
$installPrefix = $installRoot + '\'
function Get-OwnedInstallProcesses {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  })
}
if ($InspectOnly) {
  @(Get-OwnedInstallProcesses | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress
  exit 0
}
$exe = Join-Path $installRoot 'desktop-dist\Clowder AI.exe'
$marker = Join-Path $installRoot 'desktop-dist\desktop-instance.json'
# An isolated upgrade without a persistent marker cannot use the default lock.
if ((Test-Path -LiteralPath $exe) -and (-not $InstanceRoot -or (Test-Path -LiteralPath $marker))) {
  Start-Process -FilePath $exe -ArgumentList '--quit-for-update' -WindowStyle Hidden
}
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (@(Get-OwnedInstallProcesses).Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 250
}
# Bounded cleanup is restricted to executables within this exact installation.
Get-OwnedInstallProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
if (@(Get-OwnedInstallProcesses).Count -ne 0) { exit 1 }
