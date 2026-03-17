function Resolve-ToolCommand {
    param([string]$Name)
    $toolCommand = Get-Command $Name -ErrorAction SilentlyContinue
    if ($toolCommand -and $toolCommand.Path) { return $toolCommand.Path }
    if ($toolCommand -and $toolCommand.Source) { return $toolCommand.Source }
    $candidates = @()
    if ($env:APPDATA) { $candidates += Join-Path $env:APPDATA "npm\$Name.cmd" }
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmCommand) {
        $npmPath = if ($npmCommand.Path) { $npmCommand.Path } else { $npmCommand.Source }
        try {
            $npmPrefix = @(& $npmPath prefix -g 2>$null) | Select-Object -Last 1
            if ($npmPrefix) { $candidates += Join-Path $npmPrefix "$Name.cmd" }
        } catch {}
    }
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) {
        $nodePath = if ($nodeCommand.Path) { $nodeCommand.Path } else { $nodeCommand.Source }
        if ($nodePath) { $candidates += Join-Path (Split-Path -Parent $nodePath) "$Name.cmd" }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path $candidate) {
            Add-ProcessPathPrefix -Directory (Split-Path -Parent $candidate)
            return $candidate
        }
    }
    return $null
}

function Invoke-ToolCommand {
    param([string]$Name, [string[]]$CommandArgs)
    $toolCommand = Resolve-ToolCommand -Name $Name
    if (-not $toolCommand) { throw "$Name command not found" }
    & $toolCommand @CommandArgs
}
