'use client';
import { useState } from 'react';
import { uploadAvatarAsset, uploadRefAudioAsset } from '../../hub-cat-editor.client';
import { autoSlug, type HubCatEditorFormState, type StrategyFormState } from '../../hub-cat-editor.model';
import { SelectField, TextField } from '../../hub-cat-editor-fields';
import type { MemberText } from './MemberRuntimeFields';

type StringField = {
  [K in keyof HubCatEditorFormState]: HubCatEditorFormState[K] extends string ? K : never;
}[keyof HubCatEditorFormState];
type Field = [NonNullable<StringField>, string, string];
const identityFields: Field[] = [
  ['nickname', '昵称', 'Nickname'],
  ['mentionPatterns', '呼叫别名', 'Mention aliases'],
  ['roleDescription', '职责', 'Role'],
  ['personality', '个性', 'Personality'],
  ['teamStrengths', '团队分工', 'Team contribution'],
  ['strengths', '擅长（逗号分隔）', 'Strengths (comma separated)'],
  ['caution', '限制与注意事项', 'Limitations'],
  ['variantLabel', '版本备注', 'Version label'],
];
const voiceFields: Field[] = [
  ['voiceVoice', '语音', 'Voice'],
  ['voiceLangCode', '语言代码', 'Language code'],
  ['voiceSpeed', '语速', 'Speed'],
  ['voiceRefAudio', '参考音频', 'Reference audio'],
  ['voiceRefText', '参考文本', 'Reference text'],
  ['voiceInstruct', '语音指令', 'Voice instruction'],
  ['voiceTemperature', '温度', 'Temperature'],
];

