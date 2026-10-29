/**
 * Frozen L0 input payload (W2 / C06).
 *
 * At invocation admission the parent process resolves the effective member
 * configuration, roster, identity authority, governance text, capsule and
 * compiler dependency facts once, writes them to a private v1 JSON payload and
 * passes that payload to the L0 child via `--frozen-input`. The child renders
 * exactly this input and never reloads the registry / member catalog from disk,
 * so a configuration edit that happens while an invocation waits cannot leak
 * into the already admitted invocation.
 *
 * This module owns parent-side resolution only. It adds no store and no queue:
 * the payload is a short-lived file in the same mkdtemp temp-artifact pattern
 * the L0 compiler already uses for `--out` files, removed by its owner.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CatBreed, CatCafeConfig, CatConfig, CatVariant, IdentityAuthorityPreview } from '@cat-cafe/shared';
import { getDossierL0Pronouns, getDossierL0RoutingNote, getDossierL0SelfDescription } from '@cat-cafe/shared/dossier';
import {
  CURRENT_CORPUS_PROFILE_URI,
  CURRENT_RELATIONSHIP_PROFILE_URI,
  profileCapsuleReadRelativePath,
  profileCorpusRelativePath,
  relationshipPrimerRelativePath,
  renderUserCapsuleSection,
} from '@cat-cafe/shared/profile-contract';
import {
  getCoCreatorConfig,
  isCatAvailable,
  loadCatConfig,
  toAllCatConfigs,
} from '../../../../../config/cat-config-loader.js';
import { resolveMemberIdentity } from '../../../../../config/member-identity-resolution.js';
import { findRawMemberLocation, projectRoleProfile } from '../../../../../config/member-profile-projection.js';
import { loadCompiledGovernanceL0 } from '../../context/governance-l0.js';
import { FileProfileRepository } from '../../profile/ProfileRepository.js';
import { findWorkspaceRoot } from './l0-dependency-signature.js';
import type { L0Projection } from './l0-profile-cache.js';

/** Only v1 is supported; the child fails closed on any other version. */
export const L0_FROZEN_INPUT_VERSION = 1 as const;

export interface L0FrozenMemberEntry {
  readonly catId: string;
  /** Non-credential effective member configuration (no secrets, no env). */
  readonly config: CatConfig;
}

export interface L0FrozenRosterEntry extends L0FrozenMemberEntry {
  readonly runtimeModel: string;
  /** Dossier pronoun reminder resolved at freeze time; `null` when absent/not opted in. */
  readonly pronouns: string | null;
  /** Route-critical note resolved at freeze time (`l0RoutingNote` then `caution`); `null` when none. */
  readonly routingNote: string | null;
}

export interface L0FrozenWorkflowTriggers {
  readonly basePath: string;
  /** Local overlay selected at freeze time; `null` means the base file is effective. */
  readonly overlayPath: string | null;
}

export interface L0FrozenInputV1 {
  readonly version: typeof L0_FROZEN_INPUT_VERSION;
  readonly catId: string;
  readonly projection: L0Projection;
  readonly members: readonly L0FrozenMemberEntry[];
  readonly roster: readonly L0FrozenRosterEntry[];
  readonly runtimeModel: string | null;
  /** Authoritative identity decision from the parent (owner projection only). */
  readonly identity: IdentityAuthorityPreview | null;
  readonly governanceL0: string;
  readonly capsule: string;
  readonly workflowTriggers: L0FrozenWorkflowTriggers;
  readonly coCreator: { readonly name: string; readonly mentionPatterns: readonly string[] } | null;
  /** SHA-256 over the canonicalized payload without this field. */
  readonly digest: string;
}

export type L0FrozenInputBody = Omit<L0FrozenInputV1, 'digest'>;

export interface BuildL0FrozenInputOptions {
  readonly catId: string;
  readonly projection?: L0Projection;
  readonly userId?: string;
  /** Canonical profile dir already resolved by the caller (owner projection). */
  readonly profileDir?: string;
  /** Canonical data root seam; defaults to CAT_CAFE_DATA_DIR / ~/.cat-cafe. */
  readonly dataDir?: string;
  /** Working dir used to resolve local prompt overlays (defaults to process.cwd()). */
  readonly cwd?: string;
  /** Install/repo root that owns assets, governance and the workflow templates. */
  readonly repoRoot: string;
  /** Dossier root; defaults to repoRoot (fixture/test isolation seam). */
  readonly dossierRoot?: string;
  /** Test seams (default: production resolution). */
  readonly loadConfig?: () => CatCafeConfig;
  readonly loadGovernance?: (repoRoot: string) => Promise<string>;
}

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child !== undefined) sorted[key] = canonicalizeValue(child);
    }
    return sorted;
  }
  return value;
}

