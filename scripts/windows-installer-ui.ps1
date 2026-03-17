function Select-InstallerChoice {
    param([string]$Title, [string]$Prompt, [object[]]$Options, [int]$DefaultIndex = 0)
    if (-not ([Environment]::UserInteractive) -or $env:CI -or -not $host.UI) {
        return $Options[$DefaultIndex].Value
    }
    $choices = @()
    foreach ($option in $Options) {
        $choices += New-Object System.Management.Automation.Host.ChoiceDescription $option.Label, $option.Help
    }
    $selected = $host.UI.PromptForChoice($Title, $Prompt, $choices, $DefaultIndex)
    return $Options[$selected].Value
}

function Select-InstallerMultiChoice {
    param([string]$Title, [string]$Prompt, [object[]]$Options)
    if ($Options.Count -eq 0) { return @() }
    $mode = Select-InstallerChoice -Title $Title -Prompt $Prompt -Options @(
        @{ Label = "&All"; Help = "Install all listed options"; Value = "all" },
        @{ Label = "&Select"; Help = "Review each option one by one"; Value = "select" },
        @{ Label = "&None"; Help = "Skip all listed options"; Value = "none" }
    )
    if ($mode -eq "all") { return @($Options) }
    if ($mode -eq "none") { return @() }
    $selected = @()
    foreach ($option in $Options) {
        $installThis = Select-InstallerChoice -Title $Title -Prompt "Install $($option.Name)?" -Options @(
            @{ Label = "&Yes"; Help = "Install this tool"; Value = $true },
            @{ Label = "&No"; Help = "Skip this tool"; Value = $false }
        )
        if ($installThis) { $selected += $option }
    }
    return @($selected)
}

function Resolve-InstallerRedisPlan {
    param([switch]$Memory)
    if ($Memory) { return [pscustomobject]@{ Mode = "memory"; RedisUrl = "" } }
    $mode = if ([Environment]::UserInteractive -and -not $env:CI) {
        Select-InstallerChoice -Title "Redis mode" -Prompt "Choose how this workspace should store runtime data" -Options @(
            @{ Label = "&Portable"; Help = "Download or reuse the project-local portable Redis bundle (recommended)"; Value = "portable" },
            @{ Label = "&External"; Help = "Use an existing external Redis URL"; Value = "external" },
            @{ Label = "&Memory"; Help = "Use in-memory storage only"; Value = "memory" }
        )
    } else { "portable" }
    $redisUrl = if ($mode -eq "external") { Read-Host "  External Redis URL" } else { "" }
    if ($mode -eq "external" -and -not $redisUrl) {
        Write-Warn "External Redis URL empty — using memory storage"
        $mode = "memory"
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
    if ($Plan.Mode -eq "portable") {
        Add-InstallerEnvDelete $State "REDIS_URL"
        Add-InstallerEnvDelete $State "MEMORY_STORE"
        return (Ensure-WindowsRedis -ProjectRoot $ProjectRoot -Memory:$false)
    }
    Add-InstallerEnvDelete $State "REDIS_URL"
    Set-InstallerEnvValue $State "MEMORY_STORE" "1"
    Write-Warn "Memory mode — data will be lost on restart"
    return $false
}
