/**
 * W3: structural compatibility key for one Host session's native fragment.
 *
 * The key answers a single question: may the next invocation reuse the native
 * session (and the bridge object that owns it)? It is deliberately structural:
 * callback tokens, delivery/invocation ids, temporary paths and display-only
 * fields (avatar/colour) are excluded by construction, so changing one of those
 * never forces a native fragment rebuild (C13).
 *
 * `keyVersion` is bumped whenever canonicalisation or hashing of a field
 * changes. A persisted key from another version is never compared as if it
 * were current: it is unverifiable and therefore cannot authorise reuse.
 *
 * Internal / unstable (#1647).
 */
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import type { SessionCompatibilitySnapshot } from '@cat-cafe/shared';

/** Bump when the canonical form or field set of the key changes. */
export const COMPATIBILITY_KEY_VERSION = 1 as const;

/**
 * Structural facts that decide native-fragment reuse. Everything not listed
 * here (avatar, colour, UI labels, tokens, delivery ids, temp paths) is either
 * display-only or invocation-local and must not appear in the key.
 */
export const COMPATIBILITY_FIELDS = [
  'clientId',
  'carrier',
  'implementation',
  'implementationGeneration',
  'accountRef',
  'nativeHome',
  'nativeStateRoot',
  'workspaceRoot',
  'workspaceFingerprint',
  'model',
  'effort',
  'permissionMode',
  'mcpSurfaceDigest',
  'launchConfigDigest',
  'instructionDigest',
] as const;

export type CompatibilityField = (typeof COMPATIBILITY_FIELDS)[number];

/**
 * Structural input for {@link computeCompatibilityKey}. Optional fields are
 * "unknown" when absent; a field that appears or disappears between two keys
 * is a structural change (new fragment), never an assumed match.
 */
export interface CompatibilityStructure {
  readonly clientId?: string;
  readonly carrier?: string;
  /** Opaque implementation select/key (builtin id or plugin contribution). */
  readonly implementation?: string;
  /** Invalidation generation of that implementation; a change rebuilds. */
  readonly implementationGeneration?: string;
  /** Opaque, secret-free account identity reference. */
  readonly accountRef?: string;
  readonly nativeHome?: string;
  readonly nativeStateRoot?: string;
  readonly workspaceRoot?: string;
  readonly workspaceFingerprint?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: string;
  readonly mcpSurfaceDigest?: string;
  /** Sanitised digest of launch/session config (no tokens, temp paths or ids). */
  readonly launchConfigDigest?: string;
  /** Digest of the instructions actually delivered for this fragment. */
  readonly instructionDigest?: string;
}

export interface CompatibilityFieldDigest {
  readonly field: string;
  readonly digest: string;
}

export interface CompatibilityKey {
  readonly keyVersion: typeof COMPATIBILITY_KEY_VERSION;
  readonly digest: string;
  readonly fieldDigests: readonly CompatibilityFieldDigest[];
}

export type CompatibilityReason =
  | 'compatible'
  | 'no_previous_key'
  | 'missing_next_structure'
  | 'key_version_mismatch'
  | 'structure_changed';

export interface CompatibilityComparison {
  readonly compatible: boolean;
  readonly changed: readonly CompatibilityField[];
  readonly reason: CompatibilityReason;
  /** Present when the compared record used a different (legacy/unknown) version. */
  readonly previousKeyVersion?: number;
}

type KeyLike = {
  readonly keyVersion: number;
  readonly digest?: string;
  readonly fieldDigests: readonly CompatibilityFieldDigest[];
};

const PATH_FIELDS = new Set<CompatibilityField>([
  'nativeHome',
  'nativeStateRoot',
  'workspaceRoot',
  'workspaceFingerprint',
]);

