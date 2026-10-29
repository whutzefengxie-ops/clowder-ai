/**
 * F203 Phase C — shared L0 compile boundary (Task 3a).
 *
 * The API build artefact CANNOT in-process import
 * `scripts/compile-system-prompt-l0.mjs`: that .mjs hardcodes
 * `await import('../packages/api/dist/...')` relative to itself, so importing
 * it back into the compiled API package would couple the built package to an
 * out-of-package script, require dist to be built, and double-bootstrap
 * catRegistry inside the API process. Instead we cross the boundary via a
 * subprocess to the Phase B CLI (KD-10: `writeL0File()` + `--out`).
 *
 * W2: real invocations use the FROZEN input mode. The parent resolves the
 * effective member configuration, roster, identity authority, governance,
 * capsule and compiler dependency facts once (at invocation admission), writes
 * them to a private v1 JSON payload and passes `--frozen-input <path>`. The
 * child then renders exactly that input and never re-bootstraps the registry /
 * member catalog from disk, so a member edit while an invocation waits cannot
 * change the already admitted invocation. The legacy disk-reading path stays
 * available for diagnostics/CLI and tests via `frozenInputMode: 'legacy'`;
 * there is no automatic fallback from frozen to legacy.
 *
 * Single source of truth for the boundary — both ClaudeBgCarrierService
 * (`--system-prompt-file`) and CodexAgentService (`-c developer_instructions`)
 * consume it.
 *
 * fail-closed by design: any failure throws. In the terminal Phase C state the
 * user message no longer carries the non-pack identity/家规 (stripped in
 * Task 2), so a missing L0 = a cat with no identity/governance — strictly worse
 * than a failed invocation (which retries / surfaces loudly). Aligns with the
 * iron-rule philosophy and KD-5 (no feature flag, git-revert rollback).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_CORPUS_PROFILE_URI,
  CURRENT_RELATIONSHIP_PROFILE_URI,
  DEFAULT_PROFILE_USER_ID,
} from '@cat-cafe/shared/profile-contract';
import { profilePointerEmitted } from '../../../../../infrastructure/telemetry/instruments.js';
import { saveSpan } from '../../../../../utils/member-save-diagnostics.js';
import { FileProfileRepository } from '../../profile/ProfileRepository.js';
import { L0DependencySignatureTracker } from './l0-dependency-signature.js';
import {
  buildL0FrozenInput,
  computeL0FrozenInputDigest,
  L0_FROZEN_INPUT_VERSION,
  type L0FrozenInputBody,
  type L0FrozenInputV1,
} from './l0-frozen-input.js';
import { type L0CacheGeneration, L0ProfileCache, type L0Projection } from './l0-profile-cache.js';

const SCRIPT_BASENAME = 'compile-system-prompt-l0.mjs';
const l0Cache = new L0ProfileCache();
const dependencySignatures = new L0DependencySignatureTracker();

function recordProfilePointerEmission(compiledL0: string): void {
  const hasPrimer = compiledL0.includes(CURRENT_RELATIONSHIP_PROFILE_URI);
  const hasCorpus = compiledL0.includes(CURRENT_CORPUS_PROFILE_URI);
  if (hasPrimer) profilePointerEmitted.add(1, { 'profile.layer': 'primer' });
  if (hasCorpus) profilePointerEmitted.add(1, { 'profile.layer': 'corpus' });
}

function refreshL0DependencySignature(cwd: string, scriptPath: string): string | null {
  return dependencySignatures.refresh(cwd, scriptPath, () => l0Cache.clear());
}

/** Clear cached L0 for one cat or all cats (call on hot-reload / re-sync). */
export function clearL0Cache(catId?: string, userId?: string): void {
  l0Cache.clear(catId, userId);
}

/** Phase E: clear all cached L0s for a given owner (corpus is owner-wide, not cat-scoped). */
export function clearL0CacheOwner(userId: string): void {
  l0Cache.clearOwner(userId);
}

/** Number of cached entries (test/diagnostic). */
export function l0CacheSize(): number {
  return l0Cache.size();
}

/**
 * Pre-compile L0 for a list of catIds in parallel at startup.
 * Failures are logged but don't block startup — invoke() will retry.
 */
