. (Join-Path $PSScriptRoot "windows-command-helpers.ps1")

function Mount-InstallerSkills {
    param([string]$ProjectRoot)

    $skillsSource = Join-Path $ProjectRoot "cat-cafe-skills"
    $cliDirs = @("$env:USERPROFILE\.claude", "$env:USERPROFILE\.codex", "$env:USERPROFILE\.gemini")
    if (-not (Test-Path $skillsSource)) {
        Write-Warn "cat-cafe-skills/ not found — skills mount skipped"
        return
    }

    $skillItems = Get-ChildItem $skillsSource -Directory | Where-Object { $_.Name -ne "refs" }
    foreach ($cliDir in $cliDirs) {
        $skillsRoot = Join-Path $cliDir "skills"
        if (-not (Test-Path $skillsRoot)) {
            New-Item -Path $skillsRoot -ItemType Directory -Force | Out-Null
        }
        foreach ($skill in $skillItems) {
            $skillTarget = Join-Path $skillsRoot $skill.Name
            if (Test-Path $skillTarget) {
                Write-Ok "Skill already mounted: $skillTarget"
                continue
            }
            try {
                cmd /c mklink /J "$skillTarget" "$($skill.FullName)" 2>$null | Out-Null
                if (Test-Path $skillTarget) {
                    Write-Ok "Skill mounted: $skillTarget"
                } else {
                    throw "junction failed"
                }
            } catch {
                Write-Warn "Could not create junction for $skillTarget"
                Write-Warn "Run manually: mklink /J `"$skillTarget`" `"$($skill.FullName)`""
            }
        }
    }
}

function Add-ProcessPathPrefix {
    param([string]$Directory)
    if (-not $Directory -or -not (Test-Path $Directory)) {
        return
    }
    $segments = @($env:Path -split ";" | Where-Object { $_ })
    if ($segments -notcontains $Directory) {
        $env:Path = "$Directory;$env:Path"
    }
}

function Resolve-PortableRedisLayout {
    param([string]$ProjectRoot)
    $root = Join-Path $ProjectRoot ".cat-cafe\redis\windows"
    [pscustomobject]@{
        Root = $root
        ArchiveDir = Join-Path $root "archives"
        Current = Join-Path $root "current"
        Data = Join-Path $root "data"
        Logs = Join-Path $root "logs"
        VersionFile = Join-Path $root "current-release.txt"
    }
}

function Resolve-PortableRedisBinaries {
    param([string]$ProjectRoot)
    if (-not $ProjectRoot) { return $null }
    $layout = Resolve-PortableRedisLayout -ProjectRoot $ProjectRoot
    if (-not (Test-Path $layout.Current)) { return $null }
    $redisServer = Get-ChildItem $layout.Current -Recurse -Filter "redis-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    $redisCli = Get-ChildItem $layout.Current -Recurse -Filter "redis-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $redisServer -or -not $redisCli) { return $null }
    Add-ProcessPathPrefix -Directory $redisServer.Directory.FullName
    [pscustomobject]@{
        Source = "project-local"
        ServerPath = $redisServer.FullName
        CliPath = $redisCli.FullName
        BinDir = $redisServer.Directory.FullName
    }
}

function Resolve-GlobalRedisBinaries {
    $redisServer = Get-Command redis-server -ErrorAction SilentlyContinue
    $redisCli = Get-Command redis-cli -ErrorAction SilentlyContinue
    if (-not $redisServer -or -not $redisCli) { return $null }
    [pscustomobject]@{
        Source = "global"
        ServerPath = $redisServer.Source
        CliPath = $redisCli.Source
        BinDir = Split-Path -Parent $redisServer.Source
    }
}

