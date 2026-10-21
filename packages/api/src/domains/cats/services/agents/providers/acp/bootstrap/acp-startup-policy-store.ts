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
 * These are stored separately from builtin policies and can be revoked.
 * Currently stubbed - W2 will implement the controlled import mechanism.
 */
const localPolicies: AcpStartupPolicy[] = [];

/**
 * Get all active policies (builtin + local).
 */
export function getActivePolicies(): ReadonlyArray<AcpStartupPolicy> {
  return [...BUILTIN_POLICIES, ...localPolicies];
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
 * W2 TODO: Implement controlled policy import.
 *
 * This function will:
 * 1. Validate the policy structure
 * 2. Check for conflicts with existing policies
 * 3. Verify storage location integrity
 * 4. Persist the policy securely
 *
 * Policies must NOT be auto-trusted based on:
 * - Project files
 * - Agent output
 * - Package self-declarations
 * - Provenance strings alone
 */
export function importPolicy(_policy: AcpStartupPolicy): { success: boolean; error?: string } {
  // Stubbed for W1 - will implement in W2
  return { success: false, error: 'Policy import not yet implemented (W2)' };
}

/**
 * W2 TODO: Implement policy revocation.
 *
 * Revoking a policy must:
 * 1. Remove it from the active set
 * 2. Trigger pool invalidation for affected signatures
 * 3. Fail new spawn attempts using the revoked policy
 */
export function revokePolicy(_policyId: string, _revision?: number): { success: boolean; error?: string } {
  // Stubbed for W1 - will implement in W2
  return { success: false, error: 'Policy revocation not yet implemented (W2)' };
}
