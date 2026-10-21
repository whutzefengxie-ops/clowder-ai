/**
 * ACP startup policy matcher - evaluates startup plans against policies.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCliCommandOrBare } from '../../../../../../../utils/cli-resolve.js';
import { resolveWindowsSpawnPlan } from '../../../../../../../utils/cli-spawn-win.js';
import { getActivePolicies } from './acp-startup-policy-store.js';
import type { AcpStartupPolicy, PolicyMatchResult } from './acp-startup-policy-types.js';

const PI_BRIDGE = fileURLToPath(new URL('../../pi/pi-acp-bridge.js', import.meta.url));

/**
 * Hash a file using SHA-256.
 */
function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Check if a patch file is effectively a no-op.
 */
function isNoOpPatch(path: string): boolean {
  if (!existsSync(path)) return true;
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  // A deliberately small syntax whitelist; never evaluate DSH's !!js dialect.
  if (text.length > 65536) return false;
  const tokens = text.split(/\r?\n/).filter((line) => !/^\s*(?:#.*)?$/.test(line));
  return tokens.length === 0 || (tokens.length === 1 && /^\s*\[\s*\]\s*(?:#.*)?$/.test(tokens[0] ?? ''));
}

/**
 * Get environment variable (case-insensitive on Windows).
 * Filters out empty string values to avoid false ambiguity errors.
 */
function getEnvVariable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const matches = Object.entries(env)
    .filter(([key, value]) => key.toUpperCase() === name.toUpperCase() && value !== '')
    .map(([, value]) => value);

  if (matches.length > 1) {
    throw new Error(`Ambiguous environment variable: ${name}`);
  }

  return matches[0];
}

/**
 * Match a startup command against the built-in Pi bridge policy.
 * Now checks active policies instead of bypassing the store.
 */
function matchPiBridgePolicy(
  plan: { command: string; args: string[]; shell?: true | string },
  _env: NodeJS.ProcessEnv,
): PolicyMatchResult {
  // Must be direct Node execution (no shell)
  if (plan.shell || !/^node(?:\.exe)?$/i.test(basename(plan.command))) {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  const [entry, ...rest] = plan.args;
  if (!entry || !isAbsolute(entry)) {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  // Check Pi bridge signature: must be exact match
  if (
    rest.length === 2 &&
    rest[0] === '--pi-command' &&
    rest[1] &&
    isAbsolute(rest[1])
  ) {
    try {
      // Verify it's actually the Pi bridge by realpath comparison
      if (realpathSync(entry) === realpathSync(PI_BRIDGE)) {
        // Check if Pi policy is active in the store
        const piPolicy = getActivePolicies().find((p) => p.policyId === 'builtin-pi-bridge');
        if (piPolicy) {
          return {
            matched: true,
            policyId: piPolicy.policyId,
            revision: piPolicy.revision,
            label: piPolicy.label
          };
        }
        // Policy exists but not active
        return { matched: false, reason: 'BUILD_NOT_AUDITED' };
      }
    } catch {
      return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
    }
  }

  return { matched: false, reason: 'BUILD_NOT_AUDITED' };
}

/**
 * Match a startup command against a DSH policy.
 */
function matchDshPolicy(
  policy: AcpStartupPolicy,
  plan: { command: string; args: string[]; shell?: true | string },
  env: NodeJS.ProcessEnv,
): PolicyMatchResult {
  // Must be direct Node execution (no shell)
  if (plan.shell || !/^node(?:\.exe)?$/i.test(basename(plan.command))) {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  const [entry, ...rest] = plan.args;
  if (!entry || !isAbsolute(entry)) {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  // Check required arguments - must match exactly, no extra parameters
  if (policy.launchShape.requiredArgs?.named) {
    const namedArgs = policy.launchShape.requiredArgs.named;
    if (namedArgs['--profile']) {
      // Require exact match: rest must be ['--profile', 'acp'] with no additional args
      if (
        rest.length !== 2 ||
        rest[0] !== '--profile' ||
        rest[1] !== namedArgs['--profile']
      ) {
        return { matched: false, reason: 'BUILD_NOT_AUDITED' };
      }
    }
  }

  // Check artifacts
  const entryArtifact = policy.artifacts.find((a) => a.path === 'entry');
  if (!entryArtifact) {
    return { matched: false, reason: 'BUILD_NOT_AUDITED' };
  }

  try {
    if (hashFile(entry) !== entryArtifact.sha256) {
      return { matched: false, reason: 'ARTIFACT_CHANGED' };
    }
  } catch {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  // Check additional artifacts in the same directory
  const entryDir = dirname(entry);
  for (const artifact of policy.artifacts) {
    if (artifact.path === 'entry') continue;

    try {
      let artifactPath: string;
      if (artifact.path.startsWith('@')) {
        // Module dependency
        const require = createRequire(entry);
        artifactPath = require.resolve(artifact.path);
      } else {
        // Relative file
        artifactPath = join(entryDir, artifact.path);
      }

      if (hashFile(artifactPath) !== artifact.sha256) {
        return { matched: false, reason: 'ARTIFACT_CHANGED' };
      }
    } catch {
      return { matched: false, reason: 'ARTIFACT_CHANGED' };
    }
  }

  // Check package constraints
  if (policy.packageConstraints) {
    try {
      const pkgPath = join(dirname(dirname(entry)), 'package.json');
      const manifest: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));

      if (
        !manifest ||
        typeof manifest !== 'object' ||
        !('name' in manifest) ||
        manifest.name !== policy.packageConstraints.name ||
        !('version' in manifest) ||
        manifest.version !== policy.packageConstraints.version
      ) {
        return { matched: false, reason: 'PACKAGE_MISMATCH' };
      }
    } catch {
      return { matched: false, reason: 'PACKAGE_MISMATCH' };
    }
  }

  // Check profile constraints (DSH-specific)
  if (policy.profileConstraints) {
    const configuredHome = getEnvVariable(env, 'DSH_HOME')?.trim();

    // Relative/tilde homes would resolve differently in the isolated child cwd
    if (configuredHome && !isAbsolute(configuredHome)) {
      return { matched: false, reason: 'STARTUP_ENV_UNSAFE' };
    }

    const userProfile = getEnvVariable(env, 'USERPROFILE');
    if (!configuredHome && userProfile && resolve(userProfile).toLowerCase() !== homedir().toLowerCase()) {
      return { matched: false, reason: 'STARTUP_ENV_UNSAFE' };
    }

    const home = resolve(configuredHome || join(homedir(), '.dsh'));
    const profile = join(home, 'profiles', 'acp');

    // Check patch files if noPatch is required
    if (policy.profileConstraints.noPatch) {
      if (![home, profile].every((path) => isNoOpPatch(join(path, 'cordis.patch.yml')))) {
        return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
      }
    }

    // Check profile bundles
    if (!existsSync(join(profile, 'package.json'))) {
      // Empty profile - check if allowed
      if (!policy.profileConstraints.allowEmpty) {
        return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
      }
      // Empty or nonexistent is OK
      if (!existsSync(profile) || readdirSync(profile).length === 0) {
        // OK
      } else {
        return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
      }
    } else {
      // Profile exists - check bundles
      try {
        const config: unknown = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));

        if (
          !config ||
          typeof config !== 'object' ||
          !('dsh' in config) ||
          !config.dsh ||
          typeof config.dsh !== 'object' ||
          !('profile' in config.dsh) ||
          !config.dsh.profile ||
          typeof config.dsh.profile !== 'object' ||
          !('bundles' in config.dsh.profile)
        ) {
          return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
        }

        const actualBundles = JSON.stringify(config.dsh.profile.bundles);
        const allowed = policy.profileConstraints.allowedBundles || [];
        const matches = allowed.some((b) => JSON.stringify(b) === actualBundles);

        if (!matches) {
          return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
        }
      } catch {
        return { matched: false, reason: 'PROFILE_UNSUPPORTED' };
      }
    }
  }

  return { matched: true, policyId: policy.policyId, revision: policy.revision, label: policy.label };
}

/**
 * Match a startup command against all active policies.
 *
 * @param command The command to execute (may be a CLI name or path)
 * @param args Command arguments
 * @param env Environment variables
 * @returns Policy match result
 */
export function matchStartupPolicy(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): PolicyMatchResult {
  if (process.platform !== 'win32') {
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }

  try {
    // Check forbidden environment variables (environment ambiguity is caught here)
    if (getEnvVariable(env, 'NODE_OPTIONS') || getEnvVariable(env, 'NODE_PATH')) {
      return { matched: false, reason: 'STARTUP_ENV_UNSAFE' };
    }

    // Resolve the spawn plan
    const plan = resolveWindowsSpawnPlan(resolveCliCommandOrBare(command), args);

    // Try Pi bridge first (most specific)
    const piResult = matchPiBridgePolicy(plan, env);
    if (piResult.matched) {
      return piResult;
    }

    // Try all non-Pi policies (not just those starting with 'dsh-')
    // This ensures imported policies with any policyId are considered
    const policies = getActivePolicies().filter((p) => p.policyId !== 'builtin-pi-bridge');
    for (const policy of policies) {
      const result = matchDshPolicy(policy, plan, env);
      if (result.matched) {
        return result;
      }
    }

    // No policy matched
    return { matched: false, reason: 'BUILD_NOT_AUDITED' };
  } catch (error) {
    // Environment ambiguity or other errors should return structured rejection
    if (error instanceof Error && error.message.includes('Ambiguous environment variable')) {
      return { matched: false, reason: 'STARTUP_ENV_UNSAFE' };
    }
    return { matched: false, reason: 'LAUNCH_UNRESOLVED' };
  }
}
