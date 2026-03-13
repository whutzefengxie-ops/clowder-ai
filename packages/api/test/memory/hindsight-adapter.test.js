import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

describe('HindsightAdapter', () => {
  let adapter;

  beforeEach(async () => {
    const { HindsightAdapter } = await import('../../dist/domains/memory/HindsightAdapter.js');

    // Mock IHindsightClient
    const mockClient = {
      recall: async (_bankId, _query, _opts) => [
        {
          content: '# F042: Prompt Audit\n\nThree-layer architecture.',
          document_id: 'F042',
          tags: ['kind:feature', 'status:active'],
          score: 0.95,
        },
      ],
      retain: async () => {},
      reflect: async () => 'Reflection result',
      ensureBank: async () => {},
      isHealthy: async () => true,
    };

    adapter = new HindsightAdapter(mockClient, 'cat-cafe-shared');
  });

  it('search delegates to recall and converts results', async () => {
    const results = await adapter.search('prompt audit');
    assert.equal(results.length, 1);
    assert.equal(results[0].anchor, 'F042');
    assert.equal(results[0].title, '# F042: Prompt Audit');
  });

  it('health delegates to isHealthy', async () => {
    assert.equal(await adapter.health(), true);
  });

  it('initialize delegates to ensureBank', async () => {
    // Should not throw
    await adapter.initialize();
  });

  it('upsert delegates to retain', async () => {
    // Should not throw
    await adapter.upsert([
      {
        anchor: 'F042',
        kind: 'feature',
        status: 'active',
        title: 'Prompt Audit',
        summary: 'Some summary',
        updatedAt: '2026-03-11T00:00:00Z',
      },
    ]);
  });

  it('getByAnchor throws UnsupportedError', async () => {
    await assert.rejects(() => adapter.getByAnchor('F042'), {
      message: /not supported/i,
    });
  });

  it('deleteByAnchor throws UnsupportedError', async () => {
    await assert.rejects(() => adapter.deleteByAnchor('F042'), {
      message: /not supported/i,
    });
  });
});
