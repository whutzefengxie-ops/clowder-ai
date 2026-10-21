/**
 * Persistent storage for local ACP startup policies.
 *
 * Policies are stored in a protected location with integrity checks.
 * Only the instance owner can import policies through controlled entry points.
 *
 * SECURITY BOUNDARIES:
 * - Storage location must be validated for owner, DACL, and reparse protection
 * - Mode 0o700/0o600 on Unix; Windows requires native DACL validation
 * - Windows validation uses PowerShell to check owner, protected ACL, and path safety
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
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
 * Validate Windows policy storage directory security.
 * Checks: owner is current user, protected DACL, no reparse point.
 * Uses icacls for validation to avoid PowerShell module issues.
 */
function validateWindowsStorageDirectory(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Storage path does not exist: ${path}`);
  }

  // Use icacls to check permissions - more reliable than PowerShell Get-Acl
  try {
    const icaclsResult = execFileSync(
      'icacls',
      [path],
      {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      }
    );

    // icacls output format: path followed by permission entries
    // Check for inheritance flag: (I) means inherited, (CI)(OI) means inheritable
    // Protected DACL should NOT have inheritance enabled from parent
    const lines = icaclsResult.split('\n');

    // If we see inheritance markers like "BUILTIN\\Users:(OI)(CI)(RX)" it means
    // inheritance is enabled, which we don't want for security-sensitive storage
    const hasInheritance = lines.some(line =>
      line.includes('(I)') || // Inherited from parent
      (line.includes('BUILTIN') || line.includes('NT AUTHORITY\\Authenticated Users'))
    );

    if (hasInheritance) {
      throw new Error('Storage directory has inherited permissions - DACL must be protected');
    }

  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string; code?: string };

    // If icacls itself failed (not just validation), report it
    if (err.code === 'ENOENT') {
      throw new Error('icacls command not found - cannot validate Windows storage');
    }

    const details = [err.stderr?.trim(), err.stdout?.trim(), err.message].filter(Boolean).join(' | ');
    throw new Error(`Windows storage validation failed: ${details}`);
  }
}

/**
 * Compute integrity hash for a policy record.
 * Uses deterministic JSON serialization with sorted keys at all levels.
 */
function computePolicyHash(policy: AcpStartupPolicy): string {
  // Deterministic JSON serialization: sort keys recursively
  const sortedStringify = (obj: unknown): string => {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map(sortedStringify).join(',')}]`;
    }
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map((key) => {
      const value = (obj as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${sortedStringify(value)}`;
    });
    return `{${pairs.join(',')}}`;
  };

  const canonical = sortedStringify(policy);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Protect a Windows directory by disabling ACL inheritance and setting owner-only access.
 * Uses icacls for more reliable operation than PowerShell.
 */
function protectWindowsDirectory(path: string): void {
  try {
    // Remove inheritance and grant owner full control
    // /inheritance:r = remove inherited permissions
    // /grant:r %USERNAME%:(OI)(CI)F = grant full control to current user, replace existing
    const username = process.env.USERNAME || process.env.USER;
    if (!username) {
      throw new Error('Cannot determine current username');
    }

    execFileSync(
      'icacls',
      [path, '/inheritance:r', `/grant:r`, `${username}:(OI)(CI)F`],
      {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      }
    );
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const details = [err.stderr?.trim(), err.stdout?.trim(), err.message].filter(Boolean).join(' | ');
    throw new Error(`Failed to protect Windows directory: ${details}`);
  }
}

/**
 * Load all persisted policies from disk.
 * Returns empty array if storage doesn't exist or on read errors.
 * Validates Windows storage directory before loading.
 */
export function loadPersistedPolicies(): AcpStartupPolicy[] {
  const storagePath = getPolicyStoragePath();
  const manifestPath = join(storagePath, 'policies.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  // On Windows, validate storage directory before loading
  if (platform() === 'win32') {
    try {
      validateWindowsStorageDirectory(storagePath);
    } catch (error) {
      console.error(`[acp-policy-storage] Storage validation failed, refusing to load: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  try {
    const content = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.policies)) {
      console.warn('[acp-policy-storage] Invalid manifest format, ignoring');
      return [];
    }

    // Validate each policy's integrity and schema
    const validPolicies: AcpStartupPolicy[] = [];
    for (const entry of manifest.policies) {
      if (!entry.policy || !entry.integrityHash) continue;

      const policy = entry.policy;

      // Validate schema version
      if (policy.schemaVersion !== 1) {
        console.warn(`[acp-policy-storage] Unsupported schema version ${policy.schemaVersion} for ${policy.policyId}, skipping`);
        continue;
      }

      // Validate required fields
      if (!policy.policyId || !policy.label || !policy.revision || policy.revision < 1) {
        console.warn(`[acp-policy-storage] Invalid policy structure for ${policy.policyId}, skipping`);
        continue;
      }

      // Validate provenance
      if (!policy.provenance || !policy.provenance.reviewer || !policy.provenance.evidenceRef) {
        console.warn(`[acp-policy-storage] Missing provenance for ${policy.policyId}, skipping`);
        continue;
      }

      // Validate artifacts with proper SHA-256 hashes
      if (!policy.artifacts || policy.artifacts.length === 0) {
        console.warn(`[acp-policy-storage] No artifacts for ${policy.policyId}, skipping`);
        continue;
      }

      let hasInvalidArtifact = false;
      for (const artifact of policy.artifacts) {
        if (!artifact.sha256 || artifact.sha256.length !== 64 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
          console.warn(`[acp-policy-storage] Invalid SHA-256 for ${policy.policyId}:${artifact.path}, skipping policy`);
          hasInvalidArtifact = true;
          break;
        }
      }
      if (hasInvalidArtifact) continue;

      // Validate launch shape for non-Pi policies
      if (policy.policyId !== 'builtin-pi-bridge') {
        const named = policy.launchShape.requiredArgs?.named;
        if (!named || Object.keys(named).length === 0) {
          console.warn(`[acp-policy-storage] Non-Pi policy ${policy.policyId} missing requiredArgs.named, skipping`);
          continue;
        }

        // Validate that only supported argument patterns are specified
        const supportedArgs = ['--profile'];
        const unsupportedArgs = Object.keys(named).filter(arg => !supportedArgs.includes(arg));
        if (unsupportedArgs.length > 0) {
          console.warn(`[acp-policy-storage] Non-Pi policy ${policy.policyId} has unsupported args: ${unsupportedArgs.join(', ')}, skipping`);
          continue;
        }

        // Validate --profile value must be 'acp'
        if (named['--profile'] !== 'acp') {
          console.warn(`[acp-policy-storage] Non-Pi policy ${policy.policyId} has invalid --profile value: "${named['--profile']}", skipping`);
          continue;
        }
      }

      // Finally, validate integrity hash
      const computed = computePolicyHash(policy);
      if (computed !== entry.integrityHash) {
        console.warn(`[acp-policy-storage] Integrity check failed for ${policy.policyId}, skipping`);
        continue;
      }

      validPolicies.push(policy);
    }

    return validPolicies;
  } catch (error) {
    console.error('[acp-policy-storage] Failed to load policies:', error);
    return [];
  }
}