/** Stable textual digest used for instruction/config/field hashing. */
export function digestText(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Canonicalise a path for the key: forward slashes, no trailing separator, and
 * case-folded on Windows (where a path identity is case-insensitive). This is
 * about identity, not the value handed to the provider.
 */
export function canonicalStructuralPath(input: string): string {
  const absolute = resolve(input).replaceAll(sep, '/');
  const withoutTrailing = absolute.length > 1 ? absolute.replace(/\/+$/, '') : absolute;
  return process.platform === 'win32' ? withoutTrailing.toLowerCase() : withoutTrailing;
}

/** Canonical value of one structural field; `undefined` means "unknown". */
function canonicalFieldValue(field: CompatibilityField, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return PATH_FIELDS.has(field) ? canonicalStructuralPath(trimmed) : trimmed;
}

const SENSITIVE_CONFIG_KEY = /(token|secret|callback|delivery|invocation|nonce|timestamp|temp|tmp|pid|log)/i;

/**
 * Digest of launch/session config, excluding invocation-local or secret keys.
 * Object keys are sorted so equal config always hashes equally, and callback
 * tokens / delivery ids / temp paths can never force a new native fragment.
 */
export function stableConfigDigest(config: Record<string, unknown>): string {
  return digestText(`config:v${COMPATIBILITY_KEY_VERSION}\n${canonicalJson(config, new Set())}`);
}

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    if (seen.has(value)) return '"<circular>"';
    seen.add(value);
    const items = value.map((item) => canonicalJson(item, seen));
    seen.delete(value);
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) return '"<circular>"';
    seen.add(record);
    const entries = Object.keys(record)
      .filter((key) => !SENSITIVE_CONFIG_KEY.test(key) && record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`);
    seen.delete(record);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** Hash one structural field value, keeping each field comparable on its own. */
function hashField(field: CompatibilityField, value: string): string {
  return digestText(`field:v${COMPATIBILITY_KEY_VERSION}\u0000${field}\u0000${value}`);
}

/**
 * Compute the canonical structural key. Only declared fields are read; callers
 * cannot smuggle invocation-local values into the key through extra properties.
 */
export function computeCompatibilityKey(structure: CompatibilityStructure): CompatibilityKey {
  const fieldDigests: CompatibilityFieldDigest[] = [];
  for (const field of COMPATIBILITY_FIELDS) {
    const value = canonicalFieldValue(field, structure[field]);
    if (value === undefined) continue;
    fieldDigests.push({ field, digest: hashField(field, value) });
  }
  const material = fieldDigests.map(({ field, digest }) => `${field}\u0000${digest}`).join('\n');
  return {
    keyVersion: COMPATIBILITY_KEY_VERSION,
    digest: digestText(`key:v${COMPATIBILITY_KEY_VERSION}\n${material}`),
    fieldDigests,
  };
}

/** Persist only the digest projection, never the raw structural values. */
export function toSessionCompatibilitySnapshot(key: CompatibilityKey): SessionCompatibilitySnapshot {
  return {
    keyVersion: COMPATIBILITY_KEY_VERSION,
    digest: key.digest,
    fieldDigests: key.fieldDigests.map(({ field, digest }) => ({ field, digest })),
  };
}

function isKeyLike(value: CompatibilityKey | CompatibilityStructure | KeyLike): value is KeyLike {
  return Array.isArray((value as KeyLike).fieldDigests);
}

/** Versioned input (persisted key) vs raw structure (implicitly current version). */
function keyVersionOf(value: CompatibilityKey | CompatibilityStructure | KeyLike): number | undefined {
  const version = (value as Partial<KeyLike>).keyVersion;
  return typeof version === 'number' ? version : undefined;
}

function fieldDigestMap(value: CompatibilityKey | CompatibilityStructure | KeyLike): Map<string, string> {
  if (isKeyLike(value)) {
    return new Map(value.fieldDigests.map(({ field, digest }) => [field, digest]));
  }
  const key = computeCompatibilityKey(value as CompatibilityStructure);
  return new Map(key.fieldDigests.map(({ field, digest }) => [field, digest]));
}

/**
 * Compare two compatibility inputs and report which structural fields changed.
 * A missing previous key is legacy/unverifiable: it is NOT compatible. Only an
 * explicit persisted key of the current version may authorise reuse.
 */
export function compareCompatibility(
  previous: CompatibilityKey | CompatibilityStructure | SessionCompatibilitySnapshot | undefined,
  next: CompatibilityKey | CompatibilityStructure | undefined,
): CompatibilityComparison {
  if (!previous) return { compatible: false, changed: [], reason: 'no_previous_key' };
  if (!next) return { compatible: false, changed: [], reason: 'missing_next_structure' };
  const previousVersion = keyVersionOf(previous);
  const nextVersion = keyVersionOf(next);
  if (
    (previousVersion !== undefined && previousVersion !== COMPATIBILITY_KEY_VERSION) ||
    (nextVersion !== undefined && nextVersion !== COMPATIBILITY_KEY_VERSION)
  ) {
    return {
      compatible: false,
      changed: [],
      reason: 'key_version_mismatch',
      ...(previousVersion !== undefined ? { previousKeyVersion: previousVersion } : {}),
    };
  }
  const before = fieldDigestMap(previous);
  const after = fieldDigestMap(next);
  const changed = COMPATIBILITY_FIELDS.filter((field) => before.get(field) !== after.get(field));
  return {
    compatible: changed.length === 0,
    changed,
    reason: changed.length === 0 ? 'compatible' : 'structure_changed',
  };
}
