/**
 * @fileoverview Codex network environment derivation for enterprise proxy compatibility.
 *
 * Issue #1666: Windows enterprise proxy environments may route localhost/127.0.0.1 requests
 * through the proxy, causing 504 errors when Codex tries to reach a local provider gateway.
 *
 * This module provides pure functions to derive Codex launch environment with loopback
 * addresses added to NO_PROXY, while preserving existing proxy configuration and internal
 * network exceptions.
 *
 * Design principles:
 * - Pure derivation from parent environment + overrides (no global process.env mutation)
 * - Preserve existing HTTP_PROXY/HTTPS_PROXY/ALL_PROXY and user-configured NO_PROXY
 * - Only add loopback addresses (localhost, 127.0.0.1, ::1) to exceptions
 * - Windows: respect ProxyOverride when env NO_PROXY is empty (hyper-util behavior)
 * - Safe degradation: preserve original environment if system exceptions cannot be read
 */

/**
 * Loopback addresses that should bypass proxy for local provider gateways.
 */
const LOOPBACK_ADDRESSES = ['localhost', '127.0.0.1', '::1'] as const;

/**
 * System proxy exception sources for diagnostics.
 */
export type ProxyExceptionSource = 'env' | 'system_static' | 'system_pac' | 'none' | 'read_failed';

/**
 * Derived network environment for Codex launch.
 */
export interface CodexNetworkEnvironment {
  /**
   * Final environment variables to pass to Codex process.
   * Contains merged NO_PROXY with loopback addresses added.
   */
  readonly env: NodeJS.ProcessEnv;

  /**
   * Diagnostic information (no credentials, safe for logging).
   */
  readonly diagnostic: {
    /** Whether any proxy environment variables are present */
    readonly hasProxy: boolean;
    /** Source of proxy exceptions used */
    readonly exceptionSource: ProxyExceptionSource;
    /** Whether loopback addresses were added */
    readonly loopbackAdded: boolean;
    /** Scenarios not covered by this implementation (empty if fully handled) */
    readonly unsupportedScenarios: readonly string[];
  };
}

/**
 * Windows system proxy configuration (read-only).
 */
export interface WindowsSystemProxyConfig {
  /** Static proxy server (from ProxyServer registry key) */
  readonly proxyServer?: string;
  /** Static proxy exceptions (from ProxyOverride registry key) */
  readonly proxyOverride?: string;
  /** Whether PAC/WPAD is configured */
  readonly hasPac: boolean;
}

/**
 * Options for reading Windows system proxy configuration.
 */
export interface ReadWindowsProxyOptions {
  /** Timeout in milliseconds (default: 1000) */
  readonly timeoutMs?: number;
}

/**
 * Derives Codex network environment from base environment.
 *
 * @param baseEnv - Base environment (already merged with account overrides and null deletions)
 * @param options - Optional system proxy reader (Windows only)
 * @returns Derived environment with loopback addresses in NO_PROXY
 */
export function deriveCodexNetworkEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  options?: {
    readonly readWindowsProxy?: (opts?: ReadWindowsProxyOptions) => Promise<WindowsSystemProxyConfig | null>;
  },
): CodexNetworkEnvironment {
  const env = { ...baseEnv };
  const diagnostic: CodexNetworkEnvironment['diagnostic'] = {
    hasProxy: hasProxyEnv(env),
    exceptionSource: 'none',
    loopbackAdded: false,
    unsupportedScenarios: [],
  };

  // Collect existing exceptions from environment (case-insensitive on Windows)
  const existingExceptions = collectExistingExceptions(env);

  if (existingExceptions.length > 0) {
    // User has explicit env exceptions - preserve and append
    diagnostic.exceptionSource = 'env';
    const merged = mergeExceptions(existingExceptions, LOOPBACK_ADDRESSES);
    setNormalizedNoProxy(env, merged);
    diagnostic.loopbackAdded = merged.length > existingExceptions.length;
    return { env, diagnostic };
  }

  // No env exceptions - check if we need to preserve Windows system exceptions
  // This matches hyper-util 0.1.20 behavior: only loads ProxyOverride when env is empty
  if (process.platform === 'win32' && options?.readWindowsProxy && diagnostic.hasProxy) {
    // Async not allowed here - must be called by consumer before this function
    // For now, mark as unsupported and preserve original environment
    diagnostic.exceptionSource = 'none';
    diagnostic.unsupportedScenarios = ['windows_system_exceptions_require_async_read'];
    return { env, diagnostic };
  }

  // Safe to add loopback-only exceptions
  setNormalizedNoProxy(env, [...LOOPBACK_ADDRESSES]);
  diagnostic.loopbackAdded = true;
  return { env, diagnostic };
}

