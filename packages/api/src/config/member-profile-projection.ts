/**
 * Pure member profile projection (W1).
 *
 * Reads only the already resolved effective `CatConfig` plus the raw
 * breed/variant declarations when they are available. The raw declarations are
 * needed for one purpose only: label each field as `config` (declared by this
 * member's own saved variant), `inherited` (declared by the parent breed and
 * inherited through the existing loader rules) or `default` (schema/runtime
 * fallback). No filesystem access, no catalog reload, and no mutation of the
 * flat CatConfig fields: consumers that still read flat fields keep seeing the
 * exact same values.
 */

import type {
  CatBreed,
  CatCafeConfig,
  CatConfig,
  CatVariant,
  ExecutionProfile,
  MemberExecutionPolicy,
  MemberFieldSource,
  MemberLaunchArgs,
  MemberProfileProjection,
  ProjectedField,
  RoleProfile,
} from '@cat-cafe/shared';

/** Raw breed/variant declarations for one effective member catId. */
export interface RawMemberLocation {
  readonly breed: CatBreed;
  readonly variant: CatVariant;
  readonly isDefaultVariant: boolean;
}

/** Locate the breed/variant declaration that resolves to `catId`. */
export function findRawMemberLocation(config: CatCafeConfig, catId: string): RawMemberLocation | undefined {
  for (const breed of config.breeds) {
    for (const variant of breed.variants) {
      const resolvedCatId = variant.catId ?? breed.catId;
      if (resolvedCatId !== catId) continue;
      return { breed, variant, isDefaultVariant: variant.id === breed.defaultVariantId };
    }
  }
  return undefined;
}

export interface MemberProfileProjectionInput {
  /** Effective member configuration (already resolved by the config loader). */
  readonly config: CatConfig;
  /** Raw breed declaration; enables inherited/default provenance. */
  readonly breed?: CatBreed;
  /** Raw variant declaration; enables explicit-config provenance. */
  readonly variant?: CatVariant;
}

function projected<T>(value: T, source: MemberFieldSource): ProjectedField<T> {
  return { value, source };
}

function declared(value: unknown): boolean {
  return value !== undefined;
}

function roleFieldSource(hasVariant: boolean, hasBreed: boolean): MemberFieldSource {
  if (hasVariant) return 'config';
  if (hasBreed) return 'inherited';
  return 'default';
}

function defaultVariantPersonalityIsDeclared(breed: CatBreed | undefined): boolean {
  if (!breed) return false;
  return breed.variants.some((candidate) => candidate.id === breed.defaultVariantId && declared(candidate.personality));
}

/** Project the identity/display half of a member. */
export function projectRoleProfile(input: MemberProfileProjectionInput): RoleProfile {
  const { config, breed, variant } = input;
  const nickname: string | null = config.nickname ?? null;
  const caution: string | null = config.caution ?? null;

  return {
    catId: String(config.id),
    // `name` keeps the documented loader legacy-compat chain
    // `variant.name ?? variant.displayName ?? breed.name`; both variant
    // declarations count as explicit member configuration here.
    name: projected(config.name, roleFieldSource(declared(variant?.name), declared(breed?.name))),
    displayName: projected(
      config.displayName,
      roleFieldSource(declared(variant?.displayName), declared(breed?.displayName)),
    ),
    nickname: projected(nickname, roleFieldSource(declared(variant?.nickname), declared(breed?.nickname))),
    roleDescription: projected(
      config.roleDescription,
      roleFieldSource(declared(variant?.roleDescription), declared(breed?.roleDescription)),
    ),
    personality: projected(
      config.personality,
      roleFieldSource(declared(variant?.personality), defaultVariantPersonalityIsDeclared(breed)),
    ),
    teamPosition: projected(
      config.teamStrengths ?? null,
      roleFieldSource(declared(variant?.teamStrengths), declared(breed?.teamStrengths)),
    ),
    collaborationRules: {
      restrictions: projected(
        config.restrictions ?? [],
        roleFieldSource(declared(variant?.restrictions), declared(breed?.restrictions)),
      ),
      caution: projected(caution, roleFieldSource(declared(variant?.caution), declared(breed?.caution))),
    },
    avatar: projected(config.avatar, roleFieldSource(declared(variant?.avatar), declared(breed?.avatar))),
  };
}

function projectLaunchArgs(config: CatConfig, variant: CatVariant | undefined): MemberLaunchArgs {
  const commandArgsSource: MemberFieldSource = declared(variant?.commandArgs)
    ? 'config'
    : variant?.clientId === 'antigravity' && (variant.cli?.defaultArgs?.length ?? 0) > 0
      ? 'inherited'
      : 'default';
  return {
    commandArgs: projected(config.commandArgs ?? [], commandArgsSource),
    defaultArgs: projected(config.cli?.defaultArgs ?? [], declared(variant?.cli?.defaultArgs) ? 'config' : 'default'),
    cliConfigArgs: projected(config.cliConfigArgs ?? [], declared(variant?.cliConfigArgs) ? 'config' : 'default'),
  };
}

function projectExecutionPolicy(config: CatConfig, variant: CatVariant | undefined): MemberExecutionPolicy {
  return {
    outputFormat: projected(
      config.cli?.outputFormat ?? null,
      declared(config.cli?.outputFormat) ? 'config' : 'default',
    ),
    serviceTier: projected(config.cli?.serviceTier ?? null, declared(variant?.cli?.serviceTier) ? 'config' : 'default'),
    contextWindow: projected(config.contextWindow ?? null, declared(variant?.contextWindow) ? 'config' : 'default'),
  };
}

/** Project the execution half of a member (client, carrier, account, model, policy). */
export function projectExecutionProfile(input: MemberProfileProjectionInput): ExecutionProfile {
  const { config, variant } = input;
  return {
    catId: String(config.id),
    clientId: projected(config.clientId, declared(variant?.clientId) ? 'config' : 'default'),
    carrier: projected(config.carrier, declared(variant?.carrier) ? 'config' : 'default'),
    implementationRef: projected(config.agentProvider ?? null, declared(variant?.agentProvider) ? 'config' : 'default'),
    accountRef: projected(config.accountRef ?? null, declared(variant?.accountRef) ? 'config' : 'default'),
    configurationSource: projected(
      config.configurationSource ?? null,
      declared(variant?.configurationSource) ? 'config' : 'default',
    ),
    provider: projected(config.provider ?? null, declared(variant?.provider) ? 'config' : 'default'),
    model: projected(config.defaultModel, declared(variant?.defaultModel) ? 'config' : 'default'),
    effort: projected(config.cli?.effort ?? null, declared(variant?.cli?.effort) ? 'config' : 'default'),
    launchArgs: projectLaunchArgs(config, variant),
    mcpExposure: projected(config.mcpSupport, declared(variant?.mcpSupport) ? 'config' : 'default'),
    executionPolicy: projectExecutionPolicy(config, variant),
  };
}

/** Project one effective member into its role/execution halves. */
export function projectMemberProfile(input: MemberProfileProjectionInput): MemberProfileProjection {
  const { config } = input;
  const catId = String(config.id);
  return {
    catId,
    breedId: config.breedId ?? input.breed?.id ?? null,
    relationshipKey: config.relationshipKey ?? null,
    role: projectRoleProfile(input),
    execution: projectExecutionProfile(input),
  };
}
