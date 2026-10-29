import './helpers/setup-cat-registry.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freezeExecutionWorkspace } from '../dist/domains/cats/services/agents/invocation/execution-workspace.js';
import {
  invokeSingleCat,
  prepareInvocationExecutionBinding,
} from '../dist/domains/cats/services/agents/invocation/invoke-single-cat.js';
import { ContextEpochOwner } from '../dist/domains/cats/services/session/context/ContextEpochOwner.js';
import { InMemoryContextEpochStore } from '../dist/domains/cats/services/stores/ports/ContextEpochStore.js';
import { ThreadStore } from '../dist/domains/cats/services/stores/ports/ThreadStore.js';

test('workspace capture does not retain a mutable in-memory ThreadStore record', async () => {
  const thread = { id: 'thread', projectPath: 'default', memberEffortOverrides: { codex: 'low' } };
  const workspace = await freezeExecutionWorkspace({
    threadStore: { get: () => thread },
    threadId: 'thread',
    userId: 'owner',
    provider: 'openai',
  });
  thread.memberEffortOverrides.codex = 'high';
  assert.equal(workspace.thread.memberEffortOverrides.codex, 'low');
});

for (const preference of ['effort', 'speed']) {
  test(`actual invocation consumes its admitted thread ${preference}, after a later thread edit`, async () => {
    const catId = 'codex-sol';
    const threadStore = new ThreadStore();
    const thread = threadStore.create('owner', 'Frozen thread preferences');
    threadStore.updateMemberEffort(thread.id, catId, 'low');
    threadStore.updateMemberSpeed(thread.id, catId, 'fast');
    const optionsSeen = [];
    const service = {
      supportsToolExecutionPolicy: () => true,
      async *invoke(_prompt, options) {
        optionsSeen.push(options);
        yield { type: 'done', catId, timestamp: Date.now() };
      },
    };
    const deps = {
      registry: {
        create: () => ({ invocationId: 'thread-freeze-invocation', callbackToken: 'fixture-only' }),
        verify: async () => ({ ok: false }),
      },
      sessionManager: {
        get: async () => undefined,
        getOrCreate: async () => ({}),
        store: async () => {},
        delete: async () => {},
        resolveWorkingDirectory: () => undefined,
      },
      threadStore,
      apiUrl: 'http://127.0.0.1:13004',
      contextEpochOwner: new ContextEpochOwner(new InMemoryContextEpochStore()),
    };
    const executionBinding = await prepareInvocationExecutionBinding(deps, {
      catId,
      threadId: thread.id,
      userId: 'owner',
      service,
    });
    threadStore.updateMemberEffort(thread.id, catId, 'high');
    threadStore.updateMemberSpeed(thread.id, catId, 'standard');
    const messages = await Array.fromAsync(
      invokeSingleCat(deps, {
        catId,
        service,
        executionBinding,
        threadId: thread.id,
        userId: 'owner',
        prompt: 'isolated task',
        isLastCat: true,
        toolExecutionPolicy: { mode: 'read_only', replayDeniedToolNames: [] },
      }),
    );
    assert.deepEqual(
      messages.filter((message) => message.type === 'error'),
      [],
    );
    assert.equal(optionsSeen.length, 1);
    if (preference === 'effort') assert.equal(optionsSeen[0].reasoningEffortOverride, 'low');
    else assert.equal(optionsSeen[0].requestedServiceTier, 'fast');
  });
}
