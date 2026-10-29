/**
 * C05 / O2: ACP invocation configuration is frozen at admission, before the
 * process-pool lease wait.
 *
 * The real bug: AcpAgentService resolved `configurationSource`, model and
 * effort from the global cat registry AFTER `pool.acquire()` returned, so a
 * member edit made while the invocation queued changed the admitted call's
 * session configuration. These tests import src via tsx and drive the service
 * through an injected pool whose first `acquire` blocks, mutate the global
 * registry during that wait, and then assert what was actually sent to the
 * client (`setSessionConfigOption` calls = the consumer boundary).
 *
 * The regular `test/acp/*.test.js` suite imports `dist` and needs a build; this
 * file runs against src.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { catRegistry, createCatId, type CatConfig } from '@cat-cafe/shared';

import { AcpAgentService } from '../../src/domains/cats/services/agents/providers/acp/AcpAgentService.js';
import type { AcpProcessPool } from '../../src/domains/cats/services/agents/providers/acp/AcpProcessPool.js';

const CAT_ID = 'freeze-test-cat';
const POOL_KEY = { projectPath: '/tmp', providerProfile: 'freeze-test' };

function makeMemberConfig(overrides: {
  configurationSource?: 'native_tool';
  defaultModel: string;
  effort?: string;
}): CatConfig {
  return {
    id: createCatId(CAT_ID),
    name: 'Freeze test',
    displayName: 'Freeze test',
    avatar: '/avatars/default.png',
    color: { primary: '#111827', secondary: '#e5e7eb' },
    mentionPatterns: ['@freeze-test-cat'],
    clientId: 'acp',
    carrier: 'acp',
    defaultModel: overrides.defaultModel,
    mcpSupport: false,
    roleDescription: 'pre-lease freeze test member',
    personality: 'deterministic',
    cli: { command: 'fake', outputFormat: 'plainText', ...(overrides.effort ? { effort: overrides.effort } : {}) },
    ...(overrides.configurationSource ? { configurationSource: overrides.configurationSource } : {}),
  };
}

interface FakeConfigOption {
  id: string;
  category: string;
  currentValue: string;
  options: Array<{ value: string }>;
}

interface SessionConfigCall {
  sessionId: string;
  configId: string;
  value: string;
}

/**
 * Minimal ACP client surface. Fresh sessions advertise both the old and the new
 * model/effort values (the agent's catalog does not depend on member config),
 * so the test observes which member value the service selected.
 */
function makeFakeClient() {
  const calls: { newSession: number; setSessionConfigOption: SessionConfigCall[]; prompts: string[] } = {
    newSession: 0,
    setSessionConfigOption: [],
    prompts: [],
  };
  const sessions = new Map<string, { sessionId: string; configOptions: FakeConfigOption[] }>();
  const client = {
    calls,
    recentCapacitySignal: null,
    promptCapabilities: undefined,
    async newSession() {
      calls.newSession += 1;
      const session = {
        sessionId: `sess-${calls.newSession}`,
        configOptions: [
          {
            id: 'model',
            category: 'model',
            currentValue: 'agent-default',
            options: [{ value: 'model-old' }, { value: 'model-new' }],
          },
          {
            id: 'reasoning_effort',
            category: 'thought_level',
            currentValue: 'medium',
            options: [{ value: 'low' }, { value: 'high' }],
          },
        ],
      };
      sessions.set(session.sessionId, session);
      return session;
    },
    async setSessionConfigOption(sessionId: string, configId: string, value: string) {
      calls.setSessionConfigOption.push({ sessionId, configId, value });
      const session = sessions.get(sessionId);
      assert.ok(session, `unknown session ${sessionId}`);
      const option = session.configOptions.find((entry) => entry.id === configId);
      assert.ok(option, `unknown config option ${configId}`);
      option.currentValue = value;
      return { configOptions: session.configOptions };
    },
    async *promptStream(_sessionId: string, prompt: string) {
      calls.prompts.push(prompt);
      yield {
        sessionId: _sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
      } as unknown as { sessionId: string; update: Record<string, unknown> };
    },
    onCapacity() {},
    offCapacity() {},
    clearRecentCapacitySignal() {},
    setSessionRequestHandler() {},
    setSessionPermissionHandler() {},
  };
  return client;
}

interface GatedPool {
  acquire: () => Promise<{ client: unknown; poolKey: typeof POOL_KEY; release: () => void }>;
  rememberSession: () => void;
  releaseFirstLease: () => void;
  acquireCalls: number;
}

