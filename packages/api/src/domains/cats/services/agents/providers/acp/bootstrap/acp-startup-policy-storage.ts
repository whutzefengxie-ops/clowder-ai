/**
 * Persistent storage for local ACP startup policies.
 *
 * Policies are stored in a protected location with integrity checks.
 * Only the instance owner can import policies through controlled entry points.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AcpStartupPolicy } from './acp-startup-policy-types.js';

/**
 * Storage location for local policies.
 * Located in user's home directory, outside project trees.
 */
function getPolicyStoragePath(): string {
  return join(homedir(), '.clowder-ai', 'acp-policies');
}

/**
 * Compute integrity hash for a policy record.
 */
function computePolicyHash(policy: AcpStartupPolicy): string {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Load all persisted policies from disk.
 * Returns empty array if storage doesn't exist or on read errors.
 */
export function loadPersistedPolicies(): AcpStartupPolicy[] {
  const storagePath = getPolicyStoragePath();
  const manifestPath = join(storagePath, 'policies.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  try {
    const content = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.policies)) {
      console.warn('[acp-policy-storage] Invalid manifest format, ignoring');
      return [];
    }

    // Validate each policy's integrity
    const validPolicies: AcpStartupPolicy[] = [];
    for (const entry of manifest.policies) {
      if (!entry.policy || !entry.integrityHash) continue;

      const computed = computePolicyHash(entry.policy);
      if (computed !== entry.integrityHash) {
        console.warn(`[acp-policy-storage] Integrity check failed for ${entry.policy.policyId}, skipping`);
        continue;
      }

      validPolicies.push(entry.policy);
    }

    return validPolicies;
  } catch (error) {
    console.error('[acp-policy-storage] Failed to load policies:', error);
    return [];
  }
}

/**
 * Persist policies to disk with integrity hashes.
 */
export function persistPolicies(policies: AcpStartupPolicy[]): { success: boolean; error?: string } {
  const storagePath = getPolicyStoragePath();
  const manifestPath = join(storagePath, 'policies.json');

  try {
    // Ensure storage directory exists
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true, mode: 0o700 });
    }

    // Build manifest with integrity hashes
    const manifest = {
      version: 1,
      policies: policies.map((policy) => ({
        policy,
        integrityHash: computePolicyHash(policy),
        importedAt: new Date().toISOString(),
      })),
    };

    // Atomic write: write to temp file, then rename
    const tempPath = `${manifestPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });

    // On Windows, must remove target before rename
    if (existsSync(manifestPath)) {
      const backupPath = `${manifestPath}.bak`;
      if (existsSync(backupPath)) {
        // Remove old backup
        try {
          unlinkSync(backupPath);
        } catch {
          // Ignore
        }
      }
      renameSync(manifestPath, backupPath);
    }

    renameSync(tempPath, manifestPath);

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to persist policies: ${error}` };
  }
}
