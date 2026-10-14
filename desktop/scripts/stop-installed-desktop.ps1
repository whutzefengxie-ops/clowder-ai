param(
  [Parameter(Mandatory)] [string]$AppDir,
  [string]$InstanceRoot,
  [switch]$InspectOnly,
  [ValidateRange(0,15)] [int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $AppDir)) { exit 0 }
# Resolve junction/8.3 spellings by filesystem handle, retaining the directory boundary.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class InstallPathIdentity {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder result, uint size, uint flags);
  public static string Resolve(string path) {
    using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
      if (handle.IsInvalid) throw new System.ComponentModel.Win32Exception();
      var text = new StringBuilder(32768);
      uint count = GetFinalPathNameByHandle(handle, text, (uint)text.Capacity, 0);
      if (count == 0 || count >= text.Capacity) throw new System.ComponentModel.Win32Exception();
      var final = text.ToString();
      if (final.StartsWith(@"\\?\UNC\")) return @"\\" + final.Substring(8);
      return final.StartsWith(@"\\?\") ? final.Substring(4) : final;
    }
  }
}
'@
$installRoot = [InstallPathIdentity]::Resolve($AppDir).TrimEnd('\')
$installPrefix = $installRoot + '\'
function Get-OwnedInstallProcesses {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $processPath = $_.Path
    if ($processPath) {
      $processPath = [InstallPathIdentity]::Resolve($processPath)
      $processPath.StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    }
  })
}
if ($InspectOnly) {
  @(Get-OwnedInstallProcesses | ForEach-Object { $_.Id }) | ConvertTo-Json -Compress
  exit 0
}
$exe = Join-Path $installRoot 'desktop-dist\Clowder AI.exe'
$marker = Join-Path $installRoot 'desktop-instance.json'
if (-not (Test-Path -LiteralPath $marker)) { $marker = Join-Path $installRoot 'desktop-dist\desktop-instance.json' }
$supported = Join-Path $installRoot 'desktop-dist\resources\app\installation-lifecycle.js'
# An isolated upgrade without a persistent marker cannot use the default lock.
if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $supported) -and (-not $InstanceRoot -or (Test-Path -LiteralPath $marker))) {
  Start-Process -FilePath $exe -ArgumentList '--quit-owned-installation' -WindowStyle Hidden
}
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (@(Get-OwnedInstallProcesses).Count -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 250
}
# Bounded cleanup is restricted to executables within this exact installation.
Get-OwnedInstallProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
if (@(Get-OwnedInstallProcesses).Count -ne 0) { exit 1 }
