/**
 * Windows CLI Spawn Helpers (#64)
 *
 * Resolves .cmd shim scripts to their underlying .js entry points
 * so we can bypass shell on Windows. Falls back to shell mode
 * with escaped arguments if resolution fails.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';

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
  opencode: ['opencode-ai/bin/opencode'],
};

export interface WindowsShimSpawn {
  command: string;
  args: string[];
}

/**
 * Extract the bare command name from a path or command string.
 * e.g. 'C:\Users\Admin\bin\claude.cmd' → 'claude'
 *      'claude' → 'claude'
 */
export function extractBareName(command: string): string {
  // Use both / and \ as separators so Windows-style paths work on Linux CI too
  const base = command.replace(/^.*[/\\]/, '');
  return base.replace(/\.(cmd|exe|bat)$/i, '');
}

/**
 * Resolve a candidate script path from a shim-relative path fragment.
 * Normalises backslashes, strips trailing `%*` tokens, and joins with the base directory.
 */
function cleanShimRelPath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/\s+%\*.*$/, '');
}

/**
 * Try to extract an entry script from a .cmd shim file by parsing its content.
 * Handles:
 *  - Standard npm shims using %~dp0\..., %dp0\..., or %dp0%\... relative paths
 *  - Custom shims using %ENV_VAR%\... absolute paths (e.g. %APPDATA%\npm\node_modules\...)
 * Prefers .js matches, falls back to extensionless entrypoints.
 */