export async function warmL0Cache(
  catIds: string[],
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void },
  userId: string = process.env.CAT_CAFE_USER_ID ?? DEFAULT_PROFILE_USER_ID,
): Promise<void> {
  await Promise.all(
    catIds.map((catId) =>
      saveSpan('l0.compile', () => compileL0ViaSubprocess({ catId, userId }), { catId }).catch((err: unknown) => {
        logger?.warn({ catId, err: (err as Error).message }, 'L0 pre-compile failed at startup (will retry on invoke)');
      }),
    ),
  );
}

/**
 * Derive the install root from this module's file path.
 * l0-compiler.ts lives at packages/api/src/domains/cats/services/agents/providers/
 * → dist layout: packages/api/dist/domains/cats/services/agents/providers/l0-compiler.js
 * → 8 levels up from dirname(__filename) reaches the install root.
 * Used as fallback when cwd-based resolution fails (e.g. Windows NTFS junctions
 * not yet traversable on first boot after installation).
 */
function deriveInstallRoot(): string | undefined {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    return resolve(dirname(thisFile), '..', '..', '..', '..', '..', '..', '..', '..');
  } catch {
    return undefined;
  }
}

/**
 * Resolve `scripts/compile-system-prompt-l0.mjs` for monorepo layouts.
 * Mirrors `resolveDefaultClaudeMcpServerPath` (ClaudeAgentService.ts): the API
 * may be started from the repo root or from `packages/api`.
 *
 * Falls back to the install root (derived from this module's file path) when
 * cwd-based candidates all fail — this covers Windows packaged installs where
 * the API's cwd is a user-data mirror directory whose NTFS junctions to the
 * install root may not yet be traversable on first boot (#802).
 */
