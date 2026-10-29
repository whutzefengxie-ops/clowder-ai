/**
 * W3: native-fragment decision for one Host session (#1647).
 *
 * Pure projection of §7's change matrix. It never performs an update: it only
 * says which action the caller is allowed to take, and why. In particular an
 * in-place identity update may only be *attempted* when the adapter declares a
 * verified in-place update capability AND the Host holds adoption evidence that
 * covers the exact instructions now in force. Without that evidence the only
 * honest outcome is a new native fragment (C10).
 *
 * Display-only changes (avatar/colour and unrelated catalog fields) never enter
 * the compatibility structure at all, so they arrive here as an empty change
 * list and decide `reuse`.
 *
 * Internal / unstable.
 */
import type { IdentityAdoptionArtifact } from '@cat-cafe/shared';
import { COMPATIBILITY_FIELDS } from './compatibility-key.js';
import type { CompatibilityField } from './compatibility-key.js';

export type FragmentAction = 'reuse' | 'in_place_update' | 'new_fragment';

export type FragmentReason =
  | 'no_structural_change'
  | 'unverifiable_structure'
  | 'requested_new_fragment'
  | 'hard_boundary_changed'
  | 'implementation_generation_changed'
  | 'identity_update_verified'
  | 'identity_update_unverified'
  | 'adoption_artifact_missing'
  | 'adoption_artifact_stale'
  | 'model_update_verified'
  | 'model_update_unverified'
  | 'permission_update_verified'
  | 'permission_update_unverified'
  | 'mcp_update_verified'
  | 'mcp_update_unverified'
  | 'launch_config_changed';

/**
 * Structural fields where reuse across the change is never safe, whatever the
 * adapter claims. Account/HOME/workspace/implementation boundaries are hard
 * separations, not dynamic update candidates.
 */
export const HARD_BOUNDARY_FIELDS: readonly CompatibilityField[] = [
  'clientId',
  'carrier',
  'implementation',
  'accountRef',
  'nativeHome',
  'nativeStateRoot',
  'workspaceRoot',
  'workspaceFingerprint',
];

/** Change classes whose action depends on a declared, verified update capability. */
export type FragmentUpdateCapabilities = {
  readonly identityUpdate: 'in_place_verified' | 'in_place_unverified' | 'new_fragment_only';
  readonly modelUpdate?: 'verified' | 'unverified' | 'unsupported';
  readonly permissionUpdate?: 'verified_dynamic' | 'unsupported';
  readonly mcpUpdate?: 'verified_dynamic' | 'unsupported';
};

export interface FragmentRequest {
  /** Caller preference; `auto` (default) follows the change matrix. */
  readonly preference?: 'auto' | 'reuse' | 'in_place_update' | 'new_fragment';
  /** instructionDigest the native fragment must reflect after this change. */
  readonly instructionDigest?: string;
  /** Persisted evidence that this exact instruction set was adopted in place. */
  readonly identityArtifact?: IdentityAdoptionArtifact;
}

export interface FragmentDecisionInput {
  /**
   * Changed structural fields from `compareCompatibility`. `'unverifiable'`
   * covers legacy/missing persisted keys and must never yield reuse.
   */
  readonly changed: readonly CompatibilityField[] | 'unverifiable';
  readonly capabilities: FragmentUpdateCapabilities;
  readonly requested?: FragmentRequest;
}

export interface FragmentDecision {
  readonly action: FragmentAction;
  /** Machine-readable reason, stable enough to persist in `fragmentSwitch`. */
  readonly reason: FragmentReason;
  /**
   * True whenever the action is `in_place_update`: the caller must not claim
   * the update applied until adoption evidence is verified and persisted.
   */
  readonly requiresVerifiedAdoption: boolean;
}

const IDENTITY_CHANGE: CompatibilityField = 'instructionDigest';

