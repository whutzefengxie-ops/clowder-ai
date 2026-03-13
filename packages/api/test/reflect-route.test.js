/**
 * Reflect Route Tests
 * POST /api/reflect — Hindsight LLM reflection
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { HindsightError } from '../dist/domains/cats/services/orchestration/HindsightClient.js';
import { reflectRoutes } from '../dist/routes/reflect.js';

function createMockClient(overrides = {}) {
  return {
    recall: async () => [],
    retain: async () => {},
    reflect: async () => 'This is a reflection.',
    ensureBank: async () => {},
    isHealthy: async () => true,
    ...overrides,
  };
}

describe('POST /api/reflect', () => {
  async function setup(clientOverrides = {}) {
    const app = Fastify();
    const hindsightClient = createMockClient(clientOverrides);
    await app.register(reflectRoutes, {
      hindsightClient,
      sharedBank: 'cat-cafe-shared',
    });
    await app.ready();
    return app;
  }

  it('returns reflection from Hindsight', async () => {
    const app = await setup({
      reflect: async () => 'Phase 4 introduced per-cat budgets to replace the global 32k limit.',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'Why do we have per-cat budgets?' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.degraded, false);
    assert.ok(body.reflection.includes('per-cat budgets'));
  });

  it('exposes runtime-configured reflect disposition mode', async () => {
    const previous = process.env.HINDSIGHT_REFLECT_DISPOSITION_MODE;
    process.env.HINDSIGHT_REFLECT_DISPOSITION_MODE = 'off';

    const app = await setup({
      reflect: async () => 'reflection payload',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'test reflect disposition' },
    });

    if (previous === undefined) delete process.env.HINDSIGHT_REFLECT_DISPOSITION_MODE;
    else process.env.HINDSIGHT_REFLECT_DISPOSITION_MODE = previous;

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.dispositionMode, 'off');
  });

  it('degrades when Hindsight is unavailable (CONNECTION_FAILED)', async () => {
    const app = await setup({
      reflect: async () => {
        throw new HindsightError('CONNECTION_FAILED', 'Cannot reach Hindsight');
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'test' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.degraded, true);
    assert.equal(body.reflection, '');
    assert.equal(body.degradeReason, 'hindsight_unavailable');
  });

  it('degrades when Hindsight returns 5xx', async () => {
    const app = await setup({
      reflect: async () => {
        throw new HindsightError('API_ERROR', 'Internal server error', 500);
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'test' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.degraded, true);
    assert.equal(body.degradeReason, 'hindsight_server_error');
  });

  it('returns disabled degradation when HINDSIGHT_ENABLED=false', async () => {
    const previous = process.env.HINDSIGHT_ENABLED;
    process.env.HINDSIGHT_ENABLED = 'false';

    let reflectCalls = 0;
    const app = await setup({
      reflect: async () => {
        reflectCalls += 1;
        return 'unexpected reflection';
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'test' },
    });

    if (previous === undefined) delete process.env.HINDSIGHT_ENABLED;
    else process.env.HINDSIGHT_ENABLED = previous;

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.degraded, true);
    assert.equal(body.degradeReason, 'hindsight_disabled');
    assert.equal(body.reflection, '');
    assert.equal(reflectCalls, 0);
  });

  it('returns 502 for non-degradable errors', async () => {
    const app = await setup({
      reflect: async () => {
        throw new HindsightError('API_ERROR', 'Bad request', 400);
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: 'test' },
    });

    assert.equal(res.statusCode, 502);
  });

  it('returns 400 for missing query', async () => {
    const app = await setup();

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: {},
    });

    assert.equal(res.statusCode, 400);
  });

  it('returns 400 for empty query', async () => {
    const app = await setup();

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: '' },
    });

    assert.equal(res.statusCode, 400);
  });

  it('returns 400 for whitespace-only query', async () => {
    const app = await setup();

    const res = await app.inject({
      method: 'POST',
      url: '/api/reflect',
      payload: { query: '   ' },
    });

    assert.equal(res.statusCode, 400);
  });
});
