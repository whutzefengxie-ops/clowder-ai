/**
 * Auth Mode Detector
 * 启动时检测 API key 认证配置冲突。
 *
 * 问题场景：用户在 ~/.claude/settings.json 或环境变量中配置了 ANTHROPIC_API_KEY，
 * 但 Cat Cafe 的 provider profile 仍为 subscription 模式，导致 API key 被显式清空。
 *
 * 此模块在 API 启动时运行，检测潜在冲突并输出警告。
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AnthropicRuntimeProfile } from './provider-profiles.types.js';

interface AuthModeWarning {
  message: string;
  details: string[];
}

/**
 * Read ~/.claude/settings.json and check for API key related config.
 * Returns the parsed object or null if unreadable / missing.
 */
async function readClaudeGlobalSettings(): Promise<Record<string, unknown> | null> {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    const raw = await readFile(settingsPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Detect whether the user likely intended API-key auth but the provider
 * profile is still in subscription mode.
 *
 * Signals checked (any match → potential conflict):
 * 1. `ANTHROPIC_API_KEY` env var is set in the process
 * 2. `~/.claude/settings.json` contains `apiKey` or `env.ANTHROPIC_API_KEY`
 */
export async function detectAuthModeConflict(runtimeProfile: AnthropicRuntimeProfile): Promise<AuthModeWarning | null> {
  // Only warn when profile is subscription — api_key profile is already correct
  if (runtimeProfile.mode !== 'subscription') return null;

  const details: string[] = [];

  // Signal 1: env var set in current process
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    details.push(
      'Environment variable ANTHROPIC_API_KEY is set, but provider profile is "subscription" mode — ' +
        'Cat Cafe will clear this key before spawning Claude CLI.',
    );
  }

  // Signal 2: ~/.claude/settings.json has auth-related config
  const globalSettings = await readClaudeGlobalSettings();
  if (globalSettings) {
    const hasApiKey =
      typeof globalSettings.apiKey === 'string' ||
      (globalSettings.env != null &&
        typeof globalSettings.env === 'object' &&
        'ANTHROPIC_API_KEY' in (globalSettings.env as Record<string, unknown>));

    const hasCustomUrl =
      typeof globalSettings.apiBaseUrl === 'string' ||
      (globalSettings.env != null &&
        typeof globalSettings.env === 'object' &&
        'ANTHROPIC_BASE_URL' in (globalSettings.env as Record<string, unknown>));

    if (hasApiKey || hasCustomUrl) {
      details.push(
        'Found API key / custom URL config in ~/.claude/settings.json, but Cat Cafe uses ' +
          '--setting-sources project,local (skips global). This config will not reach Claude CLI.',
      );
    }
  }

  if (details.length === 0) return null;

  return {
    message:
      '[auth] API key authentication detected but provider profile is "subscription" mode. ' +
      'To use API key auth with Cat Cafe, create an api_key provider profile via the Web UI ' +
      '(Settings → Provider Profiles) or run: ./scripts/setup.sh',
    details,
  };
}