function Ensure-WindowsRedis {
    param([string]$ProjectRoot, [switch]$Memory)
    if ($Memory) {
        Write-Warn "Memory mode (-Memory) — skipping Redis detection"
        return $false
    }

    $portableRedis = Resolve-PortableRedisBinaries -ProjectRoot $ProjectRoot
    if ($portableRedis) {
        Write-Ok "Redis available ($($portableRedis.Source)): $($portableRedis.BinDir)"
        return $true
    }

    $globalRedis = Resolve-GlobalRedisBinaries
    if ($globalRedis) {
        Write-Ok "Redis available ($($globalRedis.Source)): $($globalRedis.BinDir)"
        return $true
    }

    Write-Warn "Redis not found — attempting portable install into .cat-cafe/redis/windows"
    try {
        $layout = Resolve-PortableRedisLayout -ProjectRoot $ProjectRoot
        $headers = @{ "User-Agent" = "ClowderAI-Installer" }
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/redis-windows/redis-windows/releases/latest" -Headers $headers
        $asset = $release.assets | Where-Object { $_.name -match "^Redis-.*-Windows-x64-msys2\.zip$" } | Select-Object -First 1
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -match "^Redis-.*-Windows-x64-cygwin\.zip$" } | Select-Object -First 1
        }
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -match "^Redis-.*-Windows-x64-msys2-with-Service\.zip$" } | Select-Object -First 1
        }
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -match "^Redis-.*-Windows-x64-cygwin-with-Service\.zip$" } | Select-Object -First 1
        }
        if (-not $asset) {
            throw "No Windows Redis zip asset found in latest release"
        }

        $archivePath = Join-Path $layout.ArchiveDir $asset.name

        New-Item -Path $layout.ArchiveDir -ItemType Directory -Force | Out-Null
        New-Item -Path $layout.Root -ItemType Directory -Force | Out-Null
        if (Test-Path $layout.Current) {
            Remove-Item -Path $layout.Current -Recurse -Force
        }

        Write-Host "  Downloading $($asset.name)..."
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -Headers $headers -UseBasicParsing
        Expand-Archive -Path $archivePath -DestinationPath $layout.Current -Force

        $portableRedis = Resolve-PortableRedisBinaries -ProjectRoot $ProjectRoot
        if (-not $portableRedis) {
            throw "Redis executables were not found after extraction"
        }

        Set-Content -Path $layout.VersionFile -Value $release.tag_name -Encoding ascii
        Write-Ok "Redis installed: $($portableRedis.BinDir)"
        Write-Warn "Portable Redis will be reused from .cat-cafe/redis/windows on later starts."
        return $true
    } catch {
        Write-Warn "Redis auto-install failed — using in-memory storage"
        Write-Warn "Manual fallback: https://github.com/redis-windows/redis-windows/releases"
        return $false
    }
}

function New-InstallerAuthState {
    param([string]$ProjectRoot)
    [pscustomobject]@{
        ProjectRoot = $ProjectRoot
        HelperPath = Join-Path $ProjectRoot "scripts\install-auth-config.mjs"
        EnvSetMap = [ordered]@{}
        EnvDeleteMap = @{}
    }
}

function Set-InstallerEnvValue {
    param($State, [string]$Key, [string]$Value)
    $State.EnvSetMap[$Key] = $Value
    if ($State.EnvDeleteMap.ContainsKey($Key)) {
        $State.EnvDeleteMap.Remove($Key) | Out-Null
    }
}

function Add-InstallerEnvDelete {
    param($State, [string]$Key)
    if ($State.EnvSetMap.Contains($Key)) {
        $State.EnvSetMap.Remove($Key)
    }
    $State.EnvDeleteMap[$Key] = $true
}

function Invoke-InstallerAuthHelper {
    param($State, [string[]]$CommandArgs)
    if (-not (Test-Path $State.HelperPath)) {
        throw "Missing install auth helper: $($State.HelperPath)"
    }
    & node $State.HelperPath @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "install auth helper failed"
    }
}

function Set-CodexOAuthMode {
    param($State)
    Set-InstallerEnvValue $State "CODEX_AUTH_MODE" "oauth"
    Add-InstallerEnvDelete $State "OPENAI_API_KEY"
    Add-InstallerEnvDelete $State "OPENAI_BASE_URL"
    Add-InstallerEnvDelete $State "CAT_CODEX_MODEL"
}

function Set-CodexApiKeyMode {
    param($State, [string]$ApiKey, [string]$BaseUrl, [string]$Model)

    Set-InstallerEnvValue $State "CODEX_AUTH_MODE" "api_key"
    Set-InstallerEnvValue $State "OPENAI_API_KEY" $ApiKey
    if ($BaseUrl) { Set-InstallerEnvValue $State "OPENAI_BASE_URL" $BaseUrl } else { Add-InstallerEnvDelete $State "OPENAI_BASE_URL" }
    if ($Model) { Set-InstallerEnvValue $State "CAT_CODEX_MODEL" $Model } else { Add-InstallerEnvDelete $State "CAT_CODEX_MODEL" }
}

function Set-GeminiOAuthMode {
    param($State)
    Add-InstallerEnvDelete $State "GEMINI_API_KEY"
    Add-InstallerEnvDelete $State "CAT_GEMINI_MODEL"
}

function Set-GeminiApiKeyMode {
    param($State, [string]$ApiKey, [string]$Model)

    Set-InstallerEnvValue $State "GEMINI_API_KEY" $ApiKey
    if ($Model) { Set-InstallerEnvValue $State "CAT_GEMINI_MODEL" $Model } else { Add-InstallerEnvDelete $State "CAT_GEMINI_MODEL" }
}

