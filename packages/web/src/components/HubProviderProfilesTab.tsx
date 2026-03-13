'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { HubClaudeRescueSection } from './HubClaudeRescueSection';
import { HubProviderProfileItem, type ProfileEditPayload } from './HubProviderProfileItem';
import type { ProfileMode, ProfileTestResult, ProviderProfilesResponse } from './hub-provider-profiles.types';
import { getProjectPaths, projectDisplayName } from './ThreadSidebar/thread-utils';

export function HubProviderProfilesTab() {
  const threads = useChatStore((s) => s.threads);
  const knownProjects = useMemo(() => getProjectPaths(threads), [threads]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProviderProfilesResponse | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testResultById, setTestResultById] = useState<Record<string, ProfileTestResult>>({});

  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<ProfileMode>('subscription');
  const [createBaseUrl, setCreateBaseUrl] = useState('');
  const [createApiKey, setCreateApiKey] = useState('');
  const [createModelOverride, setCreateModelOverride] = useState('');

  const fetchProfiles = useCallback(async (forProject?: string) => {
    setError(null);
    try {
      const query = new URLSearchParams();
      if (forProject) query.set('projectPath', forProject);
      const res = await apiFetch(`/api/provider-profiles?${query.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((body.error as string) ?? '加载失败');
        return;
      }
      const body = (await res.json()) as ProviderProfilesResponse;
      setData(body);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const switchProject = useCallback(
    (nextPath: string | null) => {
      setProjectPath(nextPath);
      setLoading(true);
      fetchProfiles(nextPath ?? undefined);
    },
    [fetchProfiles],
  );

  const callApi = useCallback(async (path: string, init: RequestInit) => {
    const res = await apiFetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error((body.error as string) ?? `请求失败 (${res.status})`);
    }
    return body;
  }, []);

  const refresh = useCallback(async () => {
    await fetchProfiles(projectPath ?? undefined);
  }, [fetchProfiles, projectPath]);

  const createProfile = useCallback(async () => {
    if (!createName.trim()) {
      setError('请输入 profile 名称');
      return;
    }
    if (createMode === 'api_key' && (!createBaseUrl.trim() || !createApiKey.trim())) {
      setError('api_key 模式需要填写 baseUrl 和 apiKey');
      return;
    }
    setBusyId('create');
    setError(null);
    try {
      await callApi('/api/provider-profiles', {
        method: 'POST',
        body: JSON.stringify({
          projectPath: projectPath ?? undefined,
          provider: 'anthropic',
          name: createName.trim(),
          mode: createMode,
          ...(createBaseUrl.trim() ? { baseUrl: createBaseUrl.trim() } : {}),
          ...(createApiKey.trim() ? { apiKey: createApiKey.trim() } : {}),
          ...(createModelOverride.trim() ? { modelOverride: createModelOverride.trim() } : {}),
          setActive: true,
        }),
      });
      setCreateName('');
      setCreateBaseUrl('');
      setCreateApiKey('');
      setCreateModelOverride('');
      setCreateMode('subscription');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, [callApi, createApiKey, createBaseUrl, createMode, createModelOverride, createName, projectPath, refresh]);

  const activateProfile = useCallback(
    async (profileId: string) => {
      setBusyId(profileId);
      setError(null);
      try {
        await callApi(`/api/provider-profiles/${profileId}/activate`, {
          method: 'POST',
          body: JSON.stringify({
            projectPath: projectPath ?? undefined,
            provider: 'anthropic',
          }),
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [callApi, projectPath, refresh],
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      setBusyId(profileId);
      setError(null);
      try {
        await callApi(`/api/provider-profiles/${profileId}`, {
          method: 'DELETE',
          body: JSON.stringify({
            projectPath: projectPath ?? undefined,
            provider: 'anthropic',
          }),
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [callApi, projectPath, refresh],
  );

  const saveProfile = useCallback(
    async (profileId: string, payload: ProfileEditPayload) => {
      setBusyId(profileId);
      setError(null);
      try {
        await callApi(`/api/provider-profiles/${profileId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            projectPath: projectPath ?? undefined,
            provider: 'anthropic',
            ...payload,
          }),
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [callApi, projectPath, refresh],
  );

  const testProfile = useCallback(
    async (profileId: string) => {
      setBusyId(profileId);
      setError(null);
      try {
        const body = (await callApi(`/api/provider-profiles/${profileId}/test`, {
          method: 'POST',
          body: JSON.stringify({
            projectPath: projectPath ?? undefined,
            provider: 'anthropic',
          }),
        })) as unknown as ProfileTestResult;
        setTestResultById((prev) => ({ ...prev, [profileId]: body }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [callApi, projectPath],
  );

  const allPaths = useMemo(() => {
    const paths = new Set<string>();
    if (data?.projectPath) paths.add(data.projectPath);
    for (const p of knownProjects) paths.add(p);
    return [...paths];
  }, [data?.projectPath, knownProjects]);

  if (loading) return <p className="text-sm text-gray-400">加载中...</p>;
  if (!data) return <p className="text-sm text-gray-400">暂无数据</p>;

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-xs font-semibold text-gray-700">布偶猫账号配置</h3>
          {allPaths.length > 1 ? (
            <select
              value={projectPath ?? ''}
              onChange={(e) => switchProject(e.target.value || null)}
              className="px-2 py-1 rounded border border-gray-200 bg-white text-xs text-gray-700"
            >
              <option value="">{projectDisplayName(data.projectPath)}</option>
              {allPaths
                .filter((p) => p !== data.projectPath || projectPath !== null)
                .map((p) => (
                  <option key={p} value={p}>
                    {projectDisplayName(p)}
                  </option>
                ))}
            </select>
          ) : (
            <span className="text-[11px] text-gray-400">{projectDisplayName(data.projectPath)}</span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          secrets 存储在 `.cat-cafe/provider-profiles.secrets.local.json`（本机落盘，Git 忽略）
        </p>
        <p className="text-xs text-amber-700 mt-1">
          提示：点击“测试”会使用对应 profile 的 API key 向 baseUrl 发起请求，请确认目标地址可信。
        </p>
      </div>

      <HubClaudeRescueSection />

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-2">
        <h4 className="text-xs font-semibold text-gray-700">新建 Profile</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="名称（例如 赞助-A）"
            className="px-2 py-1.5 rounded border border-gray-200 bg-white text-xs"
          />
          <select
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as ProfileMode)}
            className="px-2 py-1.5 rounded border border-gray-200 bg-white text-xs"
          >
            <option value="subscription">subscription（自有订阅）</option>
            <option value="api_key">api_key（赞助 API）</option>
          </select>
          {createMode === 'api_key' && (
            <>
              <input
                value={createBaseUrl}
                onChange={(e) => setCreateBaseUrl(e.target.value)}
                placeholder="Base URL"
                className="px-2 py-1.5 rounded border border-gray-200 bg-white text-xs md:col-span-2"
              />
              <input
                value={createApiKey}
                onChange={(e) => setCreateApiKey(e.target.value)}
                placeholder="API Key"
                className="px-2 py-1.5 rounded border border-gray-200 bg-white text-xs md:col-span-2"
              />
            </>
          )}
          <input
            value={createModelOverride}
            onChange={(e) => setCreateModelOverride(e.target.value)}
            placeholder="模型覆盖（可选，例如 opus[1m]）"
            className="px-2 py-1.5 rounded border border-gray-200 bg-white text-xs md:col-span-2"
          />
        </div>
        <button
          type="button"
          onClick={createProfile}
          disabled={busyId === 'create'}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
        >
          {busyId === 'create' ? '创建中...' : '创建并激活'}
        </button>
      </div>

      <div className="space-y-2">
        {data.anthropic.profiles.map((profile) => {
          const isActive = data.anthropic.activeProfileId === profile.id;
          const testResult = testResultById[profile.id];
          return (
            <HubProviderProfileItem
              key={profile.id}
              profile={profile}
              isActive={isActive}
              busy={busyId === profile.id}
              testResult={testResult}
              onActivate={activateProfile}
              onSave={saveProfile}
              onTest={testProfile}
              onDelete={deleteProfile}
            />
          );
        })}
      </div>
    </div>
  );
}
