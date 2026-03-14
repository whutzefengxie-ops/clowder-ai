/**
 * F115: Callback create-thread route tests
 * POST /api/callbacks/create-thread
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import Fastify from 'fastify';
import './helpers/setup-cat-registry.js';

function createMockSocketManager() {
  const messages = [];
  return {
    broadcastAgentMessage(msg) {
      messages.push(msg);
    },
    getMessages() {
      return messages;
    },
  };
}

describe('POST /api/callbacks/create-thread (F115)', () => {
  let registry;
  let messageStore;
  let socketManager;
  let threadStore;

  beforeEach(async () => {
    const { InvocationRegistry } = await import(
      '../dist/domains/cats/services/agents/invocation/InvocationRegistry.js'
    );
    const { MessageStore } = await import('../dist/domains/cats/services/stores/ports/MessageStore.js');
    const { ThreadStore } = await import('../dist/domains/cats/services/stores/ports/ThreadStore.js');

    registry = new InvocationRegistry();
    messageStore = new MessageStore();
    threadStore = new ThreadStore();
    socketManager = createMockSocketManager();
  });

  async function createApp() {
    const { callbacksRoutes } = await import('../dist/routes/callbacks.js');
    const app = Fastify();
    await app.register(callbacksRoutes, {
      registry,
      messageStore,
      socketManager,
      threadStore,
    });
    return app;
  }

  test('creates thread with title and returns threadId', async () => {
    const app = await createApp();
    const { invocationId, callbackToken } = registry.create('user-1', 'opus');

    const response = await app.inject({
      method: 'POST',
      url: '/api/callbacks/create-thread',
      payload: {
        invocationId,
        callbackToken,
        title: 'Investigate issue #79',
      },
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    assert.ok(body.threadId, 'response must include threadId');
    assert.equal(typeof body.threadId, 'string');

    // Thread should exist in the store
    const thread = await threadStore.get(body.threadId);
    assert.ok(thread, 'thread should be persisted');
    assert.equal(thread.title, 'Investigate issue #79');
  });

  test('creates thread with preferredCats', async () => {
    const app = await createApp();
    const { invocationId, callbackToken } = registry.create('user-1', 'opus');

    const response = await app.inject({
      method: 'POST',
      url: '/api/callbacks/create-thread',
      payload: {
        invocationId,
        callbackToken,
        title: 'Design discussion',
        preferredCats: ['codex', 'gemini'],
      },
    });

    assert.equal(response.statusCode, 201);
    const body = JSON.parse(response.body);
    const thread = await threadStore.get(body.threadId);
    assert.ok(thread);
    // preferredCats should be set on the thread
    assert.deepEqual(thread.preferredCats, ['codex', 'gemini']);
  });

  test('returns 401 for invalid credentials', async () => {
    const app = await createApp();
    const { invocationId } = registry.create('user-1', 'opus');

    const response = await app.inject({
      method: 'POST',
      url: '/api/callbacks/create-thread',
      payload: {
        invocationId,
        callbackToken: 'wrong-token',
        title: 'Should fail',
      },
    });

    assert.equal(response.statusCode, 401);
  });

  test('returns 400 when title is missing', async () => {
    const app = await createApp();
    const { invocationId, callbackToken } = registry.create('user-1', 'opus');

    const response = await app.inject({
      method: 'POST',
      url: '/api/callbacks/create-thread',
      payload: {
        invocationId,
        callbackToken,
      },
    });

    assert.equal(response.statusCode, 400);
  });
});