/**
 * Synchronous version that accepts pre-read system proxy config.
 */
export function deriveCodexNetworkEnvironmentSync(
  baseEnv: NodeJS.ProcessEnv,
  systemProxy?: WindowsSystemProxyConfig | null,
): CodexNetworkEnvironment {
  const env = { ...baseEnv };
  const diagnostic: CodexNetworkEnvironment['diagnostic'] = {
    hasProxy: hasProxyEnv(env),
    exceptionSource: 'none',
    loopbackAdded: false,
    unsupportedScenarios: [],
  };

  const existingExceptions = collectExistingExceptions(env);

  if (existingExceptions.length > 0) {
    diagnostic.exceptionSource = 'env';
    const merged = mergeExceptions(existingExceptions, LOOPBACK_ADDRESSES);
    setNormalizedNoProxy(env, merged);
    diagnostic.loopbackAdded = merged.length > existingExceptions.length;
    return { env, diagnostic };
  }

  // Check Windows system exceptions
  if (process.platform === 'win32' && diagnostic.hasProxy && systemProxy !== undefined) {
    if (systemProxy === null) {
      // Read failed - preserve original environment
      diagnostic.exceptionSource = 'read_failed';
      diagnostic.unsupportedScenarios = ['windows_system_proxy_read_failed'];
      return { env, diagnostic };
    }

    if (systemProxy.hasPac) {
      // PAC/WPAD present - cannot safely convert to static list
      diagnostic.exceptionSource = 'system_pac';
      diagnostic.unsupportedScenarios = ['windows_pac_wpad_not_convertible'];
      return { env, diagnostic };
    }

    if (systemProxy.proxyOverride) {
      // Parse ProxyOverride and merge with loopback
      const systemExceptions = parseWindowsProxyOverride(systemProxy.proxyOverride);
      if (systemExceptions.unsupported.length > 0) {
        // Contains patterns we cannot safely convert
        diagnostic.exceptionSource = 'system_static';
        diagnostic.unsupportedScenarios = systemExceptions.unsupported.map(
          (pattern) => `windows_proxy_override_pattern_not_supported:${pattern}`,
        );
        return { env, diagnostic };
      }

      // Safe to merge
      diagnostic.exceptionSource = 'system_static';
      const merged = mergeExceptions(systemExceptions.supported, LOOPBACK_ADDRESSES);
      setNormalizedNoProxy(env, merged);
      diagnostic.loopbackAdded = merged.length > systemExceptions.supported.length;
      return { env, diagnostic };
    }
  }

  // No exceptions present - safe to add loopback only
  setNormalizedNoProxy(env, [...LOOPBACK_ADDRESSES]);
  diagnostic.loopbackAdded = true;
  return { env, diagnostic };
}

/**
 * Checks if environment has proxy configuration.
 */
function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  const upper = (key: string) => env[key];
  const lower = (key: string) => env[key.toLowerCase()];
  return !!(
    upper('HTTP_PROXY') ||
    lower('http_proxy') ||
    upper('HTTPS_PROXY') ||
    lower('https_proxy') ||
    upper('ALL_PROXY') ||
    lower('all_proxy')
  );
}

/**
 * Collects existing NO_PROXY entries from environment (handles case variations).
 */