/** Reject any value that is not a declared structural field (forward-compat input). */
export function sanitizeChangedFields(changed: readonly string[] | 'unverifiable'): readonly CompatibilityField[] | 'unverifiable' {
  if (changed === 'unverifiable') return changed;
  const declared = new Set<string>(COMPATIBILITY_FIELDS);
  return changed.filter((field): field is CompatibilityField => declared.has(field));
}

function result(action: FragmentAction, reason: FragmentReason): FragmentDecision {
  return { action, reason, requiresVerifiedAdoption: action === 'in_place_update' };
}

function decideHardBoundary(changed: ReadonlySet<CompatibilityField>): FragmentDecision | undefined {
  if (changed.has('implementationGeneration')) return result('new_fragment', 'implementation_generation_changed');
  if (changed.has('launchConfigDigest')) return result('new_fragment', 'launch_config_changed');
  if (HARD_BOUNDARY_FIELDS.some((field) => changed.has(field))) return result('new_fragment', 'hard_boundary_changed');
  return undefined;
}

function decidePermission(
  changed: ReadonlySet<CompatibilityField>,
  capabilities: FragmentUpdateCapabilities,
): FragmentDecision | undefined {
  if (!changed.has('permissionMode')) return undefined;
  return capabilities.permissionUpdate === 'verified_dynamic'
    ? result('in_place_update', 'permission_update_verified')
    : result('new_fragment', 'permission_update_unverified');
}

function decideMcp(
  changed: ReadonlySet<CompatibilityField>,
  capabilities: FragmentUpdateCapabilities,
): FragmentDecision | undefined {
  if (!changed.has('mcpSurfaceDigest')) return undefined;
  return capabilities.mcpUpdate === 'verified_dynamic'
    ? result('in_place_update', 'mcp_update_verified')
    : result('new_fragment', 'mcp_update_unverified');
}

function decideModel(
  changed: ReadonlySet<CompatibilityField>,
  capabilities: FragmentUpdateCapabilities,
): FragmentDecision | undefined {
  if (!changed.has('model') && !changed.has('effort')) return undefined;
  return capabilities.modelUpdate === 'verified'
    ? result('in_place_update', 'model_update_verified')
    : result('new_fragment', 'model_update_unverified');
}

function decideIdentity(
  changed: ReadonlySet<CompatibilityField>,
  capabilities: FragmentUpdateCapabilities,
  requested: FragmentRequest | undefined,
): FragmentDecision | undefined {
  if (!changed.has(IDENTITY_CHANGE)) return undefined;
  if (capabilities.identityUpdate !== 'in_place_verified') return result('new_fragment', 'identity_update_unverified');
  const artifact = requested?.identityArtifact;
  if (!artifact) return result('new_fragment', 'adoption_artifact_missing');
  const target = requested?.instructionDigest;
  if (artifact.v !== 1 || !target || artifact.instructionDigest !== target) {
    return result('new_fragment', 'adoption_artifact_stale');
  }
  return result('in_place_update', 'identity_update_verified');
}

/**
 * Decide reuse / in-place update / new fragment for the observed structural
 * change. The order matters: hard boundaries always win over soft capabilities.
 */
export function decide(input: FragmentDecisionInput): FragmentDecision {
  const { capabilities, requested } = input;
  const changed = sanitizeChangedFields(input.changed);
  if (requested?.preference === 'new_fragment') return result('new_fragment', 'requested_new_fragment');
  if (changed === 'unverifiable') return result('new_fragment', 'unverifiable_structure');
  if (changed.length === 0) return result('reuse', 'no_structural_change');
  const changedSet = new Set<CompatibilityField>(changed);
  const boundary = decideHardBoundary(changedSet);
  if (boundary) return boundary;
  // Every remaining declared field is covered below; an unexpected field set
  // must fail closed rather than silently reuse.
  return (
    decidePermission(changedSet, capabilities) ??
    decideMcp(changedSet, capabilities) ??
    decideModel(changedSet, capabilities) ??
    decideIdentity(changedSet, capabilities, requested) ??
    result('new_fragment', 'hard_boundary_changed')
  );
}
