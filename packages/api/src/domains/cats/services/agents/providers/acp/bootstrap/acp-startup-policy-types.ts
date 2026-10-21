/**
 * Structured ACP startup policy types for Windows bootstrap auditing.
 *
 * This module defines the schema for audited ACP startup policies that replace
 * hardcoded build-specific constants. Policies are externalized data records
 * that must be explicitly imported after security review.
 */

/**
 * Artifact file with integrity hash.
 */
export interface PolicyArtifact {
  /** Relative path from the package root or module identifier */
  path: string;
  /** SHA-256 hash of the file content */
  sha256: string;
}

/**
 * Launch shape constraints - what invocation patterns are permitted.
 */
export interface LaunchShape {
  /** Entry point must match this pattern (e.g., 'node + absolute entry') */
  entryPattern: 'node-absolute' | 'node-resolved-shim';
  /** Required arguments structure */
  requiredArgs?: {
    /** Fixed positional arguments */
    fixed?: string[];
    /** Named argument requirements (e.g., '--profile': 'acp') */
    named?: Record<string, string>;
  };
  /** Forbidden environment variables */
  forbiddenEnv?: string[];
}

/**
 * Profile constraints - what DSH profile configurations are allowed.
 */
export interface ProfileConstraints {
  /** Allowed bundle list (exact match) */
  allowedBundles?: string[][];
  /** Whether empty/default profile is permitted */
  allowEmpty?: boolean;
  /** Whether custom patches are forbidden */
  noPatch?: boolean;
}

/**
 * A single audited ACP startup policy record.
 */
export interface AcpStartupPolicy {
  /** Schema version for future evolution */
  schemaVersion: 1;

  /** Stable policy identifier */
  policyId: string;

  /** Policy revision number (increment on modification) */
  revision: number;

  /** Human-readable label */
  label: string;

  /** Provenance: who audited, when, and based on what evidence */
  provenance: {
    /** Reviewer identifier */
    reviewer: string;
    /** Audit date (ISO 8601) */
    auditDate: string;
    /** Evidence reference (e.g., PR URL, internal ticket) */
    evidenceRef: string;
  };

  /** Launch shape constraints */
  launchShape: LaunchShape;

  /** Core artifacts that must match */
  artifacts: PolicyArtifact[];

  /** Profile constraints (for DSH-like providers) */
  profileConstraints?: ProfileConstraints;

  /** Package manifest constraints */
  packageConstraints?: {
    /** Required package name */
    name: string;
    /** Required version (exact match) */
    version: string;
  };

  /** What this policy guarantees about startup behavior */
  assurance: string;
}

/**
 * Result of policy matching.
 */
export type PolicyMatchResult =
  | { matched: true; policyId: string; revision: number; label: string }
  | { matched: false; reason: PolicyMatchFailureReason };

/**
 * Structured reasons for policy match failure.
 */
export type PolicyMatchFailureReason =
  | 'LAUNCH_UNRESOLVED'
  | 'SHELL_WRAPPER_UNSUPPORTED'
  | 'BUILD_NOT_AUDITED'
  | 'ARTIFACT_CHANGED'
  | 'PROFILE_UNSUPPORTED'
  | 'STARTUP_ENV_UNSAFE'
  | 'PACKAGE_MISMATCH';