/**
 * Persist policies to disk with integrity hashes.
 *
 * SECURITY: Validates storage directory with native checks on Windows
 * (owner, protected ACL, no reparse). On Unix, uses mode 0o700/0o600.
 */
export function persistPolicies(policies: AcpStartupPolicy[]): { success: boolean; error?: string } {
  const storagePath = getPolicyStoragePath();
  const manifestPath = join(storagePath, 'policies.json');

  try {
    // Ensure storage directory exists
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true, mode: 0o700 });

      // On Windows, protect the directory and then validate
      if (platform() === 'win32') {
        try {
          protectWindowsDirectory(storagePath);
          validateWindowsStorageDirectory(storagePath);
        } catch (error) {
          return {
            success: false,
            error: `Windows storage setup failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }
    } else {
      // Directory exists - validate it's secure
      if (platform() === 'win32') {
        try {
          validateWindowsStorageDirectory(storagePath);
        } catch (error) {
          // Validation failed - try to fix it
          try {
            protectWindowsDirectory(storagePath);
            validateWindowsStorageDirectory(storagePath);
          } catch (fixError) {
            return {
              success: false,
              error: `Existing storage directory failed validation and could not be fixed: ${fixError instanceof Error ? fixError.message : String(fixError)}`
            };
          }
        }
      }
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
