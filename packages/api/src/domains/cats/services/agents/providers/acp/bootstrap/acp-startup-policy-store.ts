/**
 * ACP startup policy store - manages audited policies.
 *
 * This is the canonical reader for startup policies. Policies are immutable
 * data records; the only writer is the controlled import mechanism.
 */

import type { AcpStartupPolicy } from './acp-startup-policy-types.js';

/**
 * Built-in policies included with this version of Clowder AI.
 *
 * These represent publicly audited and reviewed ACP providers.
 */
const BUILTIN_POLICIES: AcpStartupPolicy[] = [
  // Policy for the built-in Pi bridge
  {
    schemaVersion: 1,
    policyId: 'builtin-pi-bridge',
    revision: 1,
    label: 'Built-in Pi ACP Bridge',
    provenance: {
      reviewer: 'clowder-team',
      auditDate: '2024-01-15',
      evidenceRef:
        'https://github.com/zts212653/clowder-ai/blob/main/packages/api/src/domains/cats/services/agents/providers/pi/pi-acp-bridge.js',
    },
    launchShape: {
      entryPattern: 'node-absolute',
      requiredArgs: {
        fixed: ['--pi-command'],
      },
      forbiddenEnv: ['NODE_OPTIONS', 'NODE_PATH'],
    },
    artifacts: [
      {
        path: 'pi-acp-bridge.js',
        sha256: 'dynamic', // Verified by realpath comparison
      },
    ],
    assurance: 'Pi bridge does not read ancestor configuration; isolated initialization only',
  },

  // Policy for DSH 0.2.0-rc.2
  {
    schemaVersion: 1,
    policyId: 'dsh-0.2.0-rc.2',
    revision: 1,
    label: 'DSH 0.2.0-rc.2 (audited)',
    provenance: {
      reviewer: 'clowder-team',
      auditDate: '2024-01-20',
      evidenceRef: 'https://github.com/zts212653/clowder-ai/pull/1658',
    },
    launchShape: {
      entryPattern: 'node-absolute',
      requiredArgs: {
        named: { '--profile': 'acp' },
      },
      forbiddenEnv: ['NODE_OPTIONS', 'NODE_PATH'],
    },
    artifacts: [
      {
        path: 'entry',
        sha256: '1a03dee18683483ff6a1b27b2a1e650230da6bcca9a0f55f7d81b3308c3f307f',
      },
      {
        path: 'profile-boot.js',
        sha256: 'c53d4e2caf21428e263b525e657dafaf63fd183f7ef016aabda56af7998b6c4f',
      },
      {
        path: 'profile-boot-BZ2ZjNWi.js',
        sha256: 'c394b2aa2ce08a3b1fcc8c544257c7d689dd4d0b1cfaf8602687e65eeaba5aa1',
      },
      {
        path: '@deepseek-ai/dsh-app-boot',
        sha256: '234db45e1b3f8c683b5bc1f551948b2a2ec52a6468c7b6937725a23f1c0e0d96',
      },
      {
        path: '@deepseek-ai/dsh-acp',
        sha256: 'c08ed51ebe53b7b45ca8f475630afc0271bf4ccb8b53f13b456fe2b4568a61b3',
      },
    ],
    packageConstraints: {
      name: '@deepseek-ai/dsh',
      version: '0.2.0-rc.2',
    },
    profileConstraints: {
      allowedBundles: [['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']],
      allowEmpty: true,
      noPatch: true,
    },
    assurance: 'DSH 0.2.0-rc.2 with default/empty ACP profile does not read ancestor configuration',
  },
];

/**
 * Local policies imported by the instance owner.
 *
 * Stored in memory (Map by policyId-revision key).
 * Future: persist to validated storage with integrity checks.
 */
const localPolicies = new Map<string, AcpStartupPolicy>();

/**
 * Policy change listeners (for pool invalidation on revocation/updates).
 */
type PolicyChangeListener = (policyId: string, revision: number) => void;
const policyChangeListeners = new Set<PolicyChangeListener>();

/**
 * Register a listener for policy changes.
 * Returns an unsubscribe function.
 */
export function onPolicyChange(listener: PolicyChangeListener): () => void {
  policyChangeListeners.add(listener);
  return () => policyChangeListeners.delete(listener);
}

/**
 * Notify all listeners of a policy change (for pool invalidation).
 */
function notifyPolicyChange(policyId: string, revision: number): void {
  for (const listener of policyChangeListeners) {
    try {
      listener(policyId, revision);
    } catch (error) {
      console.error('[acp-policy-store] Listener error:', error);
    }
  }
}

/**
 * Generate a unique key for policy storage.
 */
function makePolicyKey(policyId: string, revision: number): string {
  return `${policyId}@${revision}`;
}

/**
 * Get all active policies (builtin + local).
 */
export function getActivePolicies(): ReadonlyArray<AcpStartupPolicy> {
  return [...BUILTIN_POLICIES, ...Array.from(localPolicies.values())];
}

/**
 * Get a specific policy by ID and optional revision.
 */