function collectExistingExceptions(env: NodeJS.ProcessEnv): string[] {
  const noProxy = env.NO_PROXY ?? env.no_proxy;
  if (!noProxy || noProxy.trim() === '') return [];

  return noProxy
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Merges exception lists, deduplicating case-insensitively.
 */
function mergeExceptions(existing: readonly string[], toAdd: readonly string[]): string[] {
  const normalized = new Set(existing.map((s) => s.toLowerCase()));
  const result = [...existing];

  for (const addr of toAdd) {
    if (!normalized.has(addr.toLowerCase())) {
      result.push(addr);
      normalized.add(addr.toLowerCase());
    }
  }

  return result;
}

/**
 * Sets NO_PROXY in environment with platform-appropriate casing.
 */
function setNormalizedNoProxy(env: NodeJS.ProcessEnv, exceptions: readonly string[]): void {
  const value = exceptions.join(',');

  if (process.platform === 'win32') {
    // Windows: use uppercase, remove lowercase variant
    env.NO_PROXY = value;
    delete env.no_proxy;
  } else {
    // Unix: preserve existing casing or use lowercase
    if (env.NO_PROXY !== undefined) {
      env.NO_PROXY = value;
    } else {
      env.no_proxy = value;
    }
  }
}

/**
 * Parses Windows ProxyOverride registry value.
 * Format: semicolon-separated list, may contain wildcards, <local>, IP ranges.
 *
 * Returns:
 * - supported: entries that can be safely converted to NO_PROXY format
 * - unsupported: entries that require special handling (wildcards, <local>, etc.)
 */
function parseWindowsProxyOverride(override: string): {
  supported: string[];
  unsupported: string[];
} {
  const supported: string[] = [];
  const unsupported: string[] = [];

  const entries = override.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  for (const entry of entries) {
    // <local> means "bypass proxy for local addresses"
    if (entry === '<local>') {
      unsupported.push(entry);
      continue;
    }

    // Wildcards like *.example.com
    if (entry.includes('*')) {
      unsupported.push(entry);
      continue;
    }

    // IP ranges or CIDR notation
    if (entry.includes('-') || entry.includes('/')) {
      unsupported.push(entry);
      continue;
    }

    // Plain hostname or IP - safe to use
    supported.push(entry);
  }

  return { supported, unsupported };
}

/**
 * Reads Windows system proxy configuration from registry.
 * Windows-only, returns null on non-Windows or read failure.
 */
export async function readWindowsSystemProxy(
  options?: ReadWindowsProxyOptions,
): Promise<WindowsSystemProxyConfig | null> {
  if (process.platform !== 'win32') return null;

  const timeoutMs = options?.timeoutMs ?? 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Read Internet Settings registry key
    const keyPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

    const { stdout } = await execFileAsync(
      'reg',
      ['query', keyPath, '/v', 'ProxyServer'],
      { signal: controller.signal, timeout: timeoutMs },
    );

    const proxyServer = extractRegValue(stdout, 'ProxyServer');

    const { stdout: overrideStdout } = await execFileAsync(
      'reg',
      ['query', keyPath, '/v', 'ProxyOverride'],
      { signal: controller.signal, timeout: timeoutMs },
    );

    const proxyOverride = extractRegValue(overrideStdout, 'ProxyOverride');

    // Check for PAC/WPAD
    const { stdout: pacStdout } = await execFileAsync(
      'reg',
      ['query', keyPath, '/v', 'AutoConfigURL'],
      { signal: controller.signal, timeout: timeoutMs },
    ).catch(() => ({ stdout: '' }));

    const hasPac = !!extractRegValue(pacStdout, 'AutoConfigURL');

    return { proxyServer, proxyOverride, hasPac };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts registry value from reg.exe output.
 */
function extractRegValue(stdout: string, valueName: string): string | undefined {
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(valueName)) {
      // Format: "ValueName    REG_SZ    Value"
      const parts = trimmed.split(/\s+/);
      const valueIndex = parts.indexOf('REG_SZ') + 1;
      if (valueIndex > 0 && valueIndex < parts.length) {
        return parts.slice(valueIndex).join(' ').trim();
      }
    }
  }
  return undefined;
}
