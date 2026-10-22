/**
 * ACP startup policy store - manages audited policies.
 *
 * This is the canonical reader for startup policies. Policies are immutable
 * data records; the only writer is the controlled import mechanism.
 */

import type { AcpStartupPolicy } from './acp-startup-policy-types.js';
import { loadPersistedPolicies, persistPolicies } from './acp-startup-policy-storage.js';

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
 * Loaded from persistent storage on initialization.
 * Changes are persisted to disk on import/revoke.
 */
const localPolicies = new Map<string, AcpStartupPolicy>();

// Load persisted policies on module initialization
try {
  const persisted = loadPersistedPolicies();
  for (const policy of persisted) {
    const key = makePolicyKey(policy.policyId, policy.revision);
    localPolicies.set(key, policy);
  }
  if (persisted.length > 0) {
    console.info(`[acp-policy-store] Loaded ${persisted.length} persisted policies`);
  }
} catch (error) {
  console.error('[acp-policy-store] Failed to load persisted policies:', error);
}

/**
 * Sync local policies to persistent storage.
 * Returns success/error for transactional import/revoke.
 */
function syncToStorage(): { success: boolean; error?: string } {
  try {
    const policies = Array.from(localPolicies.values());
    const result = persistPolicies(policies);
    if (!result.success) {
      console.error('[acp-policy-store] Failed to persist policies:', result.error);
      return result;
    }
    return { success: true };
  } catch (error) {
    const errorMsg = `Failed to sync policies: ${error}`;
    console.error('[acp-policy-store]', errorMsg);
    return { success: false, error: errorMsg };
  }
}

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
 * Deep clone a policy to prevent caller modification of internal state.
 */
function clonePolicy(policy: AcpStartupPolicy): AcpStartupPolicy {
  return JSON.parse(JSON.stringify(policy)) as AcpStartupPolicy;
}

/**
 * Get all active policies (builtin + local).
 * Returns deep clones to prevent caller modification of internal state.
 */
export function getActivePolicies(): ReadonlyArray<AcpStartupPolicy> {
  const builtinClones = BUILTIN_POLICIES.map(clonePolicy);
  const localClones = Array.from(localPolicies.values()).map(clonePolicy);
  return [...builtinClones, ...localClones];
}

/**
 * Get a specific policy by ID and optional revision.
 * Returns a deep clone to prevent caller modification of internal state.
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
 * Reload local policies from persistent storage.
 * This ensures we have the latest state from disk, even if another process modified it.
 */
function reloadFromStorage(): { success: boolean; error?: string } {
  try {
    const persisted = loadPersistedPolicies();

    // Clear current local policies
    localPolicies.clear();

    // Reload from disk
    for (const policy of persisted) {
      const key = makePolicyKey(policy.policyId, policy.revision);
      localPolicies.set(key, policy);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = `Failed to reload policies from storage: ${error}`;
    console.error('[acp-policy-store]', errorMsg);
    return { success: false, error: errorMsg };
  }
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
  // Reload from storage to get latest state (in case another process modified it)
  const reloadResult = reloadFromStorage();
  if (!reloadResult.success) {
    return { success: false, error: `Failed to reload policies before import: ${reloadResult.error}` };
  }

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

  // Validate artifacts have proper hashes (SHA-256 = 64 hex chars)
  for (const artifact of policy.artifacts) {
    if (!artifact.sha256 || artifact.sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      return { success: false, error: `Invalid SHA-256 hash for artifact ${artifact.path}: must be 64 hex characters` };
    }
  }

  // Validate launch shape - ALL non-Pi policies must have complete argument constraints
  // This prevents privilege escalation via extra arguments like --patch
  if (policy.policyId !== 'builtin-pi-bridge') {
    const named = policy.launchShape.requiredArgs?.named;
    if (!named || Object.keys(named).length === 0) {
      return { success: false, error: 'Non-Pi policies must specify complete requiredArgs.named to prevent extra arguments' };
    }

    // Validate that only supported argument patterns are specified
    // Currently only '--profile' is supported by the matcher
    const supportedArgs = ['--profile'];
    const unsupportedArgs = Object.keys(named).filter(arg => !supportedArgs.includes(arg));
    if (unsupportedArgs.length > 0) {
      return {
        success: false,
        error: `Unsupported arguments in requiredArgs.named: ${unsupportedArgs.join(', ')}. Only ${supportedArgs.join(', ')} are supported.`
      };
    }

    // Validate --profile value must be 'acp' (the only audited profile)
    if (named['--profile'] !== 'acp') {
      return {
        success: false,
        error: `Invalid --profile value: "${named['--profile']}". Only "acp" is supported (the default audited profile).`
      };
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

  // Import the policy (transactional: memory + disk must both succeed)
  // Deep clone to prevent caller from modifying the stored policy
  const immutablePolicy = JSON.parse(JSON.stringify(policy)) as AcpStartupPolicy;
  localPolicies.set(key, immutablePolicy);

  // Persist to disk - if this fails, rollback memory change
  const persistResult = syncToStorage();
  if (!persistResult.success) {
    localPolicies.delete(key);
    return { success: false, error: `Failed to persist policy: ${persistResult.error}` };
  }

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
  // Reload from storage to get latest state (in case another process modified it)
  const reloadResult = reloadFromStorage();
  if (!reloadResult.success) {
    return { success: false, error: `Failed to reload policies before revoke: ${reloadResult.error}` };
  }

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

  // Build list of policies to revoke (don't modify memory yet)
  const toRevoke: Array<{ key: string; policy: AcpStartupPolicy }> = [];

  if (revision !== undefined) {
    // Revoke specific revision
    const key = makePolicyKey(policyId, revision);
    const policy = localPolicies.get(key);
    if (policy) {
      toRevoke.push({ key, policy });
    }
  } else {
    // Revoke all revisions of this policy
    for (const [key, policy] of localPolicies.entries()) {
      if (policy.policyId === policyId) {
        toRevoke.push({ key, policy });
      }
    }
  }

  if (toRevoke.length === 0) {
    return { success: false, error: `Policy not found: ${policyId}${revision !== undefined ? `@${revision}` : ''}` };
  }

  // Persist changes to disk FIRST (before modifying memory)
  // Temporarily remove from map to get the correct state to persist
  const removed: Array<{ key: string; policy: AcpStartupPolicy }> = [];
  for (const { key, policy } of toRevoke) {
    localPolicies.delete(key);
    removed.push({ key, policy });
  }

  const persistResult = syncToStorage();

  if (!persistResult.success) {
    // Rollback: restore all removed policies
    for (const { key, policy } of removed) {
      localPolicies.set(key, policy);
    }
    return { success: false, error: `Failed to persist revocation: ${persistResult.error}` };
  }

  // Persist succeeded - now notify listeners (memory already updated)
  for (const { policy } of toRevoke) {
    notifyPolicyChange(policy.policyId, policy.revision);
  }

  return { success: true };
}
