/**
 * Windows CLI Spawn Helpers (#64)
 *
 * Resolves .cmd shim scripts to their underlying .js entry points
 * so we can bypass shell on Windows. Falls back to shell mode
 * with escaped arguments if resolution fails.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Cache for resolved shim scripts to avoid repeated filesystem lookups.
 */
const resolvedShimCache = new Map<string, string | null>();

/**
 * Known npm-global paths for common CLI tools on Windows.
 * Checked first for fast resolution before falling back to `where`.
 */
const KNOWN_SHIM_SCRIPTS: Record<string, string[]> = {
  claude: ['@anthropic-ai/claude-code/cli.js'],
  codex: ['@openai/codex/bin/codex.js'],
  gemini: ['@google/gemini-cli/bin/gemini.js'],
};

/**
 * Resolve the underlying .js entry script from a Windows .cmd shim.
 *
 * Strategy:
 * 1. Check known paths under %APPDATA%/npm/node_modules
 * 2. Locate the .cmd via `where`, parse %dp0% relative paths
 * 3. Cache result (null = not resolvable, use shell fallback)
 */
export function resolveCmdShimScript(command: string): string | null {
  const cached = resolvedShimCache.get(command);
  if (cached !== undefined) return cached;

  // Strategy 1: known paths
  const appData = process.env.APPDATA;
  const knownPaths = KNOWN_SHIM_SCRIPTS[command];
  if (appData && knownPaths) {
    for (const relPath of knownPaths) {
      const candidate = join(appData, 'npm', 'node_modules', relPath);
      if (existsSync(candidate)) {
        resolvedShimCache.set(command, candidate);
        return candidate;
      }
    }
  }

  // Strategy 2: parse .cmd shim via `where`
  try {
    const whereOutput = execSync(`where ${command}.cmd`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    for (const cmdPath of whereOutput.split(/\r?\n/)) {
      if (!cmdPath || !existsSync(cmdPath)) continue;
      const shimContent = readFileSync(cmdPath, 'utf-8');
      const shimDir = cmdPath.replace(/[/\\][^/\\]+$/, '');
      // npm .cmd shims use "%~dp0\..." or "%dp0\..." relative script targets.
      // Scan every match so wrappers with a node.exe prelude still resolve the
      // actual .js entrypoint.
      for (const match of shimContent.matchAll(/%~?dp0\\([^"\r\n]*?\.js)/gi)) {
        const scriptPath = join(shimDir, match[1].replace(/\\/g, '/'));
        if (existsSync(scriptPath)) {
          resolvedShimCache.set(command, scriptPath);
          return scriptPath;
        }
      }
    }
  } catch {
    // `where` failed or timed out — fall through to shell mode
  }

  resolvedShimCache.set(command, null);
  return null;
}

/**
 * Escape a command-line argument for Windows cmd.exe shell mode.
 *
 * cmd.exe interprets: & | < > ^ % " and whitespace.
 * Strategy: wrap in double quotes, escape internal `"` as `\"`,
 * and caret-escape all remaining cmd.exe metacharacters inside the quotes.
 * `%` is doubled to `%%` to prevent env-var expansion.
 * Trailing backslashes before the closing quote are doubled to prevent
 * the backslash from escaping the closing quote (e.g. `arg\` → `"arg\\"`)
 */
export function escapeCmdArg(arg: string): string {
  if (!/[\s"&|<>^%!\\]/.test(arg)) return arg;
  // 1. Escape internal double quotes for the C runtime
  let escaped = arg.replace(/"/g, '\\"');
  // 2. Double trailing backslashes to prevent them from escaping the closing quote
  escaped = escaped.replace(/\\+$/, (match) => match + match);
  // 3. Double % to prevent cmd.exe env-var expansion
  escaped = escaped.replace(/%/g, '%%');
  // 4. Caret-escape cmd.exe metacharacters (inside double quotes,
  //    only ^, !, and sometimes & need escaping; belt-and-suspenders)
  escaped = escaped.replace(/([&|<>^!])/g, '^$1');
  return `"${escaped}"`;
}
