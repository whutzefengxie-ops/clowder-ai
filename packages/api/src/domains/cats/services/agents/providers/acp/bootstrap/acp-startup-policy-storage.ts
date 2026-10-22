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

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AcpStartupPolicy } from './acp-startup-policy-types.js';
import { ensureWindowsAcpBootstrapDirectories } from '../acp-bootstrap-windows-directory.js';

/**
 * PowerShell script to create a file with secure Windows ACL.
 * Sets owner to current user and protected DACL (no inheritance).
 * Content is passed via stdin and written atomically.
 */
const CREATE_SECURE_FILE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $filePath = $request.filePath
  $content = $request.content

  # Check if file already exists
  if ([System.IO.File]::Exists($filePath)) {
    throw "File already exists: $filePath"
  }

  $sidType = [System.Security.Principal.SecurityIdentifier]
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $full = [System.Security.AccessControl.FileSystemRights]::FullControl

  # Create file security descriptor with owner and protected DACL
  $security = [System.Security.AccessControl.FileSecurity]::new()
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true, $false)

  # Grant full control to current user only
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $user, $full,
    [System.Security.AccessControl.InheritanceFlags]::None,
    [System.Security.AccessControl.PropagationFlags]::None, $allow)
  $security.AddAccessRule($rule)

  # Write content with secure ACL
  # Use FileStream with correct constructor signature for FileSecurity
  # Signature: (String, FileMode, FileSystemRights, FileShare, Int32, FileOptions, FileSecurity)
  $mode = [System.IO.FileMode]::CreateNew
  $share = [System.IO.FileShare]::None
  $options = [System.IO.FileOptions]::None
  $fs = [System.IO.FileStream]::new($filePath, $mode, $full, $share, 4096, $options, $security)
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
    $fs.Write($bytes, 0, $bytes.Length)
    $fs.Flush()
  } finally {
    $fs.Close()
  }

  [Console]::Out.Write('secure-file-created')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/**
 * Create a file with secure Windows ACL (owner + protected DACL).
 * On Windows, uses PowerShell + .NET to set security during creation.
 * On Unix, uses fs with mode 0o600.
 */
function createSecureFile(filePath: string, content: string): { success: boolean; error?: string } {
  if (platform() === 'win32') {
    try {
      const powershell = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );

      const output = execFileSync(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(CREATE_SECURE_FILE_SCRIPT, 'utf16le').toString('base64'),
        ],
        {
          env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH')),
          input: JSON.stringify({ filePath, content }),
          encoding: 'utf8',
          timeout: 10_000,
          maxBuffer: 256 * 1024,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );

      if (output.trim() !== 'secure-file-created') {
        return { success: false, error: 'Secure file creation did not return expected receipt' };
      }

      return { success: true };
    } catch (error: unknown) {
      const err = error as { stderr?: string; message?: string; code?: string };
      if (err.code === 'EEXIST') {
        return { success: false, error: 'File already exists' };
      }
      const errorMsg = err.stderr?.trim() || err.message || String(error);
      return { success: false, error: `Failed to create secure file: ${errorMsg}` };
    }
  } else {
    // Unix: use standard fs with mode 0o600
    try {
      writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return { success: true };
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'EEXIST') {
        return { success: false, error: 'File already exists' };
      }
      return { success: false, error: `Failed to create file: ${err.message || String(error)}` };
    }
  }
}

/**
 * PowerShell script to validate a file's security on Windows.
 * Checks: owner, protected DACL, no untrusted principals, no reparse point.
 * Similar to directory validation but uses File.GetAccessControl.
 */
