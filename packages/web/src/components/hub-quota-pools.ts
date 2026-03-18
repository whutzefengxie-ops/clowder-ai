'use client';

import type { CatData } from '@/hooks/useCatData';
import type { ProfileItem, ProfileProtocol } from './hub-provider-profiles.types';
import type { CodexUsageItem, QuotaResponse } from './quota-cards';

export interface AccountQuotaPool {
  id: string;
  title: string;
  items: CodexUsageItem[];
  memberTags: string[];
  emptyText?: string;
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.filter(Boolean))];
}

function memberTag(cat: CatData): string {
  return cat.mentionPatterns[0] ?? `@${cat.id}`;
}

type ProtocolProvider = 'anthropic' | 'openai' | 'google';

const BUILTIN_PROFILE_BY_PROVIDER: Record<ProtocolProvider, string> = {
  anthropic: 'claude-oauth',
  openai: 'codex-oauth',
  google: 'gemini-oauth',
};

function providerFromProtocol(protocol: ProfileProtocol): ProtocolProvider {
  switch (protocol) {
    case 'anthropic':
      return 'anthropic';
    case 'google':
      return 'google';
    default:
      return 'openai';
  }
}

function resolveActiveProfileIdForProvider(
  provider: ProtocolProvider,
  profiles: ProfileItem[],
  activeProfileIds: Partial<Record<ProfileProtocol, string | null>> | undefined,
  activeProfileId: string | null | undefined,
): string {
  const byProtocol = activeProfileIds?.[provider];
  if (byProtocol?.trim()) return byProtocol;
  if (activeProfileId?.trim()) {
    const profile = profiles.find((item) => item.id === activeProfileId);
    if (profile && providerFromProtocol(profile.protocol) === provider) {
      return activeProfileId;
    }
  }
  return BUILTIN_PROFILE_BY_PROVIDER[provider];
}

function memberTagsForPool(
  cats: CatData[],
  profileId: string,
  provider: ProtocolProvider,
  activeProfileIdForProvider: string,
): string[] {
  return uniqueTags(
    cats
      .filter((cat) => {
        const boundProfileId = cat.providerProfileId?.trim();
        if (boundProfileId) return boundProfileId === profileId;
        return cat.provider === provider && activeProfileIdForProvider === profileId;
      })
      .map(memberTag),
  );
}

export function buildAccountQuotaPools(
  quota: QuotaResponse | null,
  profiles: ProfileItem[],
  cats: CatData[],
  activeProfiles?: {
    activeProfileId?: string | null;
    activeProfileIds?: Partial<Record<ProfileProtocol, string | null>>;
  },
): AccountQuotaPool[] {
  const activeProfileByProvider: Record<ProtocolProvider, string> = {
    anthropic: resolveActiveProfileIdForProvider(
      'anthropic',
      profiles,
      activeProfiles?.activeProfileIds,
      activeProfiles?.activeProfileId,
    ),
    openai: resolveActiveProfileIdForProvider(
      'openai',
      profiles,
      activeProfiles?.activeProfileIds,
      activeProfiles?.activeProfileId,
    ),
    google: resolveActiveProfileIdForProvider('google', profiles, activeProfiles?.activeProfileIds, activeProfiles?.activeProfileId),
  };

  const builtinPools: AccountQuotaPool[] = [
    {
      id: 'claude-oauth',
      title: 'Claude 订阅',
      items: quota?.claude.usageItems ?? [],
      memberTags: memberTagsForPool(cats, 'claude-oauth', 'anthropic', activeProfileByProvider.anthropic),
      emptyText: '暂无数据，点击刷新获取',
    },
    {
      id: 'codex-oauth',
      title: 'Codex 订阅',
      items: quota?.codex.usageItems ?? [],
      memberTags: memberTagsForPool(cats, 'codex-oauth', 'openai', activeProfileByProvider.openai),
      emptyText: '暂无数据，点击刷新获取',
    },
    {
      id: 'gemini-oauth',
      title: 'Gemini 订阅',
      items: quota?.gemini?.usageItems ?? [],
      memberTags: memberTagsForPool(cats, 'gemini-oauth', 'google', activeProfileByProvider.google),
      emptyText: '暂无数据（需 ClaudeBar 推送）',
    },
  ];

  const apiKeyPools = profiles
    .filter((profile) => profile.authType === 'api_key' && !profile.builtin)
    .map<AccountQuotaPool>((profile) => ({
      id: profile.id,
      title: profile.displayName,
      items: [],
      memberTags: memberTagsForPool(
        cats,
        profile.id,
        providerFromProtocol(profile.protocol),
        activeProfileByProvider[providerFromProtocol(profile.protocol)],
      ),
      emptyText: '暂无官方额度数据',
    }));

  const antigravityPool: AccountQuotaPool = {
    id: 'antigravity',
    title: 'Antigravity Bridge',
    items: quota?.antigravity?.usageItems ?? [],
    memberTags: uniqueTags(cats.filter((cat) => cat.provider === 'antigravity').map(memberTag)),
    emptyText: '暂无数据（需 ClaudeBar 推送）',
  };

  return [...builtinPools, ...apiKeyPools, antigravityPool];
}