export function parseShimFile(cmdPath: string): string | null {
  if (!existsSync(cmdPath)) return null;
  const shimContent = readFileSync(cmdPath, 'utf-8');
  const shimDir = dirname(cmdPath);

  // ── Pass 1: %~dp0 / %dp0 / %dp0% relative paths (standard npm shims) ──
  const dp0Matches = [...shimContent.matchAll(/%~?dp0%?\\([^"\r\n]+)/gi)];

  for (const match of dp0Matches) {
    const raw = cleanShimRelPath(match[1]);
    if (/\.js$/i.test(raw)) {
      const scriptPath = join(shimDir, raw);
      if (existsSync(scriptPath)) return scriptPath;
    }
  }
  for (const match of dp0Matches) {
    const raw = cleanShimRelPath(match[1]);
    if (!/\.\w+$/i.test(raw) && !/^node(\.exe)?$/i.test(raw.split('/').pop() ?? '')) {
      const scriptPath = join(shimDir, raw);
      if (existsSync(scriptPath)) return scriptPath;
    }
  }

  // ── Pass 2: %ENV_VAR%\... absolute paths (custom shims, e.g. %APPDATA%\npm\...) ──
  const envMatches = [...shimContent.matchAll(/%([A-Z_][A-Z0-9_]*)%\\([^"\r\n]+)/gi)];
  for (const match of envMatches) {
    const varName = match[1].toUpperCase();
    if (/^~?dp0$/i.test(varName)) continue; // Already handled in Pass 1
    const envValue = process.env[varName];
    if (!envValue) continue;
    const raw = cleanShimRelPath(match[2]);
    if (/\.js$/i.test(raw)) {
      const scriptPath = join(envValue, raw);
      if (existsSync(scriptPath)) return scriptPath;
    }
  }
  for (const match of envMatches) {
    const varName = match[1].toUpperCase();
    if (/^~?dp0$/i.test(varName)) continue;
    const envValue = process.env[varName];
    if (!envValue) continue;
    const raw = cleanShimRelPath(match[2]);
    if (!/\.\w+$/i.test(raw) && !/^node(\.exe)?$/i.test(raw.split('/').pop() ?? '')) {
      const scriptPath = join(envValue, raw);
      if (existsSync(scriptPath)) return scriptPath;
    }
  }

  return null;
}

/**
 * Search well-known global install directories for a CLI tool's entry script.
 * Checks npm (%APPDATA%/npm) and pnpm (%LOCALAPPDATA%/pnpm/global/5) prefixes.
 */
export function findKnownScript(bareName: string): string | null {
  const knownPaths = KNOWN_SHIM_SCRIPTS[bareName];
  if (!knownPaths) return null;

  const prefixes: string[] = [];
  const appData = process.env.APPDATA;
  if (appData) prefixes.push(join(appData, 'npm', 'node_modules'));
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) prefixes.push(join(localAppData, 'pnpm', 'global', '5', 'node_modules'));

  for (const prefix of prefixes) {
    for (const relPath of knownPaths) {
      const candidate = join(prefix, relPath);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Resolve the underlying .js entry script from a Windows .cmd shim.
 *
 * Accepts both bare command names ('claude') and full paths
 * ('C:\Users\Admin\bin\claude.cmd') — resolveCliCommand returns full paths.
 *
 * Strategy:
 * 1a. If command is a full path to an existing .cmd file, parse it directly
 * 1b. If command is a bare name, locate via `where` and parse
 * 2. Fall back to known global install paths (APPDATA/npm, LOCALAPPDATA/pnpm)
 * 3. Cache result (null = not resolvable, use shell fallback)
 *
 * Important: when a full path is provided, we do NOT fall back to bare-name
 * `where` lookup — this avoids silently resolving to a different CLI version.
 * However, we DO fall back to findKnownScript (canonical entry points are safe).
 */
export function resolveCmdShimScript(command: string): string | null {
  const cached = resolvedShimCache.get(command);
  if (cached !== undefined) {
    if (cached === null) return null;
    if (existsSync(cached)) return cached;
    resolvedShimCache.delete(command);
  }

  const bareName = extractBareName(command);
  const isFullPath = /[/\\]/.test(command);

  // Strategy 1a: command is already a full .cmd path — parse it directly
  if (isFullPath && /\.cmd$/i.test(command)) {
    const result = parseShimFile(command);
    if (result) {
      resolvedShimCache.set(command, result);
      return result;
    }
    // Full path provided but parsing failed — do NOT fall back to `where`
    // to avoid resolving to a different CLI version on PATH.
    // DO fall back to findKnownScript (canonical entry points are safe).
    const knownResult = findKnownScript(bareName);
    if (knownResult) {
      resolvedShimCache.set(command, knownResult);
      return knownResult;
    }
  }

  // Strategy 1b: bare command name — locate via `where`
  if (!isFullPath) {
    try {
      const whereOutput = execSync(`where "${command}.cmd"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      for (const cmdPath of whereOutput.split(/\r?\n/)) {
        const result = parseShimFile(cmdPath.trim());
        if (result) {
          resolvedShimCache.set(command, result);
          return result;
        }
      }
    } catch {
      // `where` failed or timed out — fall through
    }
  }

  // Strategy 2: known global install paths (npm + pnpm)
  const knownResult = findKnownScript(bareName);
  if (!isFullPath && knownResult) {
    resolvedShimCache.set(command, knownResult);
    return knownResult;
  }

  resolvedShimCache.set(command, null);
  return null;
}

export function resolveWindowsShimSpawn(
  command: string,
  args: readonly string[],
  shimScriptOverride?: string,
): WindowsShimSpawn | null {
  const shimScript = shimScriptOverride ?? resolveCmdShimScript(command);
  if (!shimScript) return null;
  return {
    command: process.execPath,
    args: [shimScript, ...args],
  };
}

/**
 * Escape a command-line argument for Windows cmd.exe shell mode.
 *
 * Uses the MSVC C runtime escaping rules for argv parsing:
 * - Backslashes before a double quote must be doubled
 * - Trailing backslashes before the closing quote must be doubled
 * - Internal double quotes are escaped as \"
 * Then applies cmd.exe-level escaping: % doubled, metacharacters (including parentheses) caret-escaped.
 */
export function escapeCmdArg(arg: string): string {
  // Collapse newlines to spaces — CMD's %* truncates at the first newline,
  // silently dropping all subsequent arguments. Lossy but far safer than truncation.
  arg = arg.replace(/\r?\n/g, ' ');
  if (!/[\s"&|<>^%!\\()]/.test(arg)) return arg;
  // MSVC CRT escaping: process each character, tracking backslash runs
  let crtEscaped = '';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      // Double the backslashes before a quote, then emit \"
      crtEscaped += `${'\\'.repeat(backslashes * 2)}\\"`;
      backslashes = 0;
    } else {
      crtEscaped += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  // Double trailing backslashes (they'll precede the closing quote)
  crtEscaped += '\\'.repeat(backslashes * 2);
  // cmd.exe escaping on top of CRT escaping
  let escaped = crtEscaped.replace(/%/g, '%%');
  escaped = escaped.replace(/([&|<>^!()])/g, '^$1');
  return `"${escaped}"`;
}

/**
 * Escape a command-line argument for bash (Git Bash on Windows).
 * Single-quote wrapping with internal single-quote escaping.
 */
export function escapeBashArg(arg: string): string {
  // Collapse newlines — Git Bash may delegate to cmd.exe for .cmd files,
  // where %* truncation would silently drop subsequent arguments.
  arg = arg.replace(/\r?\n/g, ' ');
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ── Git Bash detection (shared across spawn & agent services) ──

const IS_WINDOWS = process.platform === 'win32';

let cachedGitBashPath: string | undefined | null;

function isWindowsSystemBash(candidate: string): boolean {
  const normalized = win32.normalize(candidate).toLowerCase();
  return normalized.endsWith('\\system32\\bash.exe');
}

export function pickGitBashPathFromWhere(whereOutput: string, pathExists = existsSync): string | undefined {
  const existingCandidates: string[] = [];
  for (const rawLine of whereOutput.split(/\r?\n/)) {
    const candidate = rawLine.trim().replace(/^"+|"+$/g, '');
    if (!candidate) continue;
    if (win32.basename(candidate).toLowerCase() !== 'bash.exe') continue;
    if (!pathExists(candidate)) continue;
    existingCandidates.push(candidate);
  }

  for (const candidate of existingCandidates) {
    if (!isWindowsSystemBash(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function findGitBashPath(): string | undefined {
  if (!IS_WINDOWS) return undefined;
  if (cachedGitBashPath !== undefined) return cachedGitBashPath ?? undefined;

  const standardPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (existsSync(standardPath)) {
    cachedGitBashPath = standardPath;
    return standardPath;
  }

  try {
    const whereOutput = execSync('where bash', { encoding: 'utf-8', timeout: 5000 }).trim();
    const discoveredPath = pickGitBashPathFromWhere(whereOutput);
    if (discoveredPath) {
      cachedGitBashPath = discoveredPath;
      return discoveredPath;
    }
  } catch {
    // `where` failed
  }

  cachedGitBashPath = null;
  return undefined;
}
