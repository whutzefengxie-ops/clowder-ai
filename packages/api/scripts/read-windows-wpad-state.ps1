# Reads Windows WPAD state using WinHTTP API
# Returns JSON with autoDetect (bool or null) and autoConfigUrl (string or null)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WinHttpProxy {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WINHTTP_CURRENT_USER_IE_PROXY_CONFIG {
        [MarshalAs(UnmanagedType.Bool)]
        public bool fAutoDetect;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszAutoConfigUrl;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszProxy;
        [MarshalAs(UnmanagedType.LPWStr)]
        public string lpszProxyBypass;
    }

    [DllImport("winhttp.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WinHttpGetIEProxyConfigForCurrentUser(
        ref WINHTTP_CURRENT_USER_IE_PROXY_CONFIG pProxyConfig);
}
"@

$config = New-Object WinHttpProxy+WINHTTP_CURRENT_USER_IE_PROXY_CONFIG
$success = [WinHttpProxy]::WinHttpGetIEProxyConfigForCurrentUser([ref]$config)

if ($success) {
    $result = @{
        autoDetect = $config.fAutoDetect
        autoConfigUrl = $config.lpszAutoConfigUrl
    }
    $result | ConvertTo-Json -Compress
} else {
    $errorCode = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    $errorResult = @{
        autoDetect = $null
        autoConfigUrl = $null
        error = "WinHttpGetIEProxyConfigForCurrentUser failed with error code $errorCode"
    }
    $errorResult | ConvertTo-Json -Compress
}
