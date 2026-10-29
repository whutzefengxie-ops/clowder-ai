/**
 * Member profile projections (W1 of the role/execution split).
 *
 * A member is "who it is in the team" (RoleProfile) plus "which client,
 * account and model it uses for this invocation" (ExecutionProfile). These are
 * pure projections over the already resolved member configuration; they are
 * never persisted, and they never replace the flat CatConfig fields.
 *
 * Projections carry per-field provenance so a preview can explain whether a
 * value came from the saved member configuration (`config`), from its
 * breed/variant inheritance (`inherited`), from a schema/runtime fallback
 * (`default`), or from a legacy dossier fill (`dossier`, identity resolution
 * only). Preservation matters: `null` and an absent field are different member
 * intents and must not be collapsed by the projection.
 */

import type { ClientId } from './cat.js';
import type { CatCarrier } from './cat-carrier.js';

/**
 * Where one projected field value came from.
 *
 * `config`    = declared by the effective member's own saved configuration
 *               (variant-level for the current breed/variant layout).
 * `inherited` = declared by the parent breed/variant and inherited by the
 *               member (existing inheritance semantics, not a user edit).
 * `default`   = no declaration in the configuration chain; runtime/schema value.
 * `dossier`   = legacy dossier compatibility fill (identity resolution only).
 */
export type MemberFieldSource = 'config' | 'inherited' | 'default' | 'dossier';

/** A projected value together with the source that decided it. */
export interface ProjectedField<T> {
  readonly value: T;
  readonly source: MemberFieldSource;
}

/** Collaboration-facing role rules (route boundaries shared with teammates). */
export interface MemberCollaborationRules {
  /** Hard task restrictions surfaced to teammates and to the member itself. */
  readonly restrictions: ProjectedField<readonly string[]>;
  /** Roster routing caution. `null` means explicitly no caution (not "unset"). */
  readonly caution: ProjectedField<string | null>;
}

/**
 * Identity/display half of a member. Deliberately excludes clients, accounts,
 * credentials, models and protocols.
 */
export interface RoleProfile {
  readonly catId: string;
  readonly name: ProjectedField<string>;
  readonly displayName: ProjectedField<string>;
  /** `null` means explicitly no nickname (never fall back to a display name). */
  readonly nickname: ProjectedField<string | null>;
  readonly roleDescription: ProjectedField<string>;
  readonly personality: ProjectedField<string>;
  /** Human-readable team position used by the teammate roster (`teamStrengths`). */
  readonly teamPosition: ProjectedField<string | null>;
  readonly collaborationRules: MemberCollaborationRules;
  readonly avatar: ProjectedField<string>;
}

/** Client launch arguments, kept separate from member identity. */
export interface MemberLaunchArgs {
  /** Effective per-member CLI args (already projected from cli.defaultArgs when applicable). */
  readonly commandArgs: ProjectedField<readonly string[]>;
  readonly defaultArgs: ProjectedField<readonly string[]>;
  /** Extra `--config key=value` pairs passed to the client at invocation time. */
  readonly cliConfigArgs: ProjectedField<readonly string[]>;
}

/** Non-identity execution policy facts retained by the projection. */
export interface MemberExecutionPolicy {
  readonly outputFormat: ProjectedField<string | null>;
  readonly serviceTier: ProjectedField<'standard' | 'fast' | null>;
  /** Explicit member-level context window cap in tokens; `null` = Auto. */
  readonly contextWindow: ProjectedField<number | null>;
}

/**
 * Execution half of a member. These four concepts stay distinct:
 * `clientId` (client kind), `provider` (model provider), `carrier` (invocation
 * carrier) and `implementationRef` (selected implementation/agent provider).
 */
export interface ExecutionProfile {
  readonly catId: string;
  readonly clientId: ProjectedField<ClientId>;
  readonly carrier: ProjectedField<CatCarrier>;
  /** Selected implementation reference (`agentProvider`); `null` = member native carrier. */
  readonly implementationRef: ProjectedField<string | null>;
  readonly accountRef: ProjectedField<string | null>;
  readonly configurationSource: ProjectedField<'native_tool' | 'managed_account' | null>;
  /** Model provider for api_key routing (e.g. openrouter); distinct from clientId. */
  readonly provider: ProjectedField<string | null>;
  /** Saved model preference. Runtime-resolved/actual model facts are separate. */
  readonly model: ProjectedField<string>;
  /** Saved effort preference; `null` = inherit native client default. */
  readonly effort: ProjectedField<string | null>;
  readonly launchArgs: MemberLaunchArgs;
  /** Whether the member advertises MCP support to the compiler/route layer. */
  readonly mcpExposure: ProjectedField<boolean>;
  readonly executionPolicy: MemberExecutionPolicy;
}

/** A member's role and execution projections, without dossier/identity authority. */
export interface MemberProfileProjection {
  readonly catId: string;
  /** Breed grouping id (display grouping only, never an identity boundary). */
  readonly breedId: string | null;
  /** Stable relationship persona key (primer/HOME addressing, not routing). */
  readonly relationshipKey: string | null;
  readonly role: RoleProfile;
  readonly execution: ExecutionProfile;
}

/** Dossier text retained as an explicitly separate source. */
export interface DossierIdentityText {
  readonly text: string;
  readonly source: 'dossier';
  /**
   * True when the dossier text fills fields that have no explicit saved
   * configuration (legacy compatibility). False for independent supplements.
   */
  readonly legacyCompatibility: boolean;
}

/** Dossier self-description suppressed because the member has explicit config identity. */
export interface SuppressedIdentityText {
  readonly text: string;
  readonly reason: 'explicit_config_identity';
}

/**
 * Identity authority preview: which identity fields win, what dossier text was
 * suppressed, and which independent dossier facts remain as a separate source.
 */
export interface IdentityAuthorityPreview {
  readonly roleDescription: ProjectedField<string>;
  readonly personality: ProjectedField<string>;
  /** Legacy dossier fill rendered instead of config role/personality; `null` when suppressed or absent. */
  readonly selfDescription: DossierIdentityText | null;
  readonly suppressed: readonly SuppressedIdentityText[];
  readonly supplementary: readonly DossierIdentityText[];
}

/** Full preview payload for member settings / identity diagnostics. */
export interface MemberProfilePreview extends MemberProfileProjection {
  readonly identity: IdentityAuthorityPreview;
}
