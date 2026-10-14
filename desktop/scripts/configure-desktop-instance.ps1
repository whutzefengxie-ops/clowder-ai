param(
  [Parameter(Mandatory)] [string]$AppDir,
  [string]$InstanceRoot,
  [string]$FrontendPort,
  [string]$ApiPort,
  [string]$RedisPort
)
$ErrorActionPreference = 'Stop'
function Assert-Identity($identity) {
  if ($identity -isnot [pscustomobject] -or -not $identity.CAT_CAFE_DESKTOP_INSTANCE_ROOT -or
      -not [IO.Path]::IsPathRooted($identity.CAT_CAFE_DESKTOP_INSTANCE_ROOT)) { throw 'Invalid instance root' }
  $ports = @($identity.FRONTEND_PORT, $identity.API_SERVER_PORT, $identity.REDIS_PORT)
  foreach ($text in $ports) {
    if ($text -notmatch '^\d+$') { throw 'Invalid isolated port' }
    $value = [int]$text
    if ($value -lt 1024 -or $value -gt 65535 -or $value -in @(3003,3004,6399)) { throw 'Unsafe isolated port' }
  }
  if (@($ports | ForEach-Object { [int]$_ } | Select-Object -Unique).Count -ne 3) { throw 'Ports must be distinct' }
}
$marker = Join-Path $AppDir 'desktop-instance.json'
$legacy = Join-Path $AppDir 'desktop-dist\desktop-instance.json'
$saved = $null
$body = $null
$existing = if (Test-Path -LiteralPath $marker) { $marker } elseif (Test-Path -LiteralPath $legacy) { $legacy } else { $null }
if ($existing) {
  $body = [IO.File]::ReadAllText($existing, [Text.Encoding]::UTF8)
  $saved = $body | ConvertFrom-Json
  Assert-Identity $saved
}
if ($InstanceRoot) {
  $requested = [pscustomobject]@{
    CAT_CAFE_DESKTOP_INSTANCE_ROOT = [IO.Path]::GetFullPath($InstanceRoot)
    FRONTEND_PORT = $FrontendPort
    API_SERVER_PORT = $ApiPort
    REDIS_PORT = $RedisPort
  }
  if (-not [IO.Path]::IsPathRooted($InstanceRoot)) { throw 'InstanceRoot must be absolute' }
  Assert-Identity $requested
  if ($saved) {
    foreach ($key in @('CAT_CAFE_DESKTOP_INSTANCE_ROOT','FRONTEND_PORT','API_SERVER_PORT','REDIS_PORT')) {
      if ($requested.$key -ne $saved.$key) { throw 'Explicit instance settings conflict with existing installation' }
    }
  } else { $body = $requested | ConvertTo-Json -Compress }
} elseif ($FrontendPort -or $ApiPort -or $RedisPort) { throw 'InstanceRoot is required with isolated ports' }
if (-not $body -or (Test-Path -LiteralPath $marker)) { exit 0 }
# Keep this install-owned record outside the payload replacement boundary.
# A failed extraction can be retried without losing the original instance.
[IO.Directory]::CreateDirectory($AppDir) | Out-Null
$temporary = "$marker.$PID.tmp"
try {
  [IO.File]::WriteAllText($temporary, $body, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $marker
} finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
