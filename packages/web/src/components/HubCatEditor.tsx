'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import type { ProfileItem, ProviderProfilesResponse } from './hub-provider-profiles.types';

type ClientValue = 'anthropic' | 'openai' | 'google' | 'dare' | 'opencode' | 'antigravity';

interface HubCatEditorProps {
  cat?: CatData | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const CLIENT_OPTIONS: Array<{ value: ClientValue; label: string }> = [
  { value: 'anthropic', label: 'Claude' },
  { value: 'openai', label: 'Codex' },
  { value: 'google', label: 'Gemini' },
  { value: 'dare', label: 'Dare' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'antigravity', label: 'Antigravity' },
];

function splitMentionPatterns(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitCommandArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function protocolForClient(client: ClientValue): 'anthropic' | 'openai' | 'google' | null {
  switch (client) {
    case 'anthropic':
      return 'anthropic';
    case 'openai':
      return 'openai';
    case 'google':
      return 'google';
    default:
      return null;
  }
}

function filterProfiles(client: ClientValue, profiles: ProfileItem[]): ProfileItem[] {
  if (client === 'antigravity') return [];
  if (client === 'dare' || client === 'opencode') {
    return profiles.filter((profile) => profile.authType === 'api_key');
  }
  const protocol = protocolForClient(client);
  return profiles.filter((profile) => profile.authType === 'api_key' || profile.protocol === protocol);
}

function initialState(cat?: CatData | null) {
  return {
    catId: cat?.id ?? '',
    name: cat?.name ?? cat?.displayName ?? '',
    displayName: cat?.displayName ?? '',
    avatar: cat?.avatar ?? '',
    colorPrimary: cat?.color.primary ?? '#9B7EBD',
    colorSecondary: cat?.color.secondary ?? '#E8DFF5',
    mentionPatterns: cat?.mentionPatterns.join(', ') ?? '',
    roleDescription: cat?.roleDescription ?? '',
    personality: cat?.personality ?? '',
    client: (cat?.provider as ClientValue | undefined) ?? 'anthropic',
    providerProfileId: cat?.providerProfileId ?? '',
    defaultModel: cat?.defaultModel ?? '',
    commandArgs: cat?.commandArgs?.join(' ') ?? '',
  };
}

export function HubCatEditor({ cat, open, onClose, onSaved }: HubCatEditorProps) {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => initialState(cat));

  useEffect(() => {
    if (!open) return;
    setForm(initialState(cat));
  }, [open, cat]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProfiles(true);
    setError(null);
    apiFetch('/api/provider-profiles')
      .then(async (res) => {
        if (!res.ok) throw new Error(`账号配置加载失败 (${res.status})`);
        return (await res.json()) as ProviderProfilesResponse;
      })
      .then((body) => {
        if (!cancelled) setProfiles(body.providers);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '账号配置加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const availableProfiles = useMemo(() => filterProfiles(form.client, profiles), [form.client, profiles]);
  const selectedProfile = useMemo(
    () => availableProfiles.find((profile) => profile.id === form.providerProfileId) ?? null,
    [availableProfiles, form.providerProfileId],
  );

  useEffect(() => {
    if (form.client === 'antigravity') {
      if (form.providerProfileId !== '') {
        setForm((prev) => ({ ...prev, providerProfileId: '' }));
      }
      return;
    }
    if (availableProfiles.length === 0) return;
    const hasSelected = availableProfiles.some((profile) => profile.id === form.providerProfileId);
    if (!hasSelected) {
      const nextProfile = availableProfiles[0];
      setForm((prev) => ({
        ...prev,
        providerProfileId: nextProfile?.id ?? '',
        defaultModel: prev.defaultModel || nextProfile?.models[0] || prev.defaultModel,
      }));
    }
  }, [availableProfiles, form.client, form.providerProfileId]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const common = {
      name: form.name.trim(),
      displayName: form.displayName.trim(),
      avatar: form.avatar.trim(),
      color: {
        primary: form.colorPrimary.trim(),
        secondary: form.colorSecondary.trim(),
      },
      mentionPatterns: splitMentionPatterns(form.mentionPatterns),
      roleDescription: form.roleDescription.trim(),
      personality: form.personality.trim(),
    };
    try {
      const body =
        form.client === 'antigravity'
          ? {
              ...common,
              ...(cat ? {} : { catId: form.catId.trim() }),
              client: 'antigravity',
              defaultModel: form.defaultModel.trim(),
              commandArgs: splitCommandArgs(form.commandArgs),
            }
          : {
              ...common,
              ...(cat ? {} : { catId: form.catId.trim() }),
              client: form.client,
              providerProfileId: form.providerProfileId || undefined,
              defaultModel: form.defaultModel.trim(),
            };
      const res = await apiFetch(cat ? `/api/cats/${cat.id}` : '/api/cats', {
        method: cat ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((payload.error as string) ?? `保存失败 (${res.status})`);
        return;
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!cat) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/cats/${cat.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((payload.error as string) ?? `删除失败 (${res.status})`);
        return;
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{cat ? '成员配置' : '添加成员'}</h3>
            <p className="text-xs text-gray-500 mt-1">运行时修改会即时写入 `.cat-cafe/cat-catalog.json`。</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="关闭">
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!cat ? (
              <label className="text-sm text-gray-700 space-y-1">
                <span className="font-medium">Cat ID</span>
                <input
                  aria-label="Cat ID"
                  value={form.catId}
                  onChange={(event) => setForm((prev) => ({ ...prev, catId: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            ) : null}
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Name</span>
              <input
                aria-label="Name"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Display Name</span>
              <input
                aria-label="Display Name"
                value={form.displayName}
                onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Avatar</span>
              <input
                aria-label="Avatar"
                value={form.avatar}
                onChange={(event) => setForm((prev) => ({ ...prev, avatar: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Primary Color</span>
              <input
                aria-label="Primary Color"
                value={form.colorPrimary}
                onChange={(event) => setForm((prev) => ({ ...prev, colorPrimary: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Secondary Color</span>
              <input
                aria-label="Secondary Color"
                value={form.colorSecondary}
                onChange={(event) => setForm((prev) => ({ ...prev, colorSecondary: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block text-sm text-gray-700 space-y-1">
            <span className="font-medium">Description</span>
            <input
              aria-label="Description"
              value={form.roleDescription}
              onChange={(event) => setForm((prev) => ({ ...prev, roleDescription: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm text-gray-700 space-y-1">
            <span className="font-medium">Personality</span>
            <input
              aria-label="Personality"
              value={form.personality}
              onChange={(event) => setForm((prev) => ({ ...prev, personality: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm text-gray-700 space-y-1">
            <span className="font-medium">Aliases</span>
            <textarea
              aria-label="Aliases"
              value={form.mentionPatterns}
              onChange={(event) => setForm((prev) => ({ ...prev, mentionPatterns: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[72px]"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="text-sm text-gray-700 space-y-1">
              <span className="font-medium">Client</span>
              <select
                aria-label="Client"
                value={form.client}
                onChange={(event) => setForm((prev) => ({ ...prev, client: event.target.value as ClientValue }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {CLIENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {form.client === 'antigravity' ? (
              <>
                <label className="md:col-span-2 text-sm text-gray-700 space-y-1">
                  <span className="font-medium">CLI Command</span>
                  <input
                    aria-label="CLI Command"
                    value={form.commandArgs}
                    onChange={(event) => setForm((prev) => ({ ...prev, commandArgs: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm text-gray-700 space-y-1">
                  <span className="font-medium">Model</span>
                  <input
                    aria-label="Model"
                    value={form.defaultModel}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-sm text-gray-700 space-y-1">
                  <span className="font-medium">Provider</span>
                  <select
                    aria-label="Provider"
                    value={form.providerProfileId}
                    onChange={(event) => setForm((prev) => ({ ...prev, providerProfileId: event.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    disabled={loadingProfiles || availableProfiles.length === 0}
                  >
                    <option value="">未绑定</option>
                    {availableProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-gray-700 space-y-1">
                  <span className="font-medium">Model</span>
                  {selectedProfile?.models.length ? (
                    <select
                      aria-label="Model"
                      value={form.defaultModel}
                      onChange={(event) => setForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      {selectedProfile.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label="Model"
                      value={form.defaultModel}
                      onChange={(event) => setForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  )}
                </label>
              </>
            )}
          </div>

          {error ? <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50">
          <div>{loadingProfiles ? <span className="text-xs text-gray-500">账号配置加载中…</span> : null}</div>
          <div className="flex gap-2">
            {cat ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                删除成员
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