/** Deterministic JSON used for the payload digest (stable key order, no undefined). */
export function canonicalizeL0FrozenInput(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function computeL0FrozenInputDigest(body: L0FrozenInputBody): string {
  return createHash('sha256').update(canonicalizeL0FrozenInput(body)).digest('hex');
}

function withDigest(body: L0FrozenInputBody): L0FrozenInputV1 {
  return { ...body, digest: computeL0FrozenInputDigest(body) };
}

function runtimeModelEnvKey(catId: string): string {
  return `CAT_${catId.toUpperCase().replace(/-/g, '_')}_MODEL`;
}

/**
 * Resolve the runtime model exactly like the legacy compiler's `getCatModel`
 * fallback chain, but against the effective config captured in this payload:
 * native-tool configs keep their configured model, env override wins otherwise.
 */
export function resolveFrozenRuntimeModel(catId: string, config: CatConfig): string {
  if (config.configurationSource === 'native_tool') return config.defaultModel;
  return process.env[runtimeModelEnvKey(catId)]?.trim() || config.defaultModel;
}

/**
 * Resolve the owner capsule section (body + optional primer/corpus pointers).
 * Mirrors `resolveUserCapsule` in `scripts/compile-system-prompt-l0.mjs`; the
 * frozen-vs-legacy equivalence test guards this duplication.
 */
export function resolveFrozenCapsuleSection(profileDir: string, relationshipKey: string): string {
  const capsulePath = resolve(
    profileDir,
    profileCapsuleReadRelativePath((path) => existsSync(resolve(profileDir, path))),
  );
  const primerPath = resolve(profileDir, relationshipPrimerRelativePath(relationshipKey));
  const corpusPath = resolve(profileDir, profileCorpusRelativePath());
  const entries: string[] = [];
  if (existsSync(primerPath)) {
    entries.push(`关系轨迹: ${CURRENT_RELATIONSHIP_PROFILE_URI}（cat_cafe_read_profile 按需读）`);
  }
  if (existsSync(corpusPath)) {
    entries.push(`共享事实: ${CURRENT_CORPUS_PROFILE_URI}（cat_cafe_read_profile layer=corpus 按需读）`);
  }
  const pointers = entries.length
    ? [...entries, '读源走本轮绑定的 Clowder AI 连接；勿用独立 App 的同名工具替代。'].join('\n')
    : '';
  let raw: string;
  try {
    raw = readFileSync(capsulePath, 'utf8');
  } catch {
    return pointers;
  }
  let section = renderUserCapsuleSection(raw);
  if (!section) return pointers;
  if (pointers) section += `\n\n${pointers}`;
  return section;
}

interface ResolvedRawMember {
  readonly breed?: CatBreed;
  readonly variant?: CatVariant;
}

function resolveRawMember(config: CatCafeConfig, catId: string): ResolvedRawMember {
  const location = findRawMemberLocation(config, catId);
  return location ? { breed: location.breed, variant: location.variant } : {};
}

function resolveWorkflowTriggerPaths(repoRoot: string, cwd: string): L0FrozenWorkflowTriggers {
  const basePath = resolve(repoRoot, 'assets/prompt-templates/workflow-triggers.yaml');
  const localPath = resolve(findWorkspaceRoot(cwd), '.cat-cafe', 'prompt-overlays', 'workflow-triggers.local.yaml');
  return { basePath, overlayPath: existsSync(localPath) ? localPath : null };
}

interface FrozenOwnerInputs {
  readonly target: CatConfig;
  readonly runtimeModel: string;
  readonly identity: IdentityAuthorityPreview;
  readonly roster: readonly L0FrozenRosterEntry[];
  readonly capsule: string;
  readonly coCreator: { readonly name: string; readonly mentionPatterns: readonly string[] } | null;
}

function resolveOwnerInputs(options: BuildL0FrozenInputOptions, loaded: CatCafeConfig): FrozenOwnerInputs {
  const { catId } = options;
  const allConfigs = toAllCatConfigs(loaded);
  const target = allConfigs[catId];
  if (!target) {
    throw new Error(`L0 frozen input: unknown member "${catId}" in resolved member configuration`);
  }
  const raw = resolveRawMember(loaded, catId);
  const role = projectRoleProfile({ config: target, breed: raw.breed, variant: raw.variant });
  const dossierRoot = options.dossierRoot ?? options.repoRoot;
  const identity = resolveMemberIdentity({
    catId,
    roleDescription: role.roleDescription.value,
    personality: role.personality.value,
    roleDescriptionSource: role.roleDescription.source,
    personalitySource: role.personality.source,
    dossier: {
      selfDescription: getDossierL0SelfDescription(catId, dossierRoot) ?? null,
    },
  });

  const includeMember = (id: string): boolean => id !== catId && isCatAvailable(id, loaded);
  const roster: L0FrozenRosterEntry[] = [];
  for (const [id, memberConfig] of Object.entries(allConfigs)) {
    if (!includeMember(id)) continue;
    roster.push({
      catId: id,
      config: memberConfig,
      runtimeModel: resolveFrozenRuntimeModel(id, memberConfig),
      pronouns: getDossierL0Pronouns(id, dossierRoot) ?? null,
      routingNote: getDossierL0RoutingNote(id, dossierRoot) ?? memberConfig.caution ?? null,
    });
  }

  const relationshipKey = target.relationshipKey;
  if (!relationshipKey) {
    throw new Error(`L0 frozen input: no relationshipKey configured for catId "${catId}"`);
  }
  const userId = options.userId ?? process.env.CAT_CAFE_USER_ID ?? 'default-user';
  const profileDir = options.profileDir ?? new FileProfileRepository({ dataDir: options.dataDir }).profileDir(userId);
  const capsule = resolveFrozenCapsuleSection(profileDir, relationshipKey);
  const coCreatorConfig = getCoCreatorConfig(loaded);

  return {
    target,
    runtimeModel: resolveFrozenRuntimeModel(catId, target),
    identity: {
      roleDescription: identity.roleDescription,
      personality: identity.personality,
      selfDescription: identity.selfDescription,
      suppressed: identity.suppressed,
      supplementary: identity.supplementary,
    },
    roster,
    capsule,
    coCreator: { name: coCreatorConfig.name, mentionPatterns: coCreatorConfig.mentionPatterns },
  };
}

/**
 * Build the frozen v1 payload for one L0 compile.
 *
 * Fail-closed: unresolvable member configuration, missing target member,
 * missing relationshipKey, unreadable governance or an over-limit capsule all
 * throw here, before any child process is spawned.
 */
export async function buildL0FrozenInput(options: BuildL0FrozenInputOptions): Promise<L0FrozenInputV1> {
  const projection = options.projection ?? 'owner';
  const cwd = options.cwd ?? process.cwd();
  const workflowTriggers = resolveWorkflowTriggerPaths(options.repoRoot, cwd);

  if (projection === 'public') {
    return withDigest({
      version: L0_FROZEN_INPUT_VERSION,
      catId: options.catId,
      projection,
      members: [],
      roster: [],
      runtimeModel: null,
      identity: null,
      governanceL0: '',
      capsule: '',
      workflowTriggers,
      coCreator: null,
    });
  }

  const loaded = (options.loadConfig ?? loadCatConfig)();
  const governanceLoader =
    options.loadGovernance ?? (async (root: string) => (await loadCompiledGovernanceL0(root)).content);
  const governanceL0 = await governanceLoader(options.repoRoot);
  const inputs = resolveOwnerInputs(options, loaded);

  return withDigest({
    version: L0_FROZEN_INPUT_VERSION,
    catId: options.catId,
    projection,
    members: [{ catId: options.catId, config: inputs.target }],
    roster: inputs.roster,
    runtimeModel: inputs.runtimeModel,
    identity: inputs.identity,
    governanceL0,
    capsule: inputs.capsule,
    workflowTriggers,
    coCreator: inputs.coCreator,
  });
}
