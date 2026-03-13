import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('createMemoryServices', () => {
  it('creates sqlite services', async () => {
    const { createMemoryServices } = await import('../../dist/domains/memory/factory.js');

    const services = await createMemoryServices({
      type: 'sqlite',
      sqlitePath: ':memory:',
      docsRoot: '/tmp/f102-test-docs',
      markersDir: '/tmp/f102-test-markers',
    });

    assert.ok(services.evidenceStore);
    assert.ok(services.markerQueue);
    assert.ok(services.reflectionService);
    assert.ok(services.knowledgeResolver);
    assert.ok(services.indexBuilder);
    assert.ok(services.materializationService);

    assert.equal(await services.evidenceStore.health(), true);
  });

  it('creates hindsight services', async () => {
    const { createMemoryServices } = await import('../../dist/domains/memory/factory.js');

    const mockClient = {
      recall: async () => [],
      retain: async () => {},
      reflect: async () => '',
      ensureBank: async () => {},
      isHealthy: async () => true,
    };

    const services = await createMemoryServices({
      type: 'hindsight',
      hindsightClient: mockClient,
      hindsightBank: 'test-bank',
    });

    assert.ok(services.evidenceStore);
    assert.ok(services.markerQueue);
    assert.ok(services.reflectionService);
    assert.ok(services.knowledgeResolver);
    // indexBuilder and materializationService not available for hindsight
    assert.equal(services.indexBuilder, undefined);
  });

  it('throws when hindsight type but no client', async () => {
    const { createMemoryServices } = await import('../../dist/domains/memory/factory.js');

    await assert.rejects(() => createMemoryServices({ type: 'hindsight' }), { message: /hindsightClient required/i });
  });
});
