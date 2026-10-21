/**
 * @fileoverview Codex network environment derivation for enterprise proxy compatibility.
 *
 * Issue #1666: Windows enterprise proxy environments may route localhost/127.0.0.1 requests
 * through the proxy, causing 504 errors when Codex tries to reach a local provider gateway.
 *
 * This module provides pure functions to derive Codex launch environment with loopback
 * addresses added to NO_PROXY, while preserving existing proxy configuration and internal
 * network exceptions.
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
 * Diagnostic information for network environment derivation.
 */
export interface CodexNetworkDiagnostic {
  /** Whether any proxy environment variables are present */
  readonly hasProxy: boolean;
  /** Source of proxy exceptions used */
  readonly exceptionSource: ProxyExceptionSource;
  /** Whether loopback addresses were added */
  readonly loopbackAdded: boolean;
  /** Scenarios not covered by this implementation (empty if fully handled) */
  readonly unsupportedScenarios: readonly string[];
}

/**
 * Derived network environment for Codex launch.
 */
export interface CodexNetworkEnvironment {
  readonly env: NodeJS.ProcessEnv;
  readonly diagnostic: CodexNetworkDiagnostic;
}

/**
 * Windows system proxy configuration (read-only).
 */
export interface WindowsSystemProxyConfig {
  readonly proxyServer?: string;
  readonly proxyOverride?: string;
  readonly hasPac: boolean;
}

/**
 * Options for reading Windows system proxy configuration.
 */
export interface ReadWindowsProxyOptions {
  readonly timeoutMs?: number;
}

/**
 * Derives Codex network environment from base environment.
 *
 * @param baseEnv - Base environment (already merged with account overrides and null deletions)
 * @param systemProxy - Pre-read Windows system proxy config (undefined = not read, null = read failed)
 * @returns Derived environment with loopback addresses in NO_PROXY
 */
export function deriveCodexNetworkEnvironmentSync(
  baseEnv: NodeJS.ProcessEnv,
  systemProxy?: WindowsSystemProxyConfig | null,
): CodexNetworkEnvironment {
  const env = { ...baseEnv };
  const diagnostic: CodexNetworkDiagnostic = {
    hasProxy: hasProxyEnv(env),
    exceptionSource: 'none',
    loopbackAdded: false,
    unsupportedScenarios: [],
  };

  // Collect existing exceptions from all case variants
  const existingExceptions = collectAllExceptions(env);

  if (existingExceptions.length > 0) {
    // User has explicit env exceptions - preserve and append
    const merged = mergeExceptions(existingExceptions, LOOPBACK_ADDRESSES);
    setNormalizedNoProxy(env, merged);
    return {
      env,
      diagnostic: {
        ...diagnostic,
        exceptionSource: 'env',
        loopbackAdded: merged.length > existingExceptions.length,
      },
    };
  }

  // No env exceptions - check Windows system proxy if applicable
  if (process.platform === 'win32' && diagnostic.hasProxy) {
    if (systemProxy === undefined) {
      // Not read - cannot safely determine if system exceptions exist
      return {
        env,
        diagnostic: {
          ...diagnostic,
          unsupportedScenarios: ['windows_system_proxy_not_read'],
        },
      };
    }

    if (systemProxy === null) {
      // Read failed - preserve original environment
      return {
        env,
        diagnostic: {
          ...diagnostic,
          exceptionSource: 'read_failed',
          unsupportedScenarios: ['windows_system_proxy_read_failed'],
        },
      };
    }

    if (systemProxy.hasPac) {
      // PAC/WPAD present - cannot safely convert to static list
      return {
        env,
        diagnostic: {
          ...diagnostic,
          exceptionSource: 'system_pac',
          unsupportedScenarios: ['windows_pac_wpad_not_convertible'],
        },
      };
    }

    if (systemProxy.proxyOverride) {
      // Parse ProxyOverride and merge with loopback
      const systemExceptions = parseWindowsProxyOverride(systemProxy.proxyOverride);
      if (systemExceptions.unsupported.length > 0) {
        // Contains patterns we cannot safely convert
        return {
          env,
          diagnostic: {
            ...diagnostic,
            exceptionSource: 'system_static',
            unsupportedScenarios: systemExceptions.unsupported.map(
              (pattern) => `windows_proxy_override_pattern_not_supported:${pattern}`,
            ),
          },
        };
      }

      // Safe to merge
      const merged = mergeExceptions(systemExceptions.supported, LOOPBACK_ADDRESSES);
      setNormalizedNoProxy(env, merged);
      return {
        env,
        diagnostic: {
          ...diagnostic,
          exceptionSource: 'system_static',
          loopbackAdded: merged.length > systemExceptions.supported.length,
        },
      };
    }
  }

  // Safe to add loopback-only exceptions
  setNormalizedNoProxy(env, [...LOOPBACK_ADDRESSES]);
  return {
    env,
    diagnostic: {
      ...diagnostic,
      loopbackAdded: true,
    },
  };
}