export function resolveL0CompilerScriptPath(cwd: string = process.cwd()): string | undefined {
  const candidates = [
    resolve(cwd, 'scripts', SCRIPT_BASENAME), // cwd = repo root
    resolve(cwd, '../../scripts', SCRIPT_BASENAME), // cwd = packages/api
    resolve(cwd, '../scripts', SCRIPT_BASENAME), // cwd = packages/* (best-effort fallback)
  ];

  // Install-root fallback: bypass junction on Windows first-boot (#802)
  const installRoot = deriveInstallRoot();
  if (installRoot) {
    candidates.push(resolve(installRoot, 'scripts', SCRIPT_BASENAME));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Arguments handed to the frozen-input builder (parent side, at admission). */
export interface CompileL0FrozenInputArgs {
  readonly catId: string;
  readonly projection: L0Projection;
  readonly userId: string;
  /** Canonical profile dir for owner projection; omitted for public. */
  readonly profileDir?: string;
  readonly dataDir?: string;
  readonly cwd: string;
  /** Repo/install root that owns assets, governance and the dossier. */
  readonly repoRoot: string;
}

export interface CompileL0Options {
  /** Cat to compile L0 for (must be registered in the runtime cat catalog). */
  catId: string;
  /** User whose private profile is compiled. Defaults to CAT_CAFE_USER_ID/default-user. */
  userId?: string;
  /** Private Work retains home L0 without USER_CAPSULE; public uses its separate bounded projection. */
  projection?: L0Projection;
  /** Canonical data root test/config seam. Defaults to CAT_CAFE_DATA_DIR/~/.cat-cafe. */
  dataDir?: string;
  /**
   * When set → the script writes the compiled L0 to this path (Claude
   * `--system-prompt-file`). When omitted → the compiled L0 is captured from
   * stdout and returned (Codex `-c developer_instructions=`).
   */
  outPath?: string;
  /** Working dir used to resolve the script + spawn (defaults to process.cwd()). */
  cwd?: string;
  /** Test seam — replaces the real spawn. */
  spawnFn?: typeof nodeSpawn;
  /**
   * Compile input mode. Real invocations MUST stay `frozen` (default); the
   * legacy disk-reading path exists for diagnostics/CLI and tests only.
   */
  frozenInputMode?: 'frozen' | 'legacy';
  /** Test seam — replaces the parent-side frozen payload assembly. */
  buildFrozenInput?: (args: CompileL0FrozenInputArgs) => Promise<L0FrozenInputV1>;
}

type L0ProjectionContext =
  | { readonly projection: Exclude<L0Projection, 'owner'>; readonly profileSignature: string }
  | { readonly projection: 'owner'; readonly profileDir: string; readonly profileSignature: string | null };

function resolveProjection(options: CompileL0Options): L0Projection {
  if (options.projection === undefined) return 'owner';
  if (options.projection === 'owner' || options.projection === 'public') return options.projection;
  throw new Error(`Unsupported L0 projection: ${String(options.projection)}`);
}

function resolveProjectionContext(
  options: CompileL0Options,
  userId: string,
  cacheKey: string,
  projection: L0Projection,
): L0ProjectionContext {
  if (projection !== 'owner') return { projection, profileSignature: `l0-projection:${projection}` };
  const profileDir = new FileProfileRepository({ dataDir: options.dataDir }).profileDir(userId);
  return {
    projection,
    profileDir,
    profileSignature: l0Cache.refreshProfileSignature(cacheKey, profileDir),
  };
}

function projectionProfileIsCurrent(context: L0ProjectionContext): boolean {
  return (
    context.projection !== 'owner' ||
    (context.profileSignature !== null &&
      l0Cache.profileSignatureIsCurrent(context.profileDir, context.profileSignature))
  );
}

/** Frozen cache key: owner/cat/projection + captured input digest (W2/C06). */
function frozenCacheKey(userId: string, catId: string, projection: L0Projection, digest: string): string {
  return `${l0Cache.key(userId, catId, projection)}\0${digest}`;
}

function verifyFrozenInputDigest(payload: L0FrozenInputV1): void {
  const { digest, ...body } = payload;
  const expected = computeL0FrozenInputDigest(body as L0FrozenInputBody);
  if (expected !== digest) {
    throw new Error(`L0 frozen input digest mismatch for ${payload.catId}`);
  }
}

function assertFrozenInput(payload: L0FrozenInputV1, catId: string, projection: L0Projection): void {
  if (payload === null || typeof payload !== 'object') {
    throw new Error(`L0 frozen input for ${catId} is not an object`);
  }
  if (payload.version !== L0_FROZEN_INPUT_VERSION) {
    throw new Error(
      `L0 frozen input for ${catId} has unsupported version ${String(payload.version)}; expected ${L0_FROZEN_INPUT_VERSION}`,
    );
  }
  if (payload.catId !== catId) {
    throw new Error(`L0 frozen input catId mismatch: payload has "${payload.catId}", compile requested "${catId}"`);
  }
  if (payload.projection !== projection) {
    throw new Error(
      `L0 frozen input projection mismatch: payload has "${payload.projection}", requested "${projection}"`,
    );
  }
  if (projection === 'owner') {
    if (!Array.isArray(payload.members) || !payload.members.some((member) => member.catId === catId)) {
      throw new Error(`L0 frozen input is missing resolved member "${catId}"`);
    }
    if (payload.identity === null) {
      throw new Error(`L0 frozen input is missing identity authority for "${catId}"`);
    }
  }
  verifyFrozenInputDigest(payload);
}

/**
 * Compile per-cat L0 by invoking the Phase B CLI as a subprocess.
 * @returns the compiled L0 string (file content when `outPath` is set, else stdout).
 * @throws when the script is unresolvable, the frozen snapshot cannot be built,
 *   the subprocess fails to spawn, exits non-zero, or produces empty output
 *   (fail-closed).
 */
/**
 * Repo/install root the L0 CLI will use for its assets, governance and dossier
 * lookups. The script lives at `<repoRoot>/scripts/compile-system-prompt-l0.mjs`
 * and derives its own REPO_ROOT as `dirname(script)..`. The child resolves its
 * module URL (following symlinks), so the parent must realpath the script too —
 * packaged installs mirror scripts/ through a symlinked project dir and a naive
 * dirname() would pick a different root than the child and change the frozen
 * bytes.
 */
function resolveL0CompilerRepoRoot(scriptPath: string): string {
  try {
    return resolve(dirname(realpathSync(scriptPath)), '..');
  } catch {
    return resolve(dirname(scriptPath), '..');
  }
}

export async function compileL0ViaSubprocess(options: CompileL0Options): Promise<string> {
  const { catId } = options;
  const userId = options.userId ?? process.env.CAT_CAFE_USER_ID ?? DEFAULT_PROFILE_USER_ID;
  const projection = resolveProjection(options);
  const cwd = options.cwd ?? process.cwd();
  const scriptPath = resolveL0CompilerScriptPath(cwd);
  const mode = options.frozenInputMode ?? 'frozen';

  if (mode === 'frozen') {
    if (!scriptPath) {
      throw new Error(
        `L0 compiler script not resolvable from cwd=${cwd} (expected scripts/${SCRIPT_BASENAME}); cannot compile L0 for ${catId}`,
      );
    }
    const profileDir =
      projection === 'owner' ? new FileProfileRepository({ dataDir: options.dataDir }).profileDir(userId) : undefined;
    const payload = await (options.buildFrozenInput ?? buildL0FrozenInput)({
      catId,
      projection,
      userId,
      ...(profileDir !== undefined ? { profileDir } : {}),
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
      cwd,
      repoRoot: resolveL0CompilerRepoRoot(scriptPath),
    });
    assertFrozenInput(payload, catId, projection);
    return compileFrozenPayload(options, scriptPath, payload, userId, projection, cwd);
  }

  return compileLegacy(options, scriptPath, userId, projection);
}

async function compileFrozenPayload(
  options: CompileL0Options,
  scriptPath: string,
  payload: L0FrozenInputV1,
  userId: string,
  projection: L0Projection,
  cwd: string,
): Promise<string> {
  const { catId, outPath } = options;
  const key = frozenCacheKey(userId, catId, projection, payload.digest);
  const dependencySignature = refreshL0DependencySignature(cwd, scriptPath);
  const projectionContext = resolveProjectionContext(options, userId, key, projection);
  const { profileSignature } = projectionContext;

  // Cache hit — skip subprocess entirely
  const cached = dependencySignature && profileSignature !== null ? l0Cache.get(key) : undefined;
  if (cached) {
    if (outPath) writeFileSync(outPath, cached, 'utf8');
    recordProfilePointerEmission(cached);
    return cached;
  }

  const inflight = dependencySignature && profileSignature !== null ? l0Cache.getInflight(key) : undefined;
  if (inflight) {
    const result = await inflight;
    if (outPath) writeFileSync(outPath, result, 'utf8');
    recordProfilePointerEmission(result);
    return result;
  }

  const compileGeneration = l0Cache.generation(key);
  const compilePromise = doCompileL0Frozen(
    { ...options, userId },
    payload,
    scriptPath,
    key,
    compileGeneration,
    dependencySignature,
    projectionContext,
  );
  l0Cache.setInflight(key, compilePromise);
  try {
    const result = await compilePromise;
    recordProfilePointerEmission(result);
    return result;
  } finally {
    l0Cache.deleteInflight(key, compilePromise);
  }
}

/** Spawn the L0 CLI and capture stdout; fail-closed on spawn/exit errors. */
function runL0Subprocess(args: string[], cwd: string, spawnFn: typeof nodeSpawn, catId: string): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawnFn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', (e: Error) => fail(new Error(`L0 compile spawn failed for ${catId}: ${e.message}`)));
    child.on('close', (code: number | null) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`L0 compile exited code=${code} for ${catId}: ${err.trim() || '(no stderr)'}`));
        return;
      }
      settled = true;
      resolvePromise(out);
    });
  });
}