function Set-ClaudeInstallerProfile {
    param($State, [string]$ApiKey, [string]$BaseUrl, [string]$Model)

    $args = @("claude-profile", "set", "--project-dir", $State.ProjectRoot, "--api-key", $ApiKey)
    if ($BaseUrl) { $args += @("--base-url", $BaseUrl) }
    if ($Model) { $args += @("--model", $Model) }
    Invoke-InstallerAuthHelper $State $args
}

function Remove-ClaudeInstallerProfile {
    param($State)
    Invoke-InstallerAuthHelper $State @("claude-profile", "remove", "--project-dir", $State.ProjectRoot)
}

function Configure-InstallerAuth {
    param([string]$ProjectRoot, $State)

    $hasClaude = $null -ne (Resolve-ToolCommand -Name "claude")
    $hasCodex = $null -ne (Resolve-ToolCommand -Name "codex")
    $hasGemini = $null -ne (Resolve-ToolCommand -Name "gemini")
    $isInteractive = [Environment]::UserInteractive -and -not $env:CI

    if (-not $isInteractive) {
        Write-Warn "Non-interactive mode — skipping auth prompts. Run claude / codex / gemini manually after install."
        return
    }

    if ($hasClaude) {
        Write-Host ""
        Write-Host "  Claude (claude):"
        Write-Host "    1) OAuth / Subscription (recommended)"
        Write-Host "    2) API Key"
        $choice = Read-Host "    Choose [1/2] (default: 1)"
        if ($choice -eq "2") {
            $apiKey = Read-Host "    API Key"
            $baseUrl = Read-Host "    Base URL (Enter = https://api.anthropic.com)"
            $model = Read-Host "    Model (Enter = default)"
            if ($apiKey) {
                Set-ClaudeInstallerProfile $State $apiKey $baseUrl $model
                Write-Ok "Claude API key profile written to .cat-cafe/"
            } else {
                Remove-ClaudeInstallerProfile $State
                Write-Warn "Claude API key empty — keeping OAuth"
            }
        } else {
            Remove-ClaudeInstallerProfile $State
            Write-Ok "Claude: OAuth mode"
        }
    }

    if ($hasCodex) {
        Write-Host ""
        Write-Host "  Codex (codex):"
        Write-Host "    1) OAuth / Subscription (recommended)"
        Write-Host "    2) API Key"
        $choice = Read-Host "    Choose [1/2] (default: 1)"
        if ($choice -eq "2") {
            $apiKey = Read-Host "    API Key"
            $baseUrl = Read-Host "    Base URL (Enter = default)"
            $model = Read-Host "    Model (Enter = default)"
            if ($apiKey) {
                Set-CodexApiKeyMode $State $apiKey $baseUrl $model
                Write-Ok "Codex API key collected for .env"
            } else {
                Set-CodexOAuthMode $State
                Write-Warn "Codex API key empty — keeping OAuth"
            }
        } else {
            Set-CodexOAuthMode $State
            Write-Ok "Codex: OAuth mode"
        }
    }

    if ($hasGemini) {
        Write-Host ""
        Write-Host "  Gemini (gemini):"
        Write-Host "    1) OAuth / Subscription (recommended)"
        Write-Host "    2) API Key"
        $choice = Read-Host "    Choose [1/2] (default: 1)"
        if ($choice -eq "2") {
            $apiKey = Read-Host "    API Key"
            $model = Read-Host "    Model (Enter = default)"
            if ($apiKey) {
                Set-GeminiApiKeyMode $State $apiKey $model
                Write-Ok "Gemini API key collected for .env"
            } else {
                Set-GeminiOAuthMode $State
                Write-Warn "Gemini API key empty — keeping OAuth"
            }
        } else {
            Set-GeminiOAuthMode $State
            Write-Ok "Gemini: OAuth mode"
        }
    }
}

function Apply-InstallerAuthEnv {
    param($State, [string]$EnvFile)
    if ($State.EnvSetMap.Count -eq 0 -and $State.EnvDeleteMap.Count -eq 0) { return }
    $helperArgs = @("env-apply", "--env-file", $EnvFile)
    foreach ($key in $State.EnvSetMap.Keys) {
        $helperArgs += @("--set", "$key=$($State.EnvSetMap[$key])")
    }
    foreach ($key in $State.EnvDeleteMap.Keys) {
        $helperArgs += @("--delete", $key)
    }
    Invoke-InstallerAuthHelper $State $helperArgs
    Write-Ok "Auth config written to .env"
}