export function MemberAdditionalFields({
  section,
  form,
  patch,
  t,
  editing,
  strategy,
  patchStrategy,
}: {
  section: string;
  form: HubCatEditorFormState;
  patch: (change: Partial<HubCatEditorFormState>) => void;
  t: MemberText;
  editing: boolean;
  strategy: StrategyFormState | null | undefined;
  patchStrategy: (change: Partial<StrategyFormState>) => void;
}) {
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fields = (items: Field[]) =>
    items.map(([key, zh, en]) => (
      <TextField
        key={key}
        label={t(zh, en)}
        value={String(form[key] ?? '')}
        onChange={(value) => patch({ [key]: value })}
      />
    ));
  const upload = async (file: File, kind: 'avatar' | 'audio') => {
    setUploading(true);
    setUploadError('');
    try {
      patch(
        kind === 'avatar'
          ? { avatar: await uploadAvatarAsset(file) }
          : { voiceRefAudio: (await uploadRefAudioAsset(file)).url },
      );
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('上传失败', 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };
  if (section === 'identity')
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t('身份与职责', 'Identity & role')}</h2>
        {editing && <p className="text-sm text-cafe-secondary">ID · {form.catId}</p>}
        <TextField
          label={t('名字', 'Name')}
          value={form.name}
          onChange={(name) => {
            const id = autoSlug(name, form.catId);
            patch({
              name,
              displayName: name,
              ...(!editing
                ? {
                    catId: id,
                    ...(!form.mentionPatterns || form.mentionPatterns === `@${form.catId}`
                      ? { mentionPatterns: `@${id}` }
                      : {}),
                  }
                : {}),
            });
          }}
        />
        {fields(identityFields)}
        <details className="rounded-xl border border-[var(--console-border-soft)] p-4" open>
          <summary className="mb-4 cursor-pointer text-sm">
            {t('外观', 'Appearance')} · {form.colorPrimary}
          </summary>
          <div className="space-y-4">
            <TextField label={t('头像', 'Avatar')} value={form.avatar} onChange={(avatar) => patch({ avatar })} />
            <label className="block text-sm">
              {t('上传头像', 'Upload avatar')}
              <input
                className="mt-2 block w-full text-sm"
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file, 'avatar');
                }}
              />
            </label>
            <label className="flex items-center gap-3 text-sm">
              {t('成员主色', 'Member color')}
              <input
                type="color"
                value={form.colorPrimary}
                onChange={(event) => patch({ colorPrimary: event.target.value })}
              />
              <span className="rounded-full border px-4 py-2" style={{ color: form.colorPrimary }}>
                {form.name || t('我的伙伴', 'My teammate')}
              </span>
            </label>
          </div>
        </details>
        {uploadError && (
          <p role="alert" className="text-sm text-conn-red-text">
            {uploadError}
          </p>
        )}
      </div>
    );
  if (section === 'voice')
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t('语音', 'Voice')}</h2>
        <p className="text-sm text-cafe-secondary">
          {t(
            '语音独立于运行工具；换工具或模型时保留。',
            'Voice stays with this teammate when changing tools or models.',
          )}
        </p>
        {fields(voiceFields)}
        <label className="block text-sm">
          {t('上传参考音频', 'Upload reference audio')}
          <input
            className="mt-2 block w-full text-sm"
            type="file"
            accept="audio/*"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file, 'audio');
            }}
          />
        </label>
        {uploadError && (
          <p role="alert" className="text-sm text-conn-red-text">
            {uploadError}
          </p>
        )}
      </div>
    );
  if (section === 'context')
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t('上下文与会话', 'Context & sessions')}</h2>
        <TextField
          label={t('上下文上限', 'Context limit')}
          value={form.contextWindow}
          onChange={(contextWindow) => patch({ contextWindow })}
          placeholder={t('自动（工具报告）', 'Auto (reported by the tool)')}
          inputMode="numeric"
        />
        <p className="text-sm text-cafe-secondary">
          {t(
            '连续会话由下面的会话策略管理，历史配置保留。',
            'Session continuity follows the policy below; legacy configuration is preserved.',
          )}
        </p>
        {strategy ? (
          <>
            <SelectField
              label={t('会话策略', 'Session strategy')}
              value={strategy.strategy}
              options={[
                { value: 'handoff', label: t('交接', 'Handoff') },
                { value: 'compress', label: t('压缩', 'Compress') },
                { value: 'hybrid', label: t('混合', 'Hybrid') },
              ]}
              onChange={(value) => patchStrategy({ strategy: value as StrategyFormState['strategy'] })}
            />
            <TextField
              label={t('提醒阈值', 'Warning threshold')}
              value={strategy.warnThreshold}
              onChange={(warnThreshold) => patchStrategy({ warnThreshold })}
            />
            <TextField
              label={t('执行阈值', 'Action threshold')}
              value={strategy.actionThreshold}
              onChange={(actionThreshold) => patchStrategy({ actionThreshold })}
            />
            <TextField
              label={t('最大压缩次数', 'Maximum compressions')}
              value={strategy.maxCompressions}
              onChange={(maxCompressions) => patchStrategy({ maxCompressions })}
            />
            <p className="text-sm text-cafe-secondary">
              {t(
                '这是会话策略意图；实际执行由所选工具能力决定。',
                'This is the saved policy. Execution depends on the selected adapter capabilities.',
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-cafe-secondary">
            {editing
              ? t('会话策略未读取，保存其他字段不会修改它。', 'Session policy is not loaded and will be preserved.')
              : t('创建后可配置会话策略。', 'Session policy is available after creation.')}
          </p>
        )}
      </div>
    );
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">{t('高级接入', 'Advanced connection')}</h2>
      <p className="text-sm text-cafe-secondary">
        {t(
          '接入方式决定协议；启动程序与参数不会自动改变协议。',
          'The adapter defines the protocol. A program name does not change it.',
        )}
      </p>
      <SelectField
        label={t('接入方式', 'Adapter')}
        value={form.acpEnabled ? 'acp' : form.clientId === 'openai' ? form.codexCarrier || 'app_server' : 'native'}
        options={
          form.clientId === 'openai'
            ? [
                { value: 'app_server', label: 'Codex App Server' },
                { value: 'exec_json', label: 'Codex exec' },
                { value: 'acp', label: 'ACP' },
              ]
            : [
                {
                  value: 'native',
                  label:
                    form.clientId === 'anthropic'
                      ? t('Claude 原生接入（沿用服务设置）', 'Claude native (existing carrier)')
                      : t('原生接入', 'Native adapter'),
                  disabled: form.clientId === 'acp',
                },
                { value: 'acp', label: 'ACP' },
              ]
        }
        onChange={(value) =>
          patch({
            acpEnabled: value === 'acp',
            ...(value === 'app_server' || value === 'exec_json' ? { codexCarrier: value } : {}),
          })
        }
      />
      {form.acpEnabled && (
        <>
          <TextField
            label={t('启动程序', 'Program')}
            value={form.acpCommand}
            onChange={(acpCommand) => patch({ acpCommand })}
          />
          <TextField
            label={t('启动参数', 'Arguments')}
            value={form.acpStartupArgs}
            onChange={(acpStartupArgs) => patch({ acpStartupArgs })}
          />
          <p className="text-sm text-cafe-secondary">
            {t(
              '含空格的参数使用引号；保留已有 profile。',
              'Quote arguments containing spaces; preserve your existing profile.',
            )}
          </p>
          <SelectField
            label={t('传输', 'Transport')}
            value={form.acpTransport}
            options={[
              { value: 'stdio', label: 'stdio' },
              { value: 'httpstream', label: 'HTTP stream' },
            ]}
            onChange={(value) => patch({ acpTransport: value as 'stdio' | 'httpstream' })}
          />
          {fields([
            ['acpMaxLiveProcesses', '最大进程数', 'Maximum processes'],
            ['acpIdleTtlMinutes', '空闲分钟数', 'Idle timeout (minutes)'],
          ])}
        </>
      )}
      {!form.acpEnabled && (
        <label className="block text-sm">
          {t('额外 CLI 参数（每行一项）', 'Extra CLI arguments (one per line)')}
          <textarea
            className="mt-2 block min-h-24 w-full rounded-lg bg-[var(--console-field-bg)] p-3"
            value={form.cliConfigArgs.join('\n')}
            onChange={(event) => patch({ cliConfigArgs: event.target.value.split('\n') })}
          />
        </label>
      )}
      {form.clientId === 'opencode' && fields([['provider', '供应商标识', 'Provider ID']])}
      {form.clientId === 'antigravity' && fields([['commandArgs', '启动参数', 'Arguments']])}
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.mcpSupport}
          onChange={(event) => patch({ mcpSupport: event.target.checked })}
        />
        MCP
      </label>
      <p className="text-sm text-cafe-secondary">
        {t(
          '已有权限、沙箱和未显示的扩展配置会保留。账号凭据在“账户与密钥”管理。',
          'Existing permissions, sandbox and unlisted extensions are preserved. Manage credentials in Accounts & keys.',
        )}
      </p>
    </div>
  );
}
