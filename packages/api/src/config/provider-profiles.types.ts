export type ProviderProfileProtocol = 'anthropic' | 'openai' | 'google';
export type ProviderProfileProvider = string;
export type ProviderProfileMode = 'subscription' | 'api_key';
export type ProviderProfileAuthType = 'oauth' | 'api_key';

export interface ProviderProfileMeta {
  id: string;
  /** Stable account/provider identifier used by member binding and CRUD. */
  provider: string;
  displayName: string;
  authType: ProviderProfileAuthType;
  protocol: ProviderProfileProtocol;
  builtin: boolean;
  baseUrl?: string;
  models: string[];
  /** Legacy Anthropic runtime override until F127 member binding fully lands. */
  modelOverride?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProfileView extends ProviderProfileMeta {
  /** Legacy compatibility for existing callers/UI tests. */
  name: string;
  /** Legacy compatibility for Anthropic runtime terminology. */
  mode: ProviderProfileMode;
  hasApiKey: boolean;
}

export interface ProviderProfilesView {
  activeProfileId: string | null;
  providers: ProviderProfileView[];
}

export interface CreateProviderProfileInput {
  /** Legacy callers may still pass a protocol family like "anthropic". */
  provider: ProviderProfileProvider;
  name?: string;
  displayName?: string;
  mode?: ProviderProfileMode;
  authType?: ProviderProfileAuthType;
  protocol?: ProviderProfileProtocol;
  baseUrl?: string;
  apiKey?: string;
  modelOverride?: string;
  models?: string[];
  setActive?: boolean;
}

export interface UpdateProviderProfileInput {
  name?: string;
  displayName?: string;
  mode?: ProviderProfileMode;
  authType?: ProviderProfileAuthType;
  baseUrl?: string;
  apiKey?: string;
  modelOverride?: string | null;
  models?: string[];
}

export interface AnthropicRuntimeProfile {
  id: string;
  mode: ProviderProfileMode;
  baseUrl?: string;
  apiKey?: string;
  modelOverride?: string;
}

export interface ProviderProfilesMetaFile {
  version: 2;
  activeProfileId: string | null;
  profiles: ProviderProfileMeta[];
}

export interface ProviderProfilesSecretsFile {
  version: 2;
  profiles: Record<string, { apiKey?: string }>;
}

export interface NormalizedState<T> {
  value: T;
  dirty: boolean;
}
