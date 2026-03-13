import { useCallback, useState } from 'react';
import type { ProfileItem, ProfileMode, ProfileTestResult } from './hub-provider-profiles.types';

export interface ProfileEditPayload {
  name: string;
  mode: ProfileMode;
  baseUrl?: string;
  apiKey?: string;
  modelOverride?: string | null;
}

interface HubProviderProfileItemProps {
  profile: ProfileItem;
  isActive: boolean;
  busy: boolean;
  testResult?: ProfileTestResult;
  onActivate: (profileId: string) => void;
  onSave: (profileId: string, payload: ProfileEditPayload) => Promise<void>;
  onTest: (profileId: string) => void;
  onDelete: (profileId: string) => void;
}

export function HubProviderProfileItem({
  profile,
  isActive,
  busy,
  testResult,
  onActivate,
  onSave,
  onTest,
  onDelete,
}: HubProviderProfileItemProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(profile.name);
  const [editMode, setEditMode] = useState<ProfileMode>(profile.mode);
  const [editBaseUrl, setEditBaseUrl] = useState(profile.baseUrl ?? '');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModelOverride, setEditModelOverride] = useState(profile.modelOverride ?? '');

  const startEdit = useCallback(() => {
    setEditName(profile.name);
    setEditMode(profile.mode);
    setEditBaseUrl(profile.baseUrl ?? '');
    setEditApiKey('');
    setEditModelOverride(profile.modelOverride ?? '');
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => setEditing(false), []);

  const saveEdit = useCallback(async () => {
    await onSave(profile.id, {
      name: editName.trim(),
      mode: editMode,
      ...(editMode === 'api_key' && editBaseUrl.trim() ? { baseUrl: editBaseUrl.trim() } : {}),
      ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
      modelOverride: editModelOverride.trim() || null,
    });
    setEditing(false);
  }, [onSave, profile.id, editName, editMode, editBaseUrl, editApiKey, editModelOverride]);

  const inputCls = 'px-2 py-1 rounded border border-gray-200 bg-white text-xs w-full';

  if (editing) {
    return (
      <div className="rounded-lg border-2 border-blue-300 bg-blue-50/30 p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="名称"
            className={inputCls}
          />
          <select value={editMode} onChange={(e) => setEditMode(e.target.value as ProfileMode)} className={inputCls}>
            <option value="subscription">subscription（自有订阅）</option>
            <option value="api_key">api_key（赞助 API）</option>
          </select>
          {editMode === 'api_key' && (
            <>
              <input
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                placeholder="Base URL"
                className={`${inputCls} md:col-span-2`}
              />
              <input
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                placeholder={profile.hasApiKey ? 'API Key（留空保持不变）' : 'API Key'}
                className={`${inputCls} md:col-span-2`}
              />
            </>
          )}
          <input
            value={editModelOverride}
            onChange={(e) => setEditModelOverride(e.target.value)}
            placeholder="模型覆盖（可选，例如 opus[1m]）"
            className={`${inputCls} md:col-span-2`}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveEdit}
            disabled={busy}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '保存中...' : '保存'}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className="px-3 py-1 rounded border border-gray-200 text-gray-600 text-xs hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800">{profile.name}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{profile.mode}</span>
            {isActive && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">active</span>}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {profile.mode === 'api_key'
              ? `baseUrl: ${profile.baseUrl ?? '(未设置)'} · apiKey: ${profile.hasApiKey ? '已配置' : '未配置'}`
              : '走本机订阅登录态（不使用 API key）'}
          </p>
          {profile.modelOverride && <p className="text-xs text-indigo-600 mt-0.5">model: {profile.modelOverride}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {!isActive && (
            <button
              type="button"
              className="px-2 py-1 rounded border border-blue-200 text-blue-700 text-xs hover:bg-blue-50"
              onClick={() => onActivate(profile.id)}
              disabled={busy}
            >
              激活
            </button>
          )}
          <button
            type="button"
            className="px-2 py-1 rounded border border-gray-200 text-gray-700 text-xs hover:bg-gray-50"
            onClick={startEdit}
            disabled={busy}
          >
            编辑
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border border-indigo-200 text-indigo-700 text-xs hover:bg-indigo-50"
            onClick={() => onTest(profile.id)}
            disabled={busy}
          >
            测试
          </button>
          {profile.id !== 'anthropic-subscription-default' && (
            <button
              type="button"
              className="px-2 py-1 rounded border border-red-200 text-red-700 text-xs hover:bg-red-50"
              onClick={() => onDelete(profile.id)}
              disabled={busy}
            >
              删除
            </button>
          )}
        </div>
      </div>

      {testResult && (
        <p className={`text-xs mt-2 ${testResult.ok ? 'text-green-700' : 'text-red-600'}`}>
          {testResult.ok
            ? `测试通过${testResult.status ? ` (HTTP ${testResult.status})` : ''}`
            : `测试失败${testResult.status ? ` (HTTP ${testResult.status})` : ''}${testResult.error ? `: ${testResult.error}` : ''}`}
        </p>
      )}
    </div>
  );
}