/** First acquire blocks until releaseFirstLease(); later acquires pass through. */
function makeGatedPool(client: unknown): GatedPool {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pool: GatedPool = {
    acquireCalls: 0,
    async acquire() {
      pool.acquireCalls += 1;
      if (pool.acquireCalls === 1) await gate;
      return { client, poolKey: POOL_KEY, release() {} };
    },
    rememberSession() {},
    releaseFirstLease() {
      release?.();
    },
  };
  return pool;
}

function makeService(pool: GatedPool) {
  return new AcpAgentService({
    catId: createCatId(CAT_ID),
    pool: pool as unknown as AcpProcessPool,
    poolKey: POOL_KEY,
    projectRoot: '/tmp',
    modelName: 'acp',
    mcpSupport: false,
  });
}

async function drain(generator: AsyncIterable<{ type: string }>): Promise<Array<{ type: string }>> {
  const messages: Array<{ type: string }> = [];
  for await (const message of generator) messages.push(message);
  return messages;
}

describe('AcpAgentService pre-lease configuration freeze (C05/O2)', () => {
  it('uses the values frozen at admission and lets the next invocation see the edit', async () => {
    delete process.env.CAT_FREEZE_TEST_CAT_MODEL;
    catRegistry.reset();
    catRegistry.register(CAT_ID, makeMemberConfig({ configurationSource: 'native_tool', defaultModel: 'model-old', effort: 'high' }));

    const client = makeFakeClient();
    const pool = makeGatedPool(client);
    const service = makeService(pool);

    // Start the invocation: it must resolve configuration synchronously until
    // the lease wait, so the following edit happens after admission.
    const iterator = service.invoke('first turn');
    const firstResult = iterator.next();
    await Promise.resolve();

    // Edit the member while the invocation waits for its lease. Both the
    // configuration source and the model/effort values change.
    catRegistry.reset();
    catRegistry.register(CAT_ID, makeMemberConfig({ defaultModel: 'model-new' }));

    pool.releaseFirstLease();
    const messages = [await firstResult];
    for (let result = await iterator.next(); !result.done; result = await iterator.next()) messages.push(result.value);

    assert.ok(
      !messages.some((message) => message.type === 'error'),
      `the admitted invocation must succeed: ${JSON.stringify(messages.slice(0, 2))}`,
    );
    assert.deepEqual(
      client.calls.setSessionConfigOption.filter((call) => call.configId === 'model').map((call) => call.value),
      ['model-old'],
      'the admitted invocation must apply the model frozen before the lease wait',
    );
    assert.deepEqual(
      client.calls.setSessionConfigOption.filter((call) => call.configId === 'reasoning_effort').map((call) => call.value),
      ['high'],
      'the admitted invocation must apply the effort frozen before the lease wait',
    );

    // The next invocation re-resolves configuration and sees the edit: the
    // member is no longer a native_tool member, so no session config is applied.
    const callsBeforeSecondTurn = client.calls.setSessionConfigOption.length;
    await drain(service.invoke('second turn'));
    assert.equal(
      client.calls.setSessionConfigOption.length,
      callsBeforeSecondTurn,
      'the next invocation must resolve the edited configurationSource, not the frozen one',
    );
    assert.equal(client.calls.newSession, 2);
  });

  it('applies the newly frozen native model/effort on the invocation after the edit', async () => {
    delete process.env.CAT_FREEZE_TEST_CAT_MODEL;
    catRegistry.reset();
    catRegistry.register(CAT_ID, makeMemberConfig({ configurationSource: 'native_tool', defaultModel: 'model-old', effort: 'high' }));

    const client = makeFakeClient();
    const pool = makeGatedPool(client);
    const service = makeService(pool);

    const iterator = service.invoke('first turn');
    const firstResult = iterator.next();
    await Promise.resolve();
    catRegistry.reset();
    catRegistry.register(CAT_ID, makeMemberConfig({ configurationSource: 'native_tool', defaultModel: 'model-new', effort: 'low' }));
    pool.releaseFirstLease();
    await firstResult;
    await drain(iterator);

    const firstTurnCalls = client.calls.setSessionConfigOption.splice(0);
    assert.deepEqual(
      firstTurnCalls.map((call) => `${call.configId}=${call.value}`),
      ['model=model-old', 'reasoning_effort=high'],
      'first invocation stays on its frozen values',
    );

    await drain(service.invoke('second turn'));
    assert.deepEqual(
      client.calls.setSessionConfigOption.map((call) => `${call.configId}=${call.value}`),
      ['model=model-new', 'reasoning_effort=low'],
      'the next invocation uses the values edited during the first lease wait',
    );
  });
});
