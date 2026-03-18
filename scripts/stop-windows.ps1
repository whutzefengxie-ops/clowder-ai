<#
.SYNOPSIS
  Clowder AI (Cat Cafe) - Windows Stop Script

.DESCRIPTION
  Stops Cat Cafe services (API, Frontend, Redis) by port.

.EXAMPLE
  .\scripts\stop-windows.ps1
#>

$ErrorActionPreference = "Continue"

function Write-Ok   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  [!!] $msg" -ForegroundColor Yellow }

$ScriptPath = if ($PSCommandPath) { $PSCommandPath } elseif ($MyInvocation.MyCommand.Path) { $MyInvocation.MyCommand.Path } else { $null }
$ScriptDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $null }
if ($ScriptDir) {
    . (Join-Path $ScriptDir "install-windows-helpers.ps1")
}
$ProjectRoot = if ($ScriptDir) { Split-Path -Parent $ScriptDir } else { $null }

Write-Host "Cat Cafe - Stopping services" -ForegroundColor Cyan
Write-Host "============================="

# Load .env for port config
$envFile = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) ".env"
$ApiPort = 3004
$WebPort = 3003
$RedisPort = 6379

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Count -eq 2) {
                $key = $parts[0].Trim()
                $val = $parts[1].Trim().Trim('"').Trim("'")
                switch ($key) {
                    "API_SERVER_PORT" { $ApiPort = [int]$val }
                    "FRONTEND_PORT"   { $WebPort = [int]$val }
                    "REDIS_PORT"      { $RedisPort = [int]$val }
                }
            }
        }
    }
}

$configuredRedisUrl = if ($env:REDIS_URL) { $env:REDIS_URL.Trim() } else { Get-InstallerEnvValueFromFile -EnvFile $envFile -Key "REDIS_URL" }

function Stop-PortProcess {
    param([int]$Port, [string]$Name)
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Write-Ok "Stopped $Name (port $Port)"
    } else {
        Write-Warn "$Name (port $Port) - not running"
    }
}

Stop-PortProcess -Port $ApiPort -Name "API Server"
Stop-PortProcess -Port $WebPort -Name "Frontend"

# Stop Redis if running on our port
$redisCommands = $null
if ($ProjectRoot) {
    $redisCommands = Resolve-PortableRedisBinaries -ProjectRoot $ProjectRoot
}
if (-not $redisCommands) {
    $redisCommands = Resolve-GlobalRedisBinaries
}

if ($configuredRedisUrl -and -not (Test-LocalRedisUrl -RedisUrl $configuredRedisUrl -RedisPort $RedisPort)) {
    Write-Warn "Skipping local Redis shutdown because REDIS_URL points to an external host"
} else {
    try {
        if (-not $redisCommands -or -not $redisCommands.CliPath) {
            throw "redis-cli unavailable"
        }
        $redisCli = $redisCommands.CliPath
        $redisPing = & $redisCli -p $RedisPort ping 2>$null
        if ($redisPing -eq "PONG") {
            & $redisCli -p $RedisPort shutdown save 2>$null
            Write-Ok "Redis stopped (port $RedisPort)"
        } else {
            Write-Warn "Redis (port $RedisPort) - not running"
        }
    } catch {
        Write-Warn "Redis (port $RedisPort) - not running"
    }
}

Write-Host "`nAll services stopped." -ForegroundColor Green
