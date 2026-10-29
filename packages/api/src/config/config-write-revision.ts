/**
 * S3 (W1 save CAS): stable write revisions for hot-updatable global config keys.
 *
 * A revision is a deterministic sha256 over `[key, canonical snapshot value]`, so
 * every reader that starts from the same `collectConfigSnapshot()` result computes
 * the same token, and any value change changes the token. This module is pure: it
 * owns no store/DB/service; callers pass the snapshot they already read and the
 * ConfigStore snapshot path resolver they already use.
 */

import { createHash } from 'node:crypto';
import type { ConfigSnapshotPath } from './ConfigStore.js';

/**
 * Hot-updatable keys the formal member editor writes through `PATCH /api/config`.
 * `GET /api/config` exposes one write revision per key so the editor can send the
 * baseline it read and detect that another writer changed the value meanwhile.
 */
export const MEMBER_EDITOR_CONFIG_KEYS = [
  'cli.codexSandboxMode',
  'cli.codexApprovalPolicy',
  'codex.execution.authMode',
] as const;

export type MemberEditorConfigKey = (typeof MEMBER_EDITOR_CONFIG_KEYS)[number];

/**
 * Canonicalize a JSON-ish value: object keys sorted, arrays keep their order.
 * Mirrors the existing member-create receipt canonicalization so both revision
 * families are stable across JS property insertion order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/**
 * Stable revision of one config key's value. Same `[key, value]` pair => same
 * digest; a different key or value => a different digest. `undefined` values are
 * represented by JSON's array-hole `null`, so an absent key still has a revision.
 */
export function configWriteRevision(key: string, snapshotValue: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([key, canonicalize(snapshotValue)]))
    .digest('hex');
}

/** Resolve a key's value from a config snapshot using its ConfigStore snapshot path. */
export function configSnapshotValue(snapshot: unknown, path: ConfigSnapshotPath | undefined): unknown {
  if (!path) return undefined;
  let current: unknown = snapshot;
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Write revisions for the member-editor global settings, computed from the same
 * snapshot returned by `GET /api/config` (no second read, no caching).
 */
export function memberEditorWriteRevisions(
  snapshot: unknown,
  resolveSnapshotPath: (key: string) => ConfigSnapshotPath | undefined,
): Record<MemberEditorConfigKey, string> {
  const revisions = {} as Record<MemberEditorConfigKey, string>;
  for (const key of MEMBER_EDITOR_CONFIG_KEYS) {
    revisions[key] = configWriteRevision(key, configSnapshotValue(snapshot, resolveSnapshotPath(key)));
  }
  return revisions;
}
