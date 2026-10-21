/**
 * Persistent storage for local ACP startup policies.
 *
 * Policies are stored in a protected location with integrity checks.
 * Only the instance owner can import policies through controlled entry points.
 *
 * SECURITY BOUNDARIES:
 * - Storage location must be validated for owner, DACL, and reparse protection
 * - Mode 0o700/0o600 on Unix; Windows requires native DACL validation
 * - Windows validation uses native .NET APIs via PowerShell to check owner, protected ACL, SID-based rights
 * - Existing directories with invalid ACLs are REJECTED, not auto-repaired
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AcpStartupPolicy } from './acp-startup-policy-types.js';
import { ensureWindowsAcpBootstrapDirectories } from '../acp-bootstrap-windows-directory.js';

/**
 * Validate that a file is not a symlink/reparse point and check ACL on Windows.
 *
 * LIMITATION: Full file owner/DACL validation requires native Windows APIs.
 * Current implementation checks symlink and will be extended with native validation.
 *
 * For now, we rely on:
 * 1. Symlink detection via lstatSync()
 * 2. Exclusive file creation (wx mode) to prevent following existing symlinks
 * 3. Directory protection inheritance via (OI)(CI) flags for newly created files
 */
function validateFileNotSymlink(filePath: string): { success: boolean; error?: string } {
  if (!existsSync(filePath)) {
    return { success: true }; // File doesn't exist yet - OK for creation
  }

  try {
    const stats = lstatSync(filePath);

    // Check if it's a symlink
    if (stats.isSymbolicLink()) {
      return { success: false, error: `File is a symbolic link: ${filePath}` };
    }

    // TODO: Add native Windows file ACL validation here
    // Should check: owner is current user, protected DACL, no untrusted principals
    // This would require extending the PowerShell validation script

    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string };
    return { success: false, error: `Failed to validate file: ${err.message || String(error)}` };
  }
}

/**
 * Storage location for local policies.
 * Located in user's home directory, outside project trees.
 */
function getPolicyStoragePath(): string {
  return join(homedir(), '.clowder-ai', 'acp-policies');
}

/**
 * Validate Windows policy storage directory security using native .NET validation.
 *
 * Uses the existing ensureWindowsAcpBootstrapDirectories which performs:
 * - Owner check (must be current user)
 * - Protected DACL (no inheritance)
 * - SID-based rights validation (no untrusted principals with elevated rights)
 * - Reparse point detection
 * - Ancestor safety checks
 *
 * This function ONLY validates existing directories. It does NOT create or modify ACLs.
 * If validation fails, the directory must be rejected.
 */
