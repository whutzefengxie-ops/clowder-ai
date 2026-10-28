import { randomUUID } from 'node:crypto';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentService, AgentServiceOptions } from '../../cats/services/types.js';
import { currentPluginOwnerRequestContext } from '../carrier/plugin-owner-request-context.js';
import { collectDiagnosticLogs } from './plugin-diagnostic-logs.js';

export interface DiagnosticClient {
  id: string;
  label: string;
  provider: string;
  model: string;
}
export interface PluginDiagnosticsHost {
  describe(): Promise<{ environment: string; projectRoot: string; clients: DiagnosticClient[] }>;
  collect(): Promise<string>;
  analyze(input: { clientId: string; prompt: string; instructions: string; signal: AbortSignal }): Promise<string>;
}
export interface DiagnosticServices {
  projectRoot(): string;
  clients(): (DiagnosticClient & { service: AgentService; options: AgentServiceOptions })[];
  logDirectory?: string;
}
/** Every operation requires this activation's live authenticated owner HTTP call. */
export function createPluginDiagnosticsHost(
  instanceId: string,
  services: DiagnosticServices,
  current: () => Promise<void>,
  activationSignal?: AbortSignal,
): PluginDiagnosticsHost {
  const busy = new Set<string>();
  async function owner() {
    await current();
    const context = currentPluginOwnerRequestContext(instanceId);
    if (!context || context.operation !== 'write' || !context.requestIdentity)
      throw new Error('诊断必须由用户在插件面板中发起');
    await context.assertCurrent();
    return context;
  }
  return {
    async describe() {
      await owner();
      return {
        projectRoot: services.projectRoot(),
        environment: `Clowder AI（版本以设置页面为准）\n${platform()} ${release()} ${arch()}\nNode ${process.versions.node}`,
        clients: services.clients().map(({ id, label, provider, model }) => ({ id, label, provider, model })),
      };
    },
    async collect() {
      const context = await owner();
      const result = await collectDiagnosticLogs(
        services.logDirectory ??
          (process.env.LOG_DIR ? resolve(process.env.LOG_DIR) : resolve(process.cwd(), 'data/logs/api')),
      );
      await context.assertCurrent();
      return result;
    },
    async analyze(input) {
      const context = await owner();
      const client = services.clients().find((c) => c.id === input.clientId);
      const policy = { mode: 'read_only' as const, replayDeniedToolNames: [] };
      if (!client?.service.supportsFeedbackDiagnostics?.())
        throw new Error('所选 Agent Client 无法保证只读诊断，可直接提交或手动创建');
      if (input.prompt.length > 128_000 || input.instructions.length > 8_000 || busy.has(context.userId))
        throw new Error('诊断材料超限或已有分析正在进行');
      busy.add(context.userId);
      const controller = new AbortController();
      const signal = AbortSignal.any([
        context.signal,
        input.signal,
        ...(activationSignal ? [activationSignal] : []),
        controller.signal,
        AbortSignal.timeout(120_000),
      ]);
      const cwd = await mkdtemp(join(tmpdir(), 'clowder-feedback-'));
      try {
        const options: AgentServiceOptions = {
          ...client.options,
          workingDirectory: cwd,
          systemPrompt: input.instructions,
          signal,
          invocationId: `feedback:${randomUUID()}`,
          toolExecutionPolicy: policy,
          diagnosticTextOnly: true,
        };
        delete options.sessionId;
        delete options.hostSessionId;
        delete options.nativeSessionBinding;
        let result = '';
        let done = false;
        for await (const message of client.service.invoke(input.prompt, options)) {
          await context.assertCurrent();
          if (message.type === 'tool_use' || message.type === 'tool_result')
            throw new Error('诊断 Client 尝试使用工具，已停止分析');
          if (message.type === 'error' && message.errorDisposition !== 'transient')
            throw new Error('诊断 Client 不可用，草稿已保留');
          if (message.type === 'text')
            result = message.textMode === 'replace' ? (message.content ?? '') : result + (message.content ?? '');
          if (result.length > 100_000) throw new Error('诊断报告超出长度限制');
          if (message.type === 'done') done = !message.errorCode;
        }
        signal.throwIfAborted();
        await context.assertCurrent();
        if (!done || !result.trim()) throw new Error('分析未完成，草稿已保留');
        return result;
      } finally {
        controller.abort();
        busy.delete(context.userId);
        // Never recursively remove an agent's unexpected files; an empty scratch directory only.
        await rmdir(cwd).catch(() => {});
      }
    },
  };
}
