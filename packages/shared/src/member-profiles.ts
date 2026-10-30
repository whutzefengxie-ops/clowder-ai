import { createHash } from 'node:crypto';
import type { CatConfig } from './types/cat.js';

/** Pure views of the existing resolved catalog; no second persistence model. */
export function projectMemberProfiles(config: CatConfig) {
  const {
    id,
    name,
    displayName,
    nickname,
    avatar,
    banner,
    color,
    mentionPatterns,
    roleDescription,
    personality,
    breedId,
    relationshipKey,
    variantLabel,
    isDefaultVariant,
    breedDisplayName,
    teamStrengths,
    caution,
    restrictions,
    strengths,
    voiceConfig,
    identitySources,
    ...executionProfile
  } = config;
  return {
    roleProfile: {
      id,
      name,
      displayName,
      nickname,
      avatar,
      banner,
      color,
      mentionPatterns,
      roleDescription,
      personality,
      breedId,
      relationshipKey,
      variantLabel,
      isDefaultVariant,
      breedDisplayName,
      teamStrengths,
      caution,
      restrictions,
      strengths,
      voiceConfig,
      identitySources,
    },
    executionProfile,
  };
}

export type RoleProfile = Readonly<ReturnType<typeof projectMemberProfiles>['roleProfile']>;
export type ExecutionProfile = Readonly<ReturnType<typeof projectMemberProfiles>['executionProfile']>;

/** Stable role semantics only; display media, mention routing and execution fields are excluded. */
export function memberPersonaDigest(profile: RoleProfile): string {
  const semantics = {
    id: profile.id,
    name: profile.name,
    displayName: profile.displayName,
    nickname: profile.nickname,
    roleDescription: profile.roleDescription,
    personality: profile.personality,
    breedId: profile.breedId,
    relationshipKey: profile.relationshipKey,
    variantLabel: profile.variantLabel,
    breedDisplayName: profile.breedDisplayName,
    teamStrengths: profile.teamStrengths,
    caution: profile.caution,
    restrictions: profile.restrictions,
    strengths: profile.strengths,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(semantics)).digest('hex')}`;
}