function validateWindowsStorageDirectory(path: string): { success: boolean; error?: string } {
  if (!existsSync(path)) {
    return { success: false, error: `Storage path does not exist: ${path}` };
  }

  try {
    // Use the existing native validation.
    // We pass the same path for both root and cwd since we're validating a single directory.
    // allowVolumeRootDelete is false - policy storage has no special volume root exception.
    ensureWindowsAcpBootstrapDirectories(path, path, { allowVolumeRootDelete: false });
    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    return {
      success: false,
      error: `Windows storage validation failed: ${err.message || String(error)}`
    };
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
 * Load all persisted policies from disk.
 * Returns empty array if storage doesn't exist or on read errors.
 * Validates Windows storage directory before loading - REJECTS invalid directories, does not auto-repair.
 * Also validates that manifest file is not a symlink/reparse point.
 */
export function loadPersistedPolicies(): AcpStartupPolicy[] {
  const storagePath = getPolicyStoragePath();
  const manifestPath = join(storagePath, 'policies.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  // On Windows, validate storage directory before loading
  // SECURITY: Invalid directories are REJECTED, not auto-repaired
  if (platform() === 'win32') {
    const validationResult = validateWindowsStorageDirectory(storagePath);
    if (!validationResult.success) {
      console.error(`[acp-policy-storage] Storage validation failed, refusing to load: ${validationResult.error}`);
      return [];
    }
  }

  // Validate that manifest file is not a symlink/reparse point
  const fileValidation = validateFileNotSymlink(manifestPath);
  if (!fileValidation.success) {
    console.error(`[acp-policy-storage] Manifest file validation failed, refusing to load: ${fileValidation.error}`);
    return [];
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
 * SECURITY:
 * - On Windows, validates storage directory with native .NET checks (owner, protected DACL, SID-based rights, no reparse)
 * - Existing directories with invalid ACLs are REJECTED, not auto-repaired
 * - New directories are created with proper security via ensureWindowsAcpBootstrapDirectories
 * - Parent directories (.clowder-ai) are created first to satisfy helper's immediate-parent requirement
 * - On Unix, uses mode 0o700/0o600
 */
export function persistPolicies(policies: AcpStartupPolicy[]): { success: boolean; error?: string } {
  const storagePath = getPolicyStoragePath(); // HOME/.clowder-ai/acp-policies
  const manifestPath = join(storagePath, 'policies.json');

  try {
    // Ensure storage directory exists with proper security
    if (!existsSync(storagePath)) {
      if (platform() === 'win32') {
        // On Windows, use native creation with protected DACL
        // ensureWindowsAcpBootstrapDirectories requires immediate parent to exist
        // So we need to create .clowder-ai first, then acp-policies
        const parentDir = join(homedir(), '.clowder-ai');

        try {
          // Create parent directory if it doesn't exist
          if (!existsSync(parentDir)) {
            ensureWindowsAcpBootstrapDirectories(parentDir, parentDir, { allowVolumeRootDelete: false });
          } else {
            // Validate existing parent
            const parentValidation = validateWindowsStorageDirectory(parentDir);
            if (!parentValidation.success) {
              return {
                success: false,
                error: `Parent directory failed validation: ${parentValidation.error}`
              };
            }
          }

          // Now create acp-policies subdirectory (parent exists)
          ensureWindowsAcpBootstrapDirectories(storagePath, storagePath, { allowVolumeRootDelete: false });
        } catch (error) {
          return {
            success: false,
            error: `Failed to create Windows storage directory: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      } else {
        // On Unix, create with mode 0o700 (recursive handles parent)
        mkdirSync(storagePath, { recursive: true, mode: 0o700 });
      }
    } else {
      // Directory exists - validate it's secure (REJECT if invalid, do NOT auto-repair)
      if (platform() === 'win32') {
        const validationResult = validateWindowsStorageDirectory(storagePath);
        if (!validationResult.success) {
          return {
            success: false,
            error: `Existing storage directory failed validation (refusing to auto-repair): ${validationResult.error}`
          };
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

    // SECURITY: Validate tmp/backup file paths before writing
    // Prevent writing through symlinks to files outside the storage directory
    const tempPath = `${manifestPath}.tmp`;
    const backupPath = `${manifestPath}.bak`;

    // Check if tmp path is a symlink (including dangling symlinks)
    // Use lstatSync() which does NOT follow symlinks, unlike existsSync()
    try {
      const tmpStats = lstatSync(tempPath);
      if (tmpStats.isSymbolicLink()) {
        return {
          success: false,
          error: 'Refusing to write through tmp symlink (existing target)'
        };
      }
      // Tmp file exists and is not a symlink - remove it for clean state
      unlinkSync(tempPath);
    } catch (error: unknown) {
      const err = error as { code?: string };
      // ENOENT = file doesn't exist, which is OK for creation
      // Any other error should be reported
      if (err.code !== 'ENOENT') {
        return {
          success: false,
          error: `Failed to check tmp file: ${error}`
        };
      }
      // File doesn't exist - OK to create
    }

    // Use exclusive creation (wx flag) to prevent following symlinks
    // wx = open for writing, fail if file exists (atomic, doesn't follow symlinks)
    // This prevents: 1) following dangling symlinks to create files outside storage
    //                2) race conditions between check and write
    try {
      writeFileSync(tempPath, JSON.stringify(manifest, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx' // Exclusive creation - fail if file exists, don't follow symlinks
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'EEXIST') {
        return {
          success: false,
          error: 'Tmp file appeared between check and write (possible race or symlink)'
        };
      }
      return {
        success: false,
        error: `Failed to write tmp file: ${err.message || String(error)}`
      };
    }

    // Backup existing manifest if present
    if (existsSync(manifestPath)) {
      // Validate manifest before backing it up
      const manifestValidation = validateFileNotSymlink(manifestPath);
      if (!manifestValidation.success) {
        // Clean up the tmp file we just created
        try {
          unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
        return {
          success: false,
          error: `Existing manifest failed validation: ${manifestValidation.error}`
        };
      }

      // Remove old backup if exists
      if (existsSync(backupPath)) {
        const backupValidation = validateFileNotSymlink(backupPath);
        if (!backupValidation.success) {
          // Clean up the tmp file
          try {
            unlinkSync(tempPath);
          } catch {
            // Ignore
          }
          return {
            success: false,
            error: `Existing backup failed validation: ${backupValidation.error}`
          };
        }

        try {
          unlinkSync(backupPath);
        } catch {
          // Ignore - backup removal is not critical
        }
      }

      // Move current manifest to backup
      renameSync(manifestPath, backupPath);
    }

    // Move tmp to manifest
    renameSync(tempPath, manifestPath);

    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to persist policies: ${error}` };
  }
}
