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

export interface AccountQuotaPoolGroup {
  id: string;
  title: string;
  description: string;
  tone?: 'default' | 'success';
  pools: AccountQuotaPool[];
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

const BUILTIN_OAUTH_PROFILES: Array<{
  id: string;
  protocol: ProtocolProvider;
  fallbackTitle: string;
  emptyText: string;
  items: (quota: QuotaResponse | null) => CodexUsageItem[];
}> = [
  {
    id: 'claude-oauth',
    protocol: 'anthropic',
    fallbackTitle: 'Claude (OAuth)',
    emptyText: '暂无数据，点击刷新获取',
    items: (quota) => quota?.claude.usageItems ?? [],
  },
  {
    id: 'codex-oauth',
    protocol: 'openai',
    fallbackTitle: 'Codex (OAuth)',
    emptyText: '暂无数据，点击刷新获取',
    items: (quota) => quota?.codex.usageItems ?? [],
  },
  {
    id: 'gemini-oauth',
    protocol: 'google',
    fallbackTitle: 'Gemini (OAuth)',
    emptyText: '暂无数据（需 ClaudeBar 推送）',
    items: (quota) => quota?.gemini?.usageItems ?? [],
  },
];

export function buildAccountQuotaGroups(
  quota: QuotaResponse | null,
  profiles: ProfileItem[],
  cats: CatData[],
  activeProfiles?: {
    activeProfileId?: string | null;
    activeProfileIds?: Partial<Record<ProfileProtocol, string | null>>;
  },
): AccountQuotaPoolGroup[] {
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

  const builtinPools: AccountQuotaPool[] = BUILTIN_OAUTH_PROFILES.map((profile) => {
    const configuredProfile = profiles.find((item) => item.id === profile.id);
    return {
      id: profile.id,
      title: configuredProfile?.displayName ?? profile.fallbackTitle,
      items: profile.items(quota),
      memberTags: memberTagsForPool(cats, profile.id, profile.protocol, activeProfileByProvider[profile.protocol]),
      emptyText: profile.emptyText,
    };
  });

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
      emptyText: '按账单周期计费，暂不展示官方用量',
    }));

  const antigravityMemberTags = uniqueTags(cats.filter((cat) => cat.provider === 'antigravity').map(memberTag));
  const antigravityPools: AccountQuotaPool[] =
    antigravityMemberTags.length > 0 || (quota?.antigravity?.usageItems.length ?? 0) > 0
      ? [
          {
            id: 'antigravity',
            title: 'Antigravity Bridge',
            items: quota?.antigravity?.usageItems ?? [],
            memberTags: antigravityMemberTags,
            emptyText: '暂无数据（需 Bridge 上报）',
          },
        ]
      : [];

  const groups: AccountQuotaPoolGroup[] = [
    {
      id: 'oauth',
      title: 'OAuth 订阅额度（按账号配置）',
      description: '对应账号配置中的 Provider 订阅账号，每个账号下方反向显示关联成员。',
      pools: builtinPools,
    },
    {
      id: 'api-key',
      title: 'API Key 额度（按账号配置）',
      description: '对应账号配置中的 API Key 类型账号，每个账号独立计费。',
      tone: 'success',
      pools: apiKeyPools,
    },
  ];

  if (antigravityPools.length > 0) {
    groups.push({
      id: 'antigravity',
      title: 'Antigravity Bridge（独立通道）',
      description: 'Bridge 通道单独展示，不混入账号池。',
      pools: antigravityPools,
    });
  }

  return groups;
}
