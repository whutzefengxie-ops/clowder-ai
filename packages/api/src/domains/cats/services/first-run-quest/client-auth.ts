/** Read-only credential presence checks. No runtime spawn, network call or secret projection. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

export interface ClientAuthDeps {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function readText(path: string, deps: ClientAuthDeps): string {
  return (deps.readFile ?? ((file) => readFileSync(file, 'utf8')))(path);
}

/**
 * Codex can be authenticated without auth.json or OPENAI_API_KEY. In that
 * mode the CLI reads a bearer value from the provider selected by
 * `model_provider` in config.toml. Keep the lookup scoped to that provider:
 * an unused provider entry must never make the active CLI look authenticated.
 */
function hasCodexConfigAuth(configPath: string, deps: ClientAuthDeps): boolean {
  try {
    const parsed = record(parseToml(readText(configPath, deps)));
    const providerName = parsed?.model_provider;
    if (!nonEmpty(providerName)) return false;
    const providers = record(parsed?.model_providers);
    const provider = record(providers?.[providerName as string]);
    return nonEmpty(provider?.base_url) && nonEmpty(provider?.experimental_bearer_token);
  } catch {
    return false;
  }
}

function getCredentialPath(client: string, home: string, env: NodeJS.ProcessEnv, codexHome: string): string | null {
  if (client === 'claude') return join(env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), '.credentials.json');
  if (client === 'codex') return join(codexHome, 'auth.json');
  if (client === 'gemini') return join(home, '.gemini', 'oauth_creds.json');
  return null;
}

function hasJsonAuth(client: string, parsed: Record<string, unknown> | null): boolean {
  const tokens = record(client === 'claude' ? parsed?.claudeAiOauth : client === 'codex' ? parsed?.tokens : parsed);
  if (client === 'claude') return nonEmpty(tokens?.accessToken) && nonEmpty(tokens?.refreshToken);
  return nonEmpty(tokens?.access_token) && nonEmpty(tokens?.refresh_token);
}

export function detectClientAuth(client: string, envKey: string, deps: ClientAuthDeps = {}) {
  const env = deps.env ?? process.env;
  const hasApiKey = nonEmpty(env[envKey]) || (client === 'gemini' && nonEmpty(env.GEMINI_API_KEY));
  if (hasApiKey) return { hasApiKey: true, authenticated: true };
  const home = deps.homeDir ?? homedir();
  // These must match the CLI's runtime home, not the quota panel's optional account override.
  const codexHome = env.CODEX_HOME?.trim() || join(home, '.codex');
  const path = getCredentialPath(client, home, env, codexHome);
  if (!path) return { hasApiKey: false, authenticated: false };
  try {
    const parsed = record(JSON.parse(readText(path, deps)));
    const authenticated = hasJsonAuth(client, parsed);
    if (authenticated || client !== 'codex') return { hasApiKey: false, authenticated };
    return {
      hasApiKey: false,
      authenticated: hasCodexConfigAuth(join(codexHome, 'config.toml'), deps),
    };
  } catch {
    if (client === 'codex') {
      return { hasApiKey: false, authenticated: hasCodexConfigAuth(join(codexHome, 'config.toml'), deps) };
    }
    return { hasApiKey: false, authenticated: false };
  }
}
