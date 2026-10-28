import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CodexAgentService } from '../src/domains/cats/services/agents/providers/CodexAgentService.js';
import { prepareClaudeSdkLaunch } from '../src/domains/cats/services/agents/providers/claude-sdk-launch.js';
import { ensureFakeCliOnPath } from './helpers/fake-cli-path.js';

ensureFakeCliOnPath('codex');
test('feedback Codex never compiles private L0 and disables tools/history at the actual launch boundary', async () => {
  let calls = 0;
  let args: string[] = [];
  const service = new CodexAgentService({
    catId: 'codex-sol',
    model: 'gpt-test',
    carrierMode: 'exec_json',
    l0CompilerFn: async () => {
      throw new Error('private-L0-canary must not be read');
    },
  });
  const messages = [];
  for await (const message of service.invoke('sanitized evidence', {
    workingDirectory: mkdtempSync(join(tmpdir(), 'feedback-provider-test-')),
    systemPrompt: 'bounded diagnostic recipe',
    diagnosticTextOnly: true,
    toolExecutionPolicy: { mode: 'read_only', replayDeniedToolNames: [] },
    spawnCliOverride: async function* (options) {
      calls++;
      args = [...options.args];
      yield { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  }))
    messages.push(message);
  assert.equal(calls, 1, JSON.stringify(messages));
  for (const flag of ['--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config'])
    assert.ok(args.includes(flag), flag);
  for (const key of ['shell_tool', 'unified_exec', 'multi_agent', 'hooks', 'memories', 'apps', 'plugins'])
    assert.ok(args.includes(`features.${key}=false`), key);
  assert.ok(!args.join('\n').includes('private-L0-canary'));
});

test('feedback Claude SDK has no private L0, native tools or persistent session', async () => {
  const launch = await prepareClaudeSdkLaunch({
    catId: 'opus',
    model: 'claude-test',
    prompt: 'sanitized evidence',
    l0CompilerFn: async () => {
      throw new Error('private-L0-canary must not be read');
    },
    abortController: new AbortController(),
    options: {
      diagnosticTextOnly: true,
      toolExecutionPolicy: { mode: 'read_only', replayDeniedToolNames: [] },
      systemPrompt: 'bounded recipe',
    },
  });
  assert.deepEqual(launch.sdkOptions.tools, []);
  assert.deepEqual(launch.sdkOptions.mcpServers, {});
  assert.equal(launch.sdkOptions.persistSession, false);
  assert.equal(launch.sdkOptions.maxTurns, 1);
  assert.equal(launch.sdkOptions.resume, undefined);
});
