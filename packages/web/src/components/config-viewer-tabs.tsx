import { type ReactNode } from 'react';
import type { CatData } from '@/hooks/useCatData';
import type { ConfigData } from './config-viewer-types';

export type { Capabilities, CatConfig, ConfigData, ContextBudget } from './config-viewer-types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
      <h3 className="text-xs font-semibold text-gray-700 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string | number | boolean }) {
  const display = typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  return (
    <div className="flex justify-between text-xs text-gray-700">
      <span>{label}</span>
      <span className="font-medium text-right">{display}</span>
    </div>
  );
}

function formatDeliveryMode(provider: string, mcpSupport: boolean | undefined) {
  if (provider === 'antigravity') return 'CDP Bridge';
  return mcpSupport ? '原生 (--mcp-config)' : 'HTTP 回调注入';
}

/** Unified cat overview — all cats' model & budget in one tab */
export function CatOverviewTab({
  config,
  cats,
  onAddMember,
  onEditMember,
}: {
  config: ConfigData;
  cats: CatData[];
  onAddMember?: () => void;
  onEditMember?: (cat: CatData) => void;
}) {
  return (
    <div className="space-y-3">
      {cats.map((catData) => {
        const cat = config.cats[catData.id];
        const budget = config.perCatBudgets[catData.id];
        const provider = cat?.provider ?? catData.provider;
        const model = cat?.model ?? catData.defaultModel;
        const name = catData.variantLabel
          ? `${catData.breedDisplayName ?? catData.displayName}（${catData.variantLabel}）`
          : catData.breedDisplayName ?? catData.displayName;
        return (
          <Section key={catData.id} title={name}>
            <div className="space-y-1.5">
              {onEditMember ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onEditMember(catData)}
                    className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    编辑成员
                  </button>
                </div>
              ) : null}
              <KV label="Provider" value={provider} />
              <KV label="Model" value={model} />
              <KV label="运行方式" value={formatDeliveryMode(provider, cat?.mcpSupport)} />
              {catData.providerProfileId ? <KV label="账号绑定" value={catData.providerProfileId} /> : null}
              {catData.commandArgs?.length ? <KV label="CLI Args" value={catData.commandArgs.join(' ')} /> : null}
              {budget ? (
                <>
                  <KV label="Prompt 上限" value={`${(budget.maxPromptTokens / 1000).toFixed(0)}k tokens`} />
                  <KV label="上下文上限" value={`${(budget.maxContextTokens / 1000).toFixed(0)}k tokens`} />
                  <KV label="消息数上限" value={budget.maxMessages} />
                  <KV label="单消息上限" value={`${(budget.maxContentLengthPerMsg / 1000).toFixed(0)}k chars`} />
                </>
              ) : null}
              {catData.mentionPatterns.length > 0 ? (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Aliases</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catData.mentionPatterns.map((pattern) => (
                      <span
                        key={`${catData.id}-${pattern}`}
                        className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                      >
                        {pattern}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </Section>
        );
      })}
      {onAddMember ? (
        <button
          type="button"
          onClick={onAddMember}
          className="w-full rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
        >
          + 添加成员
        </button>
      ) : null}
      {cats.length === 0 && <p className="text-sm text-gray-400">未找到成员配置数据</p>}
    </div>
  );
}

export function SystemTab({ config }: { config: ConfigData }) {
  return (
    <>
      <Section title="A2A 猫猫互调">
        <div className="space-y-1.5">
          <KV label="启用" value={config.a2a.enabled} />
          <KV label="最大深度" value={config.a2a.maxDepth} />
        </div>
      </Section>
      <Section title="记忆 (F3-lite)">
        <div className="space-y-1.5">
          <KV label="启用" value={config.memory.enabled} />
          <KV label="每线程最大 key 数" value={config.memory.maxKeysPerThread} />
        </div>
      </Section>
      <Section title="Hindsight 长期记忆">
        <div className="space-y-1.5">
          <KV label="启用" value={config.hindsight.enabled} />
          <KV label="Base URL" value={config.hindsight.baseUrl} />
          <KV label="共享 Bank" value={config.hindsight.sharedBank} />
          {config.hindsight.recallDefaults ? (
            <>
              <KV label="Recall Budget" value={config.hindsight.recallDefaults.budget} />
              <KV label="Recall TagsMatch" value={config.hindsight.recallDefaults.tagsMatch} />
              <KV label="Recall Limit" value={config.hindsight.recallDefaults.limit} />
            </>
          ) : null}
          {config.hindsight.retainPolicy ? (
            <>
              <KV label="Narrative Fact Required" value={config.hindsight.retainPolicy.narrativeFactRequired} />
              <KV label="Min Useful Horizon Days" value={config.hindsight.retainPolicy.minUsefulHorizonDays} />
              {typeof config.hindsight.retainPolicy.anchorRequired === 'boolean' ? (
                <KV label="Anchor Required" value={config.hindsight.retainPolicy.anchorRequired} />
              ) : null}
            </>
          ) : null}
          {config.hindsight.reflect ? (
            <KV label="Reflect Disposition" value={config.hindsight.reflect.dispositionMode} />
          ) : null}
        </div>
      </Section>
      {config.hindsight.engine ? (
        <Section title="引擎路由">
          <div className="space-y-1.5">
            <KV label="Reflect Engine" value={config.hindsight.engine.reflect} />
            <KV label="Retain Extraction Engine" value={config.hindsight.engine.retainExtraction} />
            <KV label="allowNativeFallback" value={config.hindsight.engine.allowNativeFallback} />
          </div>
        </Section>
      ) : null}
      {config.hindsight.service ? (
        <Section title="Hindsight 独立服务">
          <div className="space-y-1.5">
            <KV label="服务模式" value={config.hindsight.service.mode} />
            <KV label="requireHealthcheck" value={config.hindsight.service.requireHealthcheck} />
            <KV label="写入超时(ms)" value={config.hindsight.service.writeTimeoutMs} />
            <KV label="检索超时(ms)" value={config.hindsight.service.recallTimeoutMs} />
          </div>
        </Section>
      ) : null}
      {config.codexExecution ? (
        <Section title="Codex 推理执行">
          <div className="space-y-1.5">
            <KV label="Model" value={config.codexExecution.model} />
            <KV label="Auth Mode" value={config.codexExecution.authMode} />
            <KV label="Pass --model Arg" value={config.codexExecution.passModelArg} />
          </div>
        </Section>
      ) : null}
      <Section title="治理 & 降级">
        <div className="space-y-1.5">
          <KV label="降级策略启用" value={config.governance.degradationEnabled} />
          <KV label="Done 超时" value={`${config.governance.doneTimeoutMs / 1000}s`} />
          <KV label="Heartbeat 间隔" value={`${config.governance.heartbeatIntervalMs / 1000}s`} />
        </div>
      </Section>
    </>
  );
}