export function getPolicy(policyId: string, revision?: number): AcpStartupPolicy | undefined {
  const policies = getActivePolicies();
  const matches = policies.filter((p) => p.policyId === policyId);

  if (revision !== undefined) {
    return matches.find((p) => p.revision === revision);
  }

  // Return the highest revision
  return matches.sort((a, b) => b.revision - a.revision)[0];
}

/**
 * Check if a policy is currently active.
 */
export function isPolicyActive(policyId: string, revision: number): boolean {
  return getActivePolicies().some((p) => p.policyId === policyId && p.revision === revision);
}

/**
 * Import a policy into the local policy store.
 *
 * This is a controlled import - policies must be explicitly added by authorized users.
 * The policy is validated before being added.
 *
 * Security boundaries:
 * - Policies are NOT auto-trusted based on file scans or package declarations
 * - Provenance must be explicitly provided (but not auto-verified in this impl)
 * - Conflicts with existing policies are detected
 * - Storage is in-memory for this implementation (no persistence yet)
 *
 * @param policy The policy to import
 * @returns Success status and error message if failed
 */
export function importPolicy(policy: AcpStartupPolicy): { success: boolean; error?: string } {
  // Validate schema version
  if (policy.schemaVersion !== 1) {
    return { success: false, error: `Unsupported schema version: ${policy.schemaVersion}` };
  }

  // Validate required fields
  if (!policy.policyId || !policy.label) {
    return { success: false, error: 'Policy must have policyId and label' };
  }

  if (!policy.revision || policy.revision < 1) {
    return { success: false, error: 'Policy must have revision >= 1' };
  }

  if (!policy.provenance || !policy.provenance.reviewer || !policy.provenance.evidenceRef) {
    return { success: false, error: 'Policy must have complete provenance (reviewer, evidenceRef)' };
  }

  if (!policy.artifacts || policy.artifacts.length === 0) {
    return { success: false, error: 'Policy must have at least one artifact' };
  }

  // Validate artifacts have proper hashes (not placeholder values)
  for (const artifact of policy.artifacts) {
    if (!artifact.sha256 || artifact.sha256.length < 32 || !/^[a-f0-9]+$/i.test(artifact.sha256)) {
      return { success: false, error: `Invalid SHA-256 hash for artifact ${artifact.path}: ${artifact.sha256}` };
    }
  }

  // Validate launch shape - must have argument constraints for DSH policies
  if (policy.policyId.startsWith('dsh-')) {
    if (!policy.launchShape.requiredArgs?.named) {
      return { success: false, error: 'DSH policies must specify requiredArgs.named (e.g., --profile)' };
    }
    if (!policy.launchShape.requiredArgs.named['--profile']) {
      return { success: false, error: 'DSH policies must specify --profile requirement' };
    }
  }

  // Check for conflicts: cannot import same policyId+revision
  const key = makePolicyKey(policy.policyId, policy.revision);
  if (localPolicies.has(key)) {
    return { success: false, error: `Policy ${policy.policyId}@${policy.revision} already exists` };
  }

  // Check for conflicts with builtin policies
  const builtinConflict = BUILTIN_POLICIES.find(
    (p) => p.policyId === policy.policyId && p.revision === policy.revision
  );
  if (builtinConflict) {
    return { success: false, error: `Conflicts with builtin policy ${policy.policyId}@${policy.revision}` };
  }

  // Import the policy
  localPolicies.set(key, policy);

  // Notify listeners (for pool invalidation)
  notifyPolicyChange(policy.policyId, policy.revision);

  return { success: true };
}

/**
 * Revoke a policy from the local policy store.
 *
 * Revoking a policy:
 * 1. Removes it from the active set
 * 2. Triggers pool invalidation notifications
 * 3. Causes new spawn attempts using this policy to fail
 *
 * @param policyId The policy ID to revoke
 * @param revision Optional specific revision to revoke (if omitted, revokes all revisions)
 * @returns Success status and error message if failed
 */
export function revokePolicy(policyId: string, revision?: number): { success: boolean; error?: string } {
  if (!policyId) {
    return { success: false, error: 'policyId is required' };
  }

  // Cannot revoke builtin policies
  const isBuiltin = BUILTIN_POLICIES.some(
    (p) => p.policyId === policyId && (revision === undefined || p.revision === revision)
  );
  if (isBuiltin) {
    return { success: false, error: `Cannot revoke builtin policy: ${policyId}` };
  }

  let revokedCount = 0;

  if (revision !== undefined) {
    // Revoke specific revision
    const key = makePolicyKey(policyId, revision);
    if (localPolicies.delete(key)) {
      revokedCount++;
      notifyPolicyChange(policyId, revision);
    }
  } else {
    // Revoke all revisions of this policy
    const toRevoke: string[] = [];
    for (const [key, policy] of localPolicies.entries()) {
      if (policy.policyId === policyId) {
        toRevoke.push(key);
      }
    }

    for (const key of toRevoke) {
      const policy = localPolicies.get(key);
      if (policy) {
        localPolicies.delete(key);
        notifyPolicyChange(policy.policyId, policy.revision);
        revokedCount++;
      }
    }
  }

  if (revokedCount === 0) {
    return { success: false, error: `Policy not found: ${policyId}${revision !== undefined ? `@${revision}` : ''}` };
  }

  return { success: true };
}
