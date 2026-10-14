param(
  [Parameter(Mandatory)] [string]$AppDir,
  [string]$InstanceRoot,
  [string]$FrontendPort,
  [string]$ApiPort,
  [string]$RedisPort
)
$ErrorActionPreference = 'Stop'
if (-not $InstanceRoot) { exit 0 }
if (-not [System.IO.Path]::IsPathRooted($InstanceRoot)) { throw 'InstanceRoot must be absolute' }
$ports = @($FrontendPort, $ApiPort, $RedisPort)
foreach ($portText in $ports) {
  if ($portText -notmatch '^\d+$') { throw 'Invalid isolated port' }
  $portValue = [int]$portText
  if ($portValue -lt 1024 -or $portValue -gt 65535 -or $portValue -in @(3003,3004,6399)) { throw 'Unsafe isolated port' }
}
if (@($ports | Select-Object -Unique).Count -ne 3) { throw 'Ports must be distinct' }
$body = @{
  CAT_CAFE_DESKTOP_INSTANCE_ROOT = [System.IO.Path]::GetFullPath($InstanceRoot)
  FRONTEND_PORT = $FrontendPort
  API_SERVER_PORT = $ApiPort
  REDIS_PORT = $RedisPort
} | ConvertTo-Json -Compress
$marker = Join-Path $AppDir 'desktop-dist\desktop-instance.json'
[System.IO.File]::WriteAllText($marker, $body, [System.Text.UTF8Encoding]::new($false))
