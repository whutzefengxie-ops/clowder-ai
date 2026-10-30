import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCatalogCache } from '../dist/routes/runtime-catalog-route.js';
import { parseAcpCatalog } from '../dist/routes/runtime-model-catalog.js';

const session = (currentValue) => ({
  sessionId: 's',
  configOptions: [
    {
      id: 'model',
      category: 'model',
      currentValue,
      options: [
        { value: 'model-a', name: 'A' },
        { value: 'model-b', name: 'B' },
      ],
    },
  ],
});

test('a requested model is not reported as adopted when the actual session remains on another model', () => {
  const result = parseAcpCatalog(session('model-a'), session('model-a'), 'model-b');
  assert.equal(result.selectedModel, 'model-a');
});

test('an advertised catalog is not evidence of a configured default model', () => {
  for (const current of [undefined, '', 'unknown', '["unknown","unknown"]']) {
    const result = parseAcpCatalog(session(current), session(current));
    assert.equal(result.defaultModel, undefined);
    assert.equal(result.defaultModelStatus, 'unreported');
  }
});

test('an invalid advertised default is distinguished from an unknown default', () => {
  const result = parseAcpCatalog(session('missing'), session('missing'));
  assert.equal(result.defaultModelStatus, 'unavailable');
  assert.equal(result.defaultModel, undefined);
});

test('failed refresh keeps useful model names without reporting a stale native default as current', async () => {
  let failed = false;
  const cache = createCatalogCache(async () => {
    if (failed) throw new Error('unavailable');
    return parseAcpCatalog(session('model-a'), session('model-a'));
  });
  const target = { kind: 'acp', command: 'client', args: [], cwd: '/project' };
  await cache('one', target);
  failed = true;
  const result = await cache('one', target, true);
  assert.equal(result.models.length, 2);
  assert.equal(result.defaultModel, undefined);
  assert.equal(result.defaultModelStatus, 'unreported');
});