function resolveCompiledResult(outPath: string | undefined, stdout: string, catId: string): string {
  if (outPath) {
    const result = readFileSync(outPath, 'utf8');
    if (result.trim().length === 0) {
      throw new Error(`L0 compile produced empty file ${outPath} for ${catId}`);
    }
    return result;
  }
  if (stdout.trim().length === 0) {
    throw new Error(`L0 compile produced empty output (no --out) for ${catId}`);
  }
  return stdout;
}

function cacheCompiledResult(
  key: string,
  result: string,
  compileGeneration: L0CacheGeneration,
  dependencySignature: string | null,
  projectionContext: L0ProjectionContext,
): void {
  const { profileSignature } = projectionContext;
  if (
    dependencySignature &&
    profileSignature !== null &&
    dependencySignatures.isCurrent(dependencySignature) &&
    projectionProfileIsCurrent(projectionContext) &&
    l0Cache.generationIsCurrent(key, compileGeneration)
  ) {
    l0Cache.set(key, result, profileSignature);
  }
}

/**
 * Frozen compile path: write the captured payload to an owned temp artifact,
 * pass `--frozen-input`, and remove the artifact after the child settles.
 */
async function doCompileL0Frozen(
  options: CompileL0Options,
  payload: L0FrozenInputV1,
  scriptPath: string,
  cacheKey: string,
  compileGeneration: L0CacheGeneration,
  dependencySignature: string | null,
  projectionContext: L0ProjectionContext,
): Promise<string> {
  const { catId, outPath, cwd = process.cwd(), spawnFn = nodeSpawn } = options;
  // Owned temp artifact: private dir, removed in finally (same pattern as the
  // existing --out temp dirs owned by the carrier services).
  const payloadDir = mkdtempSync(join(tmpdir(), 'cat-cafe-l0-frozen-'));
  const payloadPath = join(payloadDir, 'l0-frozen-input.json');
  try {
    writeFileSync(payloadPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    const args = [
      scriptPath,
      '--cat',
      catId,
      '--frozen-input',
      payloadPath,
      ...(projectionContext.projection !== 'owner' ? ['--projection', projectionContext.projection] : []),
      ...(outPath ? ['--out', outPath] : []),
    ];
    const stdout = await runL0Subprocess(args, cwd, spawnFn, catId);
    const result = resolveCompiledResult(outPath, stdout, catId);
    cacheCompiledResult(cacheKey, result, compileGeneration, dependencySignature, projectionContext);
    return result;
  } finally {
    try {
      rmSync(payloadDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; the private temp dir contains no secrets and is
      // reclaimed by the OS temp cleanup if removal fails.
    }
  }
}

/** Legacy diagnostics/CLI compile path: the child reloads the registry from disk. */
async function compileLegacy(
  options: CompileL0Options,
  scriptPath: string | undefined,
  userId: string,
  projection: L0Projection,
): Promise<string> {
  const { catId, outPath } = options;
  const cwd = options.cwd ?? process.cwd();
  const key = l0Cache.key(userId, catId, projection);
  const dependencySignature = scriptPath ? refreshL0DependencySignature(cwd, scriptPath) : null;
  const projectionContext = resolveProjectionContext(options, userId, key, projection);
  const { profileSignature } = projectionContext;

  // Cache hit — skip subprocess entirely
  const cached = dependencySignature && profileSignature !== null ? l0Cache.get(key) : undefined;
  if (cached) {
    if (outPath) writeFileSync(outPath, cached, 'utf8');
    recordProfilePointerEmission(cached);
    return cached;
  }

  const inflight = dependencySignature && profileSignature !== null ? l0Cache.getInflight(key) : undefined;
  if (inflight) {
    const result = await inflight;
    if (outPath) writeFileSync(outPath, result, 'utf8');
    recordProfilePointerEmission(result);
    return result;
  }

  const compileGeneration = l0Cache.generation(key);
  const compilePromise = doCompileL0Legacy(
    { ...options, userId },
    key,
    compileGeneration,
    dependencySignature,
    projectionContext,
  );
  l0Cache.setInflight(key, compilePromise);
  try {
    const result = await compilePromise;
    recordProfilePointerEmission(result);
    return result;
  } finally {
    // Always clean up the in-flight entry once settled — subsequent calls
    // will read from l0Cache (on success) or re-attempt (on failure).
    l0Cache.deleteInflight(key, compilePromise);
  }
}

/** Internal legacy compile path — separated so the dedup wrapper can install the promise. */
async function doCompileL0Legacy(
  options: CompileL0Options,
  cacheKey: string,
  compileGeneration: L0CacheGeneration,
  dependencySignature: string | null,
  projectionContext: L0ProjectionContext,
): Promise<string> {
  const { catId, outPath, cwd = process.cwd(), spawnFn = nodeSpawn } = options;
  const scriptPath = resolveL0CompilerScriptPath(cwd);
  if (!scriptPath) {
    throw new Error(
      `L0 compiler script not resolvable from cwd=${cwd} (expected scripts/${SCRIPT_BASENAME}); cannot compile L0 for ${catId}`,
    );
  }

  // F231 KD-19: private profile truth is user-scoped persistent data, never cwd/worktree state.
  // Public and private Work compilation receive neither profile paths nor bytes.
  const args = [
    scriptPath,
    '--cat',
    catId,
    ...(projectionContext.projection !== 'owner'
      ? ['--projection', projectionContext.projection]
      : ['--profile-dir', projectionContext.profileDir]),
    ...(outPath ? ['--out', outPath] : []),
  ];

  const stdout = await runL0Subprocess(args, cwd, spawnFn, catId);
  const result = resolveCompiledResult(outPath, stdout, catId);
  cacheCompiledResult(cacheKey, result, compileGeneration, dependencySignature, projectionContext);
  return result;
}