const VALIDATE_FILE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $filePath = $request.filePath

  $sidType = [System.Security.Principal.SecurityIdentifier]
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $trusted = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  $full = [System.Security.AccessControl.FileSystemRights]::FullControl

  # Check if file exists and is not a reparse point
  if (-not [System.IO.File]::Exists($filePath)) {
    throw "File does not exist: $filePath"
  }

  $attributes = [System.IO.File]::GetAttributes($filePath)
  if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'File must not be a symlink or reparse point'
  }
  if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
    throw 'Path must be a file, not a directory'
  }

  # Get file ACL and validate
  $acl = [System.IO.File]::GetAccessControl($filePath)

  # Check owner
  if ($acl.GetOwner($sidType).Value -ne $user.Value) {
    throw "File has untrusted owner: $($acl.GetOwner($sidType).Value)"
  }

  # Check protected DACL
  if (-not $acl.AreAccessRulesProtected) {
    throw 'File must have a protected private DACL (no inheritance)'
  }

  # Validate access rules
  $userFullControl = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, $sidType)) {
    if ($rule.AccessControlType -eq $allow) {
      if ($trusted -notcontains $rule.IdentityReference.Value) {
        throw "File has unsafe Allow ACL for: $($rule.IdentityReference.Value)"
      }
      if ($rule.IdentityReference.Value -eq $user.Value -and
          ($rule.FileSystemRights -band $full) -eq $full) {
        $userFullControl = $true
      }
    } else {
      throw 'File has unsupported Deny ACL'
    }
  }

  if (-not $userFullControl) {
    throw 'File lacks owner FullControl'
  }

  [Console]::Out.Write('file-validation-ok')
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/**
 * Validate file security on Windows using native .NET APIs.
 * Checks owner, protected DACL, no untrusted principals, no reparse.
 */
function validateWindowsFileSecurity(filePath: string): { success: boolean; error?: string } {
  if (!existsSync(filePath)) {
    return { success: false, error: `File does not exist: ${filePath}` };
  }

  try {
    const powershell = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );

    const output = execFileSync(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(VALIDATE_FILE_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH')),
        input: JSON.stringify({ filePath }),
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    if (output.trim() !== 'file-validation-ok') {
      return { success: false, error: 'File validation did not return expected receipt' };
    }

    return { success: true };
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const errorMsg = err.stderr?.trim() || err.message || String(error);
    return { success: false, error: `Windows file validation failed: ${errorMsg}` };
  }
}

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
/**
 * Validate file security (symlink check + Windows native ACL validation).
 *
 * On Windows, performs native validation:
 * - File must be owned by current user
 * - File must have protected DACL (no inheritance)
 * - Only trusted principals (owner, SYSTEM, Administrators) can have access
 * - File must not be a reparse point
 *
 * On Unix, checks symlink only (relies on directory mode for inheritance).
 */
function validateFileNotSymlink(filePath: string): { success: boolean; error?: string } {
  if (!existsSync(filePath)) {
    return { success: true }; // File doesn't exist yet - OK for creation
  }

  try {
    const stats = lstatSync(filePath);

    // Check if it's a symlink (all platforms)
    if (stats.isSymbolicLink()) {
      return { success: false, error: `File is a symbolic link: ${filePath}` };
    }

    // On Windows, perform native ACL validation
    if (platform() === 'win32') {
      return validateWindowsFileSecurity(filePath);
    }

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

    // Use secure file creation to set proper owner/DACL on Windows
    // On Windows: PowerShell + .NET sets owner to current user + protected DACL
    // On Unix: standard fs with mode 0o600 + exclusive flag
    const manifestContent = JSON.stringify(manifest, null, 2);
    const createResult = createSecureFile(tempPath, manifestContent);
    if (!createResult.success) {
      return {
        success: false,
        error: `Failed to create tmp file: ${createResult.error}`
      };
    }

    // Validate the newly created tmp file before proceeding
    // This ensures the file meets security requirements (owner, protected DACL, no reparse)
    const tmpValidation = validateFileNotSymlink(tempPath);
    if (!tmpValidation.success) {
      // Clean up the tmp file we just created
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      return {
        success: false,
        error: `Created tmp file failed validation: ${tmpValidation.error}`
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
