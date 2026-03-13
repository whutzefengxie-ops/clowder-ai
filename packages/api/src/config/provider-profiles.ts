import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type {
  AnthropicRuntimeProfile,
  CreateProviderProfileInput,
  NormalizedState,
  ProviderProfileMeta,
  ProviderProfileProvider,
  ProviderProfilesMetaFile,
  ProviderProfilesSecretsFile,
  ProviderProfilesView,
  ProviderProfileView,
  UpdateProviderProfileInput,
} from './provider-profiles.types.js';
import { resolveProviderProfilesRoot } from './provider-profiles-root.js';

export type {
  AnthropicRuntimeProfile,
  CreateProviderProfileInput,
  ProviderProfileMeta,
  ProviderProfileMode,
  ProviderProfileProvider,
  ProviderProfilesView,
  ProviderProfileView,
  UpdateProviderProfileInput,
} from './provider-profiles.types.js';

const CAT_CAFE_DIR = '.cat-cafe';
const META_FILENAME = 'provider-profiles.json';
const SECRETS_FILENAME = 'provider-profiles.secrets.local.json';
const DEFAULT_SUBSCRIPTION_PROFILE_ID = 'anthropic-subscription-default';

function safePath(projectRoot: string, ...segments: string[]): string {
  const root = resolve(projectRoot);
  const normalized = resolve(root, ...segments);
  const rel = relative(root, normalized);
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Path escapes project root: ${normalized}`);
  }
  return normalized;
}

function createDefaultSubscriptionProfile(): ProviderProfileMeta {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_SUBSCRIPTION_PROFILE_ID,
    provider: 'anthropic',
    name: '自有订阅',
    mode: 'subscription',
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultMeta(): ProviderProfilesMetaFile {
  const defaultProfile = createDefaultSubscriptionProfile();
  return {
    version: 1,
    providers: {
      anthropic: {
        activeProfileId: defaultProfile.id,
        profiles: [defaultProfile],
      },
    },
  };
}

function createDefaultSecrets(): ProviderProfilesSecretsFile {
  return {
    version: 1,
    providers: {
      anthropic: {},
    },
  };
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function normalizeMeta(meta: ProviderProfilesMetaFile | null): NormalizedState<ProviderProfilesMetaFile> {
  if (!meta || meta.version !== 1) {
    return { value: createDefaultMeta(), dirty: true };
  }
  const next = meta;
  let dirty = false;
  const anthropic = next.providers?.anthropic;
  if (!anthropic || !Array.isArray(anthropic.profiles)) {
    return { value: createDefaultMeta(), dirty: true };
  }
  const hasDefault = anthropic.profiles.some((p) => p.id === DEFAULT_SUBSCRIPTION_PROFILE_ID);
  if (!hasDefault) {
    anthropic.profiles.unshift(createDefaultSubscriptionProfile());
    dirty = true;
  }
  const existingIds = new Set(anthropic.profiles.map((p) => p.id));
  if (!anthropic.activeProfileId || !existingIds.has(anthropic.activeProfileId)) {
    anthropic.activeProfileId = DEFAULT_SUBSCRIPTION_PROFILE_ID;
    dirty = true;
  }
  return { value: next, dirty };
}

function normalizeSecrets(secrets: ProviderProfilesSecretsFile | null): NormalizedState<ProviderProfilesSecretsFile> {
  if (secrets && secrets.version === 1 && secrets.providers?.anthropic) {
    return { value: secrets, dirty: false };
  }
  return { value: createDefaultSecrets(), dirty: true };
}

async function readRaw(projectRoot: string): Promise<{
  meta: ProviderProfilesMetaFile;
  secrets: ProviderProfilesSecretsFile;
  metaPath: string;
  secretsPath: string;
  dirty: boolean;
}> {
  const storageRoot = await resolveProviderProfilesRoot(projectRoot);
  const dir = safePath(storageRoot, CAT_CAFE_DIR);
  const metaPath = safePath(storageRoot, CAT_CAFE_DIR, META_FILENAME);
  const secretsPath = safePath(storageRoot, CAT_CAFE_DIR, SECRETS_FILENAME);
  await mkdir(dir, { recursive: true });
  const normalizedMeta = normalizeMeta(await readJsonOrNull<ProviderProfilesMetaFile>(metaPath));
  const normalizedSecrets = normalizeSecrets(await readJsonOrNull<ProviderProfilesSecretsFile>(secretsPath));
  return {
    meta: normalizedMeta.value,
    secrets: normalizedSecrets.value,
    metaPath,
    secretsPath,
    dirty: normalizedMeta.dirty || normalizedSecrets.dirty,
  };
}

async function writeRaw(
  metaPath: string,
  secretsPath: string,
  meta: ProviderProfilesMetaFile,
  secrets: ProviderProfilesSecretsFile,
): Promise<void> {
  await Promise.all([writeJson(metaPath, meta), writeJson(secretsPath, secrets)]);
}

function toView(meta: ProviderProfilesMetaFile, secrets: ProviderProfilesSecretsFile): ProviderProfilesView {
  const profiles: ProviderProfileView[] = meta.providers.anthropic.profiles.map((profile) => ({
    ...profile,
    hasApiKey: Boolean(secrets.providers.anthropic[profile.id]?.apiKey),
  }));
  return {
    anthropic: {
      activeProfileId: meta.providers.anthropic.activeProfileId,
      profiles,
    },
  };
}

export async function readProviderProfiles(projectRoot: string): Promise<ProviderProfilesView> {
  const { meta, secrets, metaPath, secretsPath, dirty } = await readRaw(projectRoot);
  if (dirty) await writeRaw(metaPath, secretsPath, meta, secrets);
  return toView(meta, secrets);
}

export async function createProviderProfile(
  projectRoot: string,
  input: CreateProviderProfileInput,
): Promise<ProviderProfileView> {
  const { meta, secrets, metaPath, secretsPath } = await readRaw(projectRoot);
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('name is required');
  const now = new Date().toISOString();
  const profile: ProviderProfileMeta = {
    id: `profile-${randomUUID()}`,
    provider: input.provider,
    name: trimmedName,
    mode: input.mode,
    ...(input.baseUrl ? { baseUrl: input.baseUrl.trim().replace(/\/+$/, '') } : {}),
    ...(input.modelOverride?.trim() ? { modelOverride: input.modelOverride.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };
  if (profile.mode === 'api_key') {
    if (!input.apiKey?.trim()) throw new Error('apiKey is required for api_key mode');
    if (!profile.baseUrl) throw new Error('baseUrl is required for api_key mode');
    secrets.providers.anthropic[profile.id] = { apiKey: input.apiKey.trim() };
  }
  meta.providers.anthropic.profiles.push(profile);
  if (input.setActive) {
    meta.providers.anthropic.activeProfileId = profile.id;
  }
  await writeRaw(metaPath, secretsPath, meta, secrets);
  return {
    ...profile,
    hasApiKey: Boolean(secrets.providers.anthropic[profile.id]?.apiKey),
  };
}

export async function updateProviderProfile(
  projectRoot: string,
  provider: ProviderProfileProvider,
  profileId: string,
  input: UpdateProviderProfileInput,
): Promise<ProviderProfileView> {
  if (provider !== 'anthropic') throw new Error(`unsupported provider: ${provider}`);
  const { meta, secrets, metaPath, secretsPath } = await readRaw(projectRoot);
  const profile = meta.providers.anthropic.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error('profile not found');

  if (typeof input.name === 'string') {
    const trimmedName = input.name.trim();
    if (!trimmedName) throw new Error('name is required');
    profile.name = trimmedName;
  }
  if (typeof input.baseUrl === 'string') {
    const trimmed = input.baseUrl.trim();
    if (trimmed) profile.baseUrl = trimmed.replace(/\/+$/, '');
    else delete profile.baseUrl;
  }
  if (input.modelOverride === null || input.modelOverride === '') {
    delete profile.modelOverride;
  } else if (typeof input.modelOverride === 'string') {
    profile.modelOverride = input.modelOverride.trim();
  }
  if (input.mode) profile.mode = input.mode;
  profile.updatedAt = new Date().toISOString();

  if (profile.mode === 'api_key') {
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      secrets.providers.anthropic[profile.id] = { apiKey: input.apiKey.trim() };
    }
    if (!profile.baseUrl) throw new Error('baseUrl is required for api_key mode');
    if (!secrets.providers.anthropic[profile.id]?.apiKey) throw new Error('apiKey is required for api_key mode');
  } else {
    delete secrets.providers.anthropic[profile.id];
  }

  await writeRaw(metaPath, secretsPath, meta, secrets);
  return {
    ...profile,
    hasApiKey: Boolean(secrets.providers.anthropic[profile.id]?.apiKey),
  };
}

export async function activateProviderProfile(
  projectRoot: string,
  provider: ProviderProfileProvider,
  profileId: string,
): Promise<void> {
  if (provider !== 'anthropic') throw new Error(`unsupported provider: ${provider}`);
  const { meta, secrets, metaPath, secretsPath } = await readRaw(projectRoot);
  const exists = meta.providers.anthropic.profiles.some((p) => p.id === profileId);
  if (!exists) throw new Error('profile not found');
  meta.providers.anthropic.activeProfileId = profileId;
  await writeRaw(metaPath, secretsPath, meta, secrets);
}

export async function deleteProviderProfile(
  projectRoot: string,
  provider: ProviderProfileProvider,
  profileId: string,
): Promise<void> {
  if (provider !== 'anthropic') throw new Error(`unsupported provider: ${provider}`);
  if (profileId === DEFAULT_SUBSCRIPTION_PROFILE_ID) {
    throw new Error('default subscription profile cannot be deleted');
  }
  const { meta, secrets, metaPath, secretsPath } = await readRaw(projectRoot);
  const before = meta.providers.anthropic.profiles.length;
  meta.providers.anthropic.profiles = meta.providers.anthropic.profiles.filter((p) => p.id !== profileId);
  if (before === meta.providers.anthropic.profiles.length) throw new Error('profile not found');
  delete secrets.providers.anthropic[profileId];
  if (meta.providers.anthropic.activeProfileId === profileId) {
    meta.providers.anthropic.activeProfileId = DEFAULT_SUBSCRIPTION_PROFILE_ID;
  }
  await writeRaw(metaPath, secretsPath, meta, secrets);
}

export async function getProviderProfile(
  projectRoot: string,
  provider: ProviderProfileProvider,
  profileId: string,
): Promise<ProviderProfileView | null> {
  if (provider !== 'anthropic') return null;
  const { meta, secrets, metaPath, secretsPath, dirty } = await readRaw(projectRoot);
  if (dirty) await writeRaw(metaPath, secretsPath, meta, secrets);
  const profile = meta.providers.anthropic.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  return {
    ...profile,
    hasApiKey: Boolean(secrets.providers.anthropic[profile.id]?.apiKey),
  };
}

export async function resolveAnthropicRuntimeProfile(projectRoot: string): Promise<AnthropicRuntimeProfile> {
  const { meta, secrets, metaPath, secretsPath, dirty } = await readRaw(projectRoot);
  if (dirty) await writeRaw(metaPath, secretsPath, meta, secrets);
  const activeId = meta.providers.anthropic.activeProfileId ?? DEFAULT_SUBSCRIPTION_PROFILE_ID;
  const profile =
    meta.providers.anthropic.profiles.find((p) => p.id === activeId) ??
    meta.providers.anthropic.profiles.find((p) => p.id === DEFAULT_SUBSCRIPTION_PROFILE_ID) ??
    createDefaultSubscriptionProfile();

  if (profile.mode === 'api_key') {
    const apiKey = secrets.providers.anthropic[profile.id]?.apiKey;
    if (apiKey && profile.baseUrl) {
      return {
        id: profile.id,
        mode: 'api_key',
        baseUrl: profile.baseUrl,
        apiKey,
        ...(profile.modelOverride ? { modelOverride: profile.modelOverride } : {}),
      };
    }
  }

  return {
    id: DEFAULT_SUBSCRIPTION_PROFILE_ID,
    mode: 'subscription',
    ...(profile.modelOverride ? { modelOverride: profile.modelOverride } : {}),
  };
}

export async function resolveAnthropicRuntimeProfileById(
  projectRoot: string,
  profileId: string,
): Promise<AnthropicRuntimeProfile | null> {
  const { meta, secrets, metaPath, secretsPath, dirty } = await readRaw(projectRoot);
  if (dirty) await writeRaw(metaPath, secretsPath, meta, secrets);
  const profile = meta.providers.anthropic.profiles.find((p) => p.id === profileId);
  if (!profile) return null;

  if (profile.mode === 'api_key') {
    const apiKey = secrets.providers.anthropic[profile.id]?.apiKey;
    if (!apiKey || !profile.baseUrl) return null;
    return {
      id: profile.id,
      mode: 'api_key',
      baseUrl: profile.baseUrl,
      apiKey,
      ...(profile.modelOverride ? { modelOverride: profile.modelOverride } : {}),
    };
  }

  return {
    id: profile.id,
    mode: 'subscription',
    ...(profile.modelOverride ? { modelOverride: profile.modelOverride } : {}),
  };
}