/**
 * Checks if environment has proxy configuration.
 */
function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  return !!(
    env.HTTP_PROXY || env.http_proxy ||
    env.HTTPS_PROXY || env.https_proxy ||
    env.ALL_PROXY || env.all_proxy
  );
}

/**
 * Collects existing NO_PROXY entries from all case variants.
 * Returns deduplicated list preserving original casing.
 */
function collectAllExceptions(env: NodeJS.ProcessEnv): string[] {
  const keys = ['NO_PROXY', 'no_proxy', 'No_Proxy'];
  const all: string[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    const value = env[key];
    if (!value || value.trim() === '') continue;

    for (const entry of value.split(',')) {
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        all.push(trimmed);
      }
    }
  }

  return all;
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
 * Removes all case variants and sets single canonical key.
 */
function setNormalizedNoProxy(env: NodeJS.ProcessEnv, exceptions: readonly string[]): void {
  const value = exceptions.join(',');

  // Remove all variants
  delete env.NO_PROXY;
  delete env.no_proxy;
  delete env.No_Proxy;

  if (process.platform === 'win32') {
    // Windows: use uppercase only
    env.NO_PROXY = value;
  } else {
    // Unix: use lowercase (most common convention)
    env.no_proxy = value;
  }
}

/**
 * Parses Windows ProxyOverride registry value.
 */
function parseWindowsProxyOverride(override: string): {
  supported: string[];
  unsupported: string[];
} {
  const supported: string[] = [];
  const unsupported: string[] = [];

  const entries = override.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  for (const entry of entries) {
    if (entry === '<local>' || entry.includes('*') || entry.includes('-') || entry.includes('/')) {
      unsupported.push(entry);
    } else {
      supported.push(entry);
    }
  }

  return { supported, unsupported };
}

/**
 * Reads Windows system proxy configuration from registry (async).
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

    const keyPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

    const readValue = async (valueName: string): Promise<string | undefined> => {
      try {
        const { stdout } = await execFileAsync(
          'reg',
          ['query', keyPath, '/v', valueName],
          { signal: controller.signal, timeout: timeoutMs },
        );
        return extractRegValue(stdout, valueName);
      } catch {
        return undefined;
      }
    };

    const [proxyServer, proxyOverride, autoConfigURL] = await Promise.all([
      readValue('ProxyServer'),
      readValue('ProxyOverride'),
      readValue('AutoConfigURL'),
    ]);

    return {
      proxyServer,
      proxyOverride,
      hasPac: !!autoConfigURL,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractRegValue(stdout: string, valueName: string): string | undefined {
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(valueName)) {
      const parts = trimmed.split(/\s+/);
      const valueIndex = parts.indexOf('REG_SZ') + 1;
      if (valueIndex > 0 && valueIndex < parts.length) {
        return parts.slice(valueIndex).join(' ').trim();
      }
    }
  }
  return undefined;
}
