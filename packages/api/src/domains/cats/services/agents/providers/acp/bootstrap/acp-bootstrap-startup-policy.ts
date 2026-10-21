/**
 * ACP startup policy verification for Windows.
 *
 * This module provides the public API for verifying ACP startup commands against
 * audited policies. It replaces hardcoded build-specific constants with a
 * structured policy system.
 */

import { matchStartupPolicy } from './acp-startup-policy-matcher.js';

/**
 * Legacy type for backward compatibility.
 *
 * @deprecated Use PolicyMatchResult instead. This type will be removed in a future version.
 */
export type AuditedStartupResult = 'builtin-pi' | 'dsh-0.2.0-rc.2' | undefined;

/**
 * Verify if a startup command matches an audited policy.
 *
 * A shared volume can contain attacker-written ancestor config. This function
 * admits only audited bootstraps that have been explicitly reviewed and added
 * to the policy store.
 *
 * @param command The command to execute (may be a CLI name or path)
 * @param args Command arguments
 * @param env Environment variables (defaults to process.env)
 * @returns Legacy result for backward compatibility, or undefined if no policy matches
 */
export function auditedWindowsAcpStartup(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): AuditedStartupResult {
  const result = matchStartupPolicy(command, args, env);

  if (!result.matched) {
    return undefined;
  }

  // Map new policy IDs back to legacy string format for backward compatibility
  if (result.policyId === 'builtin-pi-bridge') {
    return 'builtin-pi';
  }

  if (result.policyId === 'dsh-0.2.0-rc.2') {
    return 'dsh-0.2.0-rc.2';
  }

  // For any future policies, return undefined to maintain strict backward compatibility
  // Callers expecting the legacy type won't get unexpected values
  return undefined;
}
