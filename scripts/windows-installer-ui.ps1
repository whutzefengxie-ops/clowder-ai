function Test-InstallerConsoleUi {
    if (-not ([Environment]::UserInteractive) -or $env:CI) {
        return $false
    }
    try {
        [void][Console]::CursorVisible
        return $true
    } catch {
        return $false
    }
}

function Get-InstallerOptionText {
    param($Option)
    return ([string]$Option.Label).Replace("&", "")
}

function Write-InstallerChoiceScreen {
    param(
        [string]$Title,
        [string]$Prompt,
        [string]$Instructions,
        [object[]]$Options,
        [int]$ActiveIndex,
        [hashtable]$SelectedMap
    )

    Clear-Host
    Write-Host ""
    Write-Host "$Title :" -ForegroundColor White
    Write-Host $Prompt -ForegroundColor White
    Write-Host $Instructions -ForegroundColor Gray
    Write-Host ""

    for ($i = 0; $i -lt $Options.Count; $i++) {
        $prefix = if ($i -eq $ActiveIndex) { "> " } else { "  " }
        $marker = ""
        if ($SelectedMap) {
            $marker = if ($SelectedMap.ContainsKey($i)) { "◉ " } else { "◯ " }
        }
        $line = "$prefix$marker$(Get-InstallerOptionText $Options[$i])"
        $color = if ($i -eq $ActiveIndex) { "Cyan" } else { "White" }
        Write-Host $line -ForegroundColor $color
    }
}

function Select-InstallerChoice {
    param([string]$Title, [string]$Prompt, [object[]]$Options, [int]$DefaultIndex = 0)
    if ($Options.Count -eq 0) { return $null }
    if (-not (Test-InstallerConsoleUi)) {
        return $Options[$DefaultIndex].Value
    }

    $index = [Math]::Max(0, [Math]::Min($DefaultIndex, $Options.Count - 1))
    $cursorVisible = $true
    try {
        $cursorVisible = [Console]::CursorVisible
        [Console]::CursorVisible = $false
    } catch {}

    try {
        while ($true) {
            Write-InstallerChoiceScreen -Title $Title -Prompt $Prompt -Instructions "Use ↑↓ arrows to move, Enter to select" -Options $Options -ActiveIndex $index
            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                "UpArrow" { $index = if ($index -le 0) { $Options.Count - 1 } else { $index - 1 } }
                "DownArrow" { $index = if ($index -ge ($Options.Count - 1)) { 0 } else { $index + 1 } }
                "Enter" { return $Options[$index].Value }
            }
        }
    } finally {
        try { [Console]::CursorVisible = $cursorVisible } catch {}
    }
}

function Select-InstallerMultiChoice {
    param([string]$Title, [string]$Prompt, [object[]]$Options)
    if ($Options.Count -eq 0) { return @() }
    if (-not (Test-InstallerConsoleUi)) {
        return @($Options)
    }

    $index = 0
    $selectedMap = @{}
    for ($i = 0; $i -lt $Options.Count; $i++) {
        $selectedMap[$i] = $true
    }

    $cursorVisible = $true
    try {
        $cursorVisible = [Console]::CursorVisible
        [Console]::CursorVisible = $false
    } catch {}

    try {
        while ($true) {
            Write-InstallerChoiceScreen -Title $Title -Prompt $Prompt -Instructions "Use ↑↓ to move, Space to toggle, Enter to confirm" -Options $Options -ActiveIndex $index -SelectedMap $selectedMap
            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                "UpArrow" { $index = if ($index -le 0) { $Options.Count - 1 } else { $index - 1 } }
                "DownArrow" { $index = if ($index -ge ($Options.Count - 1)) { 0 } else { $index + 1 } }
                "Spacebar" {
                    if ($selectedMap.ContainsKey($index)) {
                        $selectedMap.Remove($index) | Out-Null
                    } else {
                        $selectedMap[$index] = $true
                    }
                }
                "Enter" {
                    $selected = @()
                    foreach ($selectedIndex in ($selectedMap.Keys | Sort-Object)) {
                        $selected += $Options[$selectedIndex]
                    }
                    return @($selected)
                }
            }
        }
    } finally {
        try { [Console]::CursorVisible = $cursorVisible } catch {}
    }
}

function Resolve-InstallerRedisPlan {
    $mode = if (Test-InstallerConsoleUi) {
        Select-InstallerChoice -Title "Redis setup" -Prompt "Choose how this workspace should store runtime data" -Options @(
            @{ Label = "&Install Redis locally (recommended / 推荐)"; Help = "Download or reuse the project-local portable Redis bundle"; Value = "portable" },
            @{ Label = "&Use external Redis URL / 使用外部 Redis"; Help = "Use an existing external Redis instance"; Value = "external" }
        )
    } else { "portable" }

    $redisUrl = if ($mode -eq "external") { Read-Host "  External Redis URL" } else { "" }
    if ($mode -eq "external" -and -not $redisUrl) {
        Write-Warn "External Redis URL empty — using local Redis setup"
        $mode = "portable"
    }
    return [pscustomobject]@{ Mode = $mode; RedisUrl = $redisUrl }
}

function Apply-InstallerRedisPlan {
    param($State, [string]$ProjectRoot, $Plan)
    if ($Plan.Mode -eq "external") {
        Set-InstallerEnvValue $State "REDIS_URL" $Plan.RedisUrl
        Add-InstallerEnvDelete $State "MEMORY_STORE"
        Write-Ok "Using external Redis: $($Plan.RedisUrl)"
        return $true
    }

    Add-InstallerEnvDelete $State "REDIS_URL"
    Add-InstallerEnvDelete $State "MEMORY_STORE"
    return (Ensure-WindowsRedis -ProjectRoot $ProjectRoot -Memory:$false)
}
