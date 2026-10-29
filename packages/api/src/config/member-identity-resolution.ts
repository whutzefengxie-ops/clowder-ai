/**
 * Member identity authority (W1 / C02).
 *
 * Effective saved member configuration is authoritative over the dossier. A
 * dossier self-description is a legacy identity projection, not a second saved
 * identity: once the member has an explicit configuration identity edit, the
 * dossier self-description is suppressed from the identity block and reported
 * for preview instead of being silently mixed with the configured identity.
 * Members without an explicit identity edit keep the existing legacy-compatible
 * dossier behavior (clearly marked with `source: 'dossier'`).
 *
 * Deterministic only: no model calls and no dossier rewriting. The function is
 * pure; the caller supplies the dossier text it resolved.
 */

import type {
  DossierIdentityText,
  IdentityAuthorityPreview,
  MemberFieldSource,
  ProjectedField,
  SuppressedIdentityText,
} from '@cat-cafe/shared';

/** Dossier facts supplied by the caller (no filesystem access in this module). */
export interface DossierIdentityInput {
  /** Legacy self-facing identity projection (`l0SelfDescription`). */
  readonly selfDescription?: string | null;
  /** Independent structured dossier facts that may stay as a separate source. */
  readonly supplementary?: readonly string[];
}

export interface MemberIdentityResolutionInput {
  readonly catId: string;
  /** Effective resolved member role description (never pre-emptied by the caller). */
  readonly roleDescription: string;
  readonly personality: string;
  /** Provenance from the member profile projection. */
  readonly roleDescriptionSource: MemberFieldSource;
  readonly personalitySource: MemberFieldSource;
  readonly dossier?: DossierIdentityInput;
}

export interface MemberIdentityResolution {
  readonly catId: string;
  readonly roleDescription: ProjectedField<string>;
  readonly personality: ProjectedField<string>;
  /** Legacy dossier fill used by the L0 identity block; `null` when absent or suppressed. */
  readonly selfDescription: DossierIdentityText | null;
  readonly suppressed: readonly SuppressedIdentityText[];
  readonly supplementary: readonly DossierIdentityText[];
  /** True when the member's saved configuration declares its own identity. */
  readonly explicitIdentity: boolean;
}

/** Explicit identity is decided by declaration provenance, not by text emptiness. */
export function identityFieldIsExplicit(source: MemberFieldSource): boolean {
  return source === 'config';
}

export function hasExplicitIdentity(
  input: Pick<MemberIdentityResolutionInput, 'roleDescriptionSource' | 'personalitySource'>,
): boolean {
  return identityFieldIsExplicit(input.roleDescriptionSource) || identityFieldIsExplicit(input.personalitySource);
}

function presentText(text: string | null | undefined): string | null {
  // Preserve the dossier bytes exactly as parsed; emptiness (not trimming) is
  // the absence signal, matching the legacy compiler behavior.
  return typeof text === 'string' && text.length > 0 ? text : null;
}

function collectSupplements(inputs: readonly string[] | undefined): DossierIdentityText[] {
  const supplements: DossierIdentityText[] = [];
  for (const text of inputs ?? []) {
    const value = presentText(text);
    if (value === null) continue;
    supplements.push({ text: value, source: 'dossier', legacyCompatibility: false });
  }
  return supplements;
}

/**
 * Decide the authoritative identity block inputs for one member.
 *
 * - explicit configuration identity -> config wins, conflicting dossier
 *   self-description is suppressed (and reported), independent supplements kept;
 * - no explicit configuration identity -> legacy dossier self-description fills
 *   the identity block and is marked as dossier-sourced legacy compatibility;
 * - no dossier text -> plain config fields, preserving empty/null values.
 */
export function resolveMemberIdentity(input: MemberIdentityResolutionInput): MemberIdentityResolution {
  const explicitIdentity = hasExplicitIdentity(input);
  const selfDescriptionText = presentText(input.dossier?.selfDescription);
  const suppressed: SuppressedIdentityText[] = [];
  let selfDescription: DossierIdentityText | null = null;
  let supplementary: DossierIdentityText[] = [];

  if (selfDescriptionText !== null) {
    if (explicitIdentity) {
      suppressed.push({ text: selfDescriptionText, reason: 'explicit_config_identity' });
    } else {
      selfDescription = { text: selfDescriptionText, source: 'dossier', legacyCompatibility: true };
    }
  }
  if (explicitIdentity) supplementary = collectSupplements(input.dossier?.supplementary);

  return {
    catId: input.catId,
    roleDescription: { value: input.roleDescription, source: input.roleDescriptionSource },
    personality: { value: input.personality, source: input.personalitySource },
    selfDescription,
    suppressed,
    supplementary,
    explicitIdentity,
  };
}

/** Convert a full resolution into the shared preview contract. */
export function toIdentityAuthorityPreview(resolution: MemberIdentityResolution): IdentityAuthorityPreview {
  return {
    roleDescription: resolution.roleDescription,
    personality: resolution.personality,
    selfDescription: resolution.selfDescription,
    suppressed: resolution.suppressed,
    supplementary: resolution.supplementary,
  };
}
