/** Read-only credential presence checks. No runtime spawn, network call or secret projection. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClientAuthDeps {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function detectClientAuth(client: string, envKey: string, deps: ClientAuthDeps = {}) {
  const env = deps.env ?? process.env;
  const hasApiKey = nonEmpty(env[envKey]) || (client === 'gemini' && nonEmpty(env.GEMINI_API_KEY));
  if (hasApiKey) return { hasApiKey: true, authenticated: true };
  const home = deps.homeDir ?? homedir();
  // These must match the CLI's runtime home, not the quota panel's optional account override.
  const path = client === 'claude' ? join(env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), '.credentials.json')
    : client === 'codex' ? join(env.CODEX_HOME?.trim() || join(home, '.codex'), 'auth.json')
    : client === 'gemini' ? join(home, '.gemini', 'oauth_creds.json') : null;
  if (!path) return { hasApiKey: false, authenticated: false };
  try {
    const parsed = record(JSON.parse((deps.readFile ?? ((file) => readFileSync(file, 'utf8')))(path)));
    const tokens = record(client === 'claude' ? parsed?.claudeAiOauth : client === 'codex' ? parsed?.tokens : parsed);
    const authenticated = client === 'claude'
      ? nonEmpty(tokens?.accessToken) && nonEmpty(tokens?.refreshToken)
      : nonEmpty(tokens?.access_token) && nonEmpty(tokens?.refresh_token);
    return { hasApiKey: false, authenticated };
  } catch {
    return { hasApiKey: false, authenticated: false };
  }
}
