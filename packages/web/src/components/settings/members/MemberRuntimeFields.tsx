'use client';
import { getCliEffortOptionsForProvider } from '@cat-cafe/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import type { ProfileItem } from '../../hub-accounts.types';
import { serializeCommandArgs } from '../../hub-cat-editor.acp';
import {
  builtinAccountIdForClient,
  filterAccounts,
  type HubCatEditorFormState,
  splitCommandArgs,
} from '../../hub-cat-editor.model';
import { SelectField, TextField } from '../../hub-cat-editor-fields';

interface RuntimeChoice {
  id: string;
  label: string;
  clientId: HubCatEditorFormState['clientId'];
  installed: boolean;
  models: string[];
  configuredModel?: string;
  configuredEffort?: string;
  acp?: { command: string; startupArgs: string[]; transport?: 'stdio' | 'httpstream' };
}
export type MemberText = (zh: string, en: string) => string;

export function MemberRuntimeFields({
  form,
  accounts,
  patch,
  t,
  accountHref,
  editing,
}: {
  form: HubCatEditorFormState;
  accounts: ProfileItem[];
  patch: (value: Partial<HubCatEditorFormState>) => void;
  t: MemberText;
  accountHref: string;
  editing: boolean;
}) {
  const [runtimes, setRuntimes] = useState<RuntimeChoice[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pendingTool, setPendingTool] = useState<RuntimeChoice | null>(null);
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError(false);
    apiFetch('/api/cats/native-runtimes')
      .then(async (res) => {
        if (!res.ok) throw new Error('discovery');
        const data = (await res.json()) as { runtimes: RuntimeChoice[] };
        if (!stopped) setRuntimes(data.runtimes);
      })
      .catch(() => {
        if (!stopped) setError(true);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [refresh]);
  const native = form.configurationSource === 'native_tool';
  const selected = runtimes.find(
    (item) =>
      item.clientId === form.clientId &&
      (!form.acpEnabled ||
        (item.acp?.command === form.acpCommand &&
          JSON.stringify(item.acp.startupArgs) === JSON.stringify(splitCommandArgs(form.acpStartupArgs)))),
  );
  const availableAccounts = filterAccounts(form.clientId, accounts);
  const choices = runtimes.map((item) => ({
    value: item.id,
    label: `${item.label} · ${item.installed ? t('已发现', 'Detected') : t('未发现', 'Not found')}`,
  }));
  if (!selected)
    choices.unshift({ value: 'current', label: `${form.clientId} · ${t('保留当前接入', 'Keep current adapter')}` });
  const identity = availableAccounts.find((item) => item.id === form.accountRef);
  const defaultRef = builtinAccountIdForClient(form.clientId);
  const canPreviewDefaults = !form.accountRef || form.accountRef === defaultRef;
  const applyTool = (tool: RuntimeChoice) => {
    patch({
      clientId: tool.clientId,
      accountRef: '',
      configurationSource: 'native_tool',
      defaultModel: '',
      cliEffort: '',
      cliConfigArgs: [],
      codexCarrier: tool.clientId === 'openai' ? 'app_server' : '',
      acpEnabled: Boolean(tool.acp),
      ...(tool.acp
        ? {
            acpCommand: tool.acp.command,
            acpStartupArgs: serializeCommandArgs(tool.acp.startupArgs),
            acpTransport: tool.acp.transport ?? 'stdio',
          }
        : {}),
    });
    setPendingTool(null);
  };
  const accountOptions = [
    { value: '', label: t('工具当前身份', 'Current tool identity'), disabled: false },
    ...availableAccounts.map((item) => ({
      value: item.id,
      label: item.displayName || item.name,
      disabled: native && item.authType === 'oauth' && item.id !== defaultRef,
    })),
  ];
  if (form.accountRef && !identity)
    accountOptions.push({
      value: form.accountRef,
      label: `${form.accountRef} · ${t('暂不可读取', 'Unavailable')}`,
      disabled: false,
    });
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-cafe">{t('模型与接入', 'Model & connection')}</h2>
        <button type="button" onClick={() => setRefresh((v) => v + 1)} className="text-sm text-cafe-accent">
          {t('重新探测', 'Refresh tools')}
        </button>
      </div>
      <SelectField
        label={t('运行工具', 'Tool')}
        value={selected?.id ?? 'current'}
        options={choices}
        onChange={(value) => {
          const tool = runtimes.find((item) => item.id === value);
          if (!tool || value === selected?.id) return;
          if (editing || form.accountRef || form.defaultModel || form.cliEffort) setPendingTool(tool);
          else applyTool(tool);
        }}
      />
      {loading ? (
        <p role="status" className="text-sm text-cafe-secondary">
          {t('正在探测本机工具…', 'Detecting installed tools…')}
        </p>
      ) : (
        <p role="status" className="text-sm text-cafe-secondary">
          {error
            ? t(
                '探测暂不可用，现有配置仍保留。可原位重试。',
                'Discovery unavailable. Your configuration is preserved; retry here.',
              )
            : t(
                '安装、登录与可调用分别验证；发现工具不代表已登录。',
                'Installation, authentication and invocation are verified separately.',
              )}
        </p>
      )}
      {pendingTool && (
        <div role="alert" className="space-y-3 rounded-xl border border-[var(--console-border-soft)] p-4">
          <p className="text-sm">
            {t(
              `切换为 ${pendingTool.label}：执行身份恢复为工具当前身份，模型和强度恢复跟随。名字、职责、语音和会话设置保留。`,
              `Switch to ${pendingTool.label}: use its current identity and inherit model/effort. Keep identity, voice and session settings.`,
            )}
          </p>
          <button type="button" onClick={() => applyTool(pendingTool)} className="mr-5 text-sm text-cafe-accent">
            {t('确认变更', 'Confirm changes')}
          </button>
          <button type="button" onClick={() => setPendingTool(null)} className="text-sm">
            {t('取消', 'Cancel')}
          </button>
        </div>
      )}
      <SelectField
        label={t('执行身份', 'Execution identity')}
        value={form.accountRef}
        options={accountOptions}
        onChange={(accountRef) => patch({ accountRef })}
      />
      {availableAccounts.some((item) => item.authType === 'oauth' && item.id !== defaultRef) && (
        <p className="text-sm text-cafe-secondary">
          {t(
            '独立订阅身份切换等待账号隔离接口；当前工具身份和 API 账号可用。',
            'Separate subscription identities require account isolation support. Current tool identity and API accounts are available.',
          )}
        </p>
      )}
      <Link href={accountHref} className="inline-flex min-h-10 items-center text-sm text-cafe-accent">
        {t('添加或登录账号 ↗', 'Add or sign in to an account ↗')}
      </Link>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <TextField
            label={t('模型', 'Model')}
            value={form.defaultModel}
            onChange={(defaultModel) => patch({ defaultModel })}
            placeholder={t('跟随工具设置', 'Inherit tool settings')}
            suggestions={identity?.models ?? selected?.models ?? []}
          />
          <button
            type="button"
            onClick={() =>
              patch({
                defaultModel: '',
                ...(['openai', 'anthropic', 'acp'].includes(form.clientId)
                  ? { configurationSource: 'native_tool' }
                  : {}),
              })
            }
            className="text-sm text-cafe-accent"
          >
            {t('模型恢复跟随', 'Inherit model')}
          </button>
        </div>
        <div className="space-y-2">
          <TextField
            label={t('思考强度', 'Reasoning effort')}
            value={form.cliEffort}
            onChange={(cliEffort) => patch({ cliEffort })}
            placeholder={t('跟随工具设置', 'Inherit tool settings')}
            suggestions={getCliEffortOptionsForProvider(form.clientId, form.defaultModel) ?? []}
          />
          <button
            type="button"
            onClick={() =>
              patch({
                cliEffort: '',
                ...(['openai', 'anthropic', 'acp'].includes(form.clientId)
                  ? { configurationSource: 'native_tool' }
                  : {}),
              })
            }
            className="text-sm text-cafe-accent"
          >
            {t('强度恢复跟随', 'Inherit effort')}
          </button>
        </div>
      </div>
      <p className="text-sm text-cafe-secondary">
        {t(
          '模型与强度可分别调整，恢复跟随不会更换账号。',
          'Model and effort are independent. Resetting either keeps your account.',
        )}
      </p>
      <div className="rounded-xl bg-[var(--console-field-bg)] p-4 text-sm">
        <strong>{t('下次调用预览', 'Next invocation preview')}</strong>
        <p className="mt-2 break-words">
          {form.defaultModel ||
            (canPreviewDefaults ? selected?.configuredModel : '') ||
            t('工具默认 · 具体值待运行确认', 'Tool default · value confirmed at runtime')}
          {' · '}
          {form.cliEffort || (canPreviewDefaults ? selected?.configuredEffort : '') || t('默认强度', 'Default effort')}
        </p>
        <p className="mt-1 text-cafe-secondary">
          {t(
            '来自当前草稿与可读取的工具配置；不是当前会话的实际采用值。',
            'From the draft and readable tool configuration; not a current-session receipt.',
          )}
        </p>
      </div>
      {!native && (
        <p className="text-sm text-cafe-secondary">
          {t(
            '当前使用已有服务账号配置。保留此配置可继续使用。',
            'Your existing account configuration remains supported.',
          )}
        </p>
      )}
      <details className="rounded-xl border border-[var(--console-border-soft)] p-3">
        <summary className="cursor-pointer text-sm">
          {t('默认值来源', 'Default-value source')} ·{' '}
          {native ? t('跟随工具', 'Tool settings') : t('已有配置', 'Existing settings')}
        </summary>
        <SelectField
          label={t('默认值规则', 'Default policy')}
          value={form.configurationSource ?? 'managed_account'}
          options={[
            { value: 'native_tool', label: t('跟随所选工具环境', 'Inherit selected tool environment') },
            { value: 'managed_account', label: t('保留应用账号默认规则', 'Use existing application account defaults') },
          ]}
          onChange={(value) => patch({ configurationSource: value as HubCatEditorFormState['configurationSource'] })}
        />
      </details>
    </div>
  );
}
