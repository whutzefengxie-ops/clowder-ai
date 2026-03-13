/**
 * HindsightClient Tests
 * Covers URL construction, body mapping, error handling.
 * Uses mock fetch to avoid depending on live Hindsight service.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

// We'll mock global fetch
let mockFetch;
let savedFetch;

describe('HindsightClient', () => {
  beforeEach(() => {
    savedFetch = globalThis.fetch;
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  async function getClient(url = 'http://test:8888') {
    const { HindsightClient } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
    return new HindsightClient(url);
  }

  describe('recall', () => {
    it('createHindsightClient uses local isolated default base URL', async () => {
      const savedUrl = process.env.HINDSIGHT_URL;
      delete process.env.HINDSIGHT_URL;
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ memories: [] }) }),
      );

      const { createHindsightClient } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
      const client = createHindsightClient();
      await client.recall('cat-cafe-shared', 'default-url-smoke');

      const [url] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'http://localhost:18888/v1/default/banks/cat-cafe-shared/memories/recall');

      if (savedUrl === undefined) {
        delete process.env.HINDSIGHT_URL;
      } else {
        process.env.HINDSIGHT_URL = savedUrl;
      }
    });

    it('constructs correct URL and body', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ memories: [] }) }),
      );

      const client = await getClient();
      await client.recall('cat-cafe-shared', 'phase 5 decisions');

      assert.equal(mockFetch.mock.callCount(), 1);
      const [url, opts] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'http://test:8888/v1/default/banks/cat-cafe-shared/memories/recall');
      assert.equal(opts.method, 'POST');

      const body = JSON.parse(opts.body);
      assert.equal(body.query, 'phase 5 decisions');
    });

    it('passes optional parameters', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ memories: [] }) }),
      );

      const client = await getClient();
      await client.recall('cat-cafe-shared', 'test', {
        limit: 10,
        budget: 'high',
        types: ['world', 'experience'],
        tags: ['project:cat-cafe', 'kind:decision'],
        tagsMatch: 'all_strict',
      });

      const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
      assert.equal(body.limit, 10);
      assert.equal(body.budget, 'high');
      assert.deepEqual(body.types, ['world', 'experience']);
      assert.deepEqual(body.tags, ['project:cat-cafe', 'kind:decision']);
      assert.equal(body.tags_match, 'all_strict');
    });

    it('returns memories from response', async () => {
      const memories = [
        { content: 'ADR-005 decided single bank', score: 0.95 },
        { content: 'Phase 4 completed', score: 0.8 },
      ];
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ memories }) }));

      const client = await getClient();
      const result = await client.recall('cat-cafe-shared', 'test');
      assert.equal(result.length, 2);
      assert.equal(result[0].content, 'ADR-005 decided single bank');
    });

    it('returns empty array when memories is missing', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

      const client = await getClient();
      const result = await client.recall('cat-cafe-shared', 'test');
      assert.deepEqual(result, []);
    });

    it('sets a timeout signal on network calls', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ memories: [] }) }),
      );

      const client = await getClient();
      await client.recall('cat-cafe-shared', 'timeout-test');

      const [, opts] = mockFetch.mock.calls[0].arguments;
      assert.ok(opts.signal, 'fetch should receive AbortSignal timeout');
    });
  });

  describe('retain', () => {
    it('constructs correct URL and body', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

      const client = await getClient();
      const items = [
        {
          content: 'Phase 5.1 uses single bank strategy',
          tags: ['project:cat-cafe', 'kind:decision'],
          metadata: { anchor: 'docs/decisions/005.md', author: 'opus' },
        },
      ];
      await client.retain('cat-cafe-shared', items);

      const [url, opts] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'http://test:8888/v1/default/banks/cat-cafe-shared/memories');
      const body = JSON.parse(opts.body);
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].content, 'Phase 5.1 uses single bank strategy');
    });

    it('passes async and document_tags options', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

      const client = await getClient();
      await client.retain('cat-cafe-shared', [{ content: 'test' }], {
        async: true,
        document_tags: ['batch-import'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
      assert.equal(body.async, true);
      assert.deepEqual(body.document_tags, ['batch-import']);
    });

    it('accepts empty response body (204) without throwing', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, status: 204 }));

      const client = await getClient();
      await assert.doesNotReject(() => client.retain('cat-cafe-shared', [{ content: 'ok' }]));
    });
  });

  describe('reflect', () => {
    it('returns reflection string', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reflection: 'The project evolved from SDK to CLI...' }),
        }),
      );

      const client = await getClient();
      const result = await client.reflect('cat-cafe-shared', 'summarize project evolution');
      assert.equal(result, 'The project evolved from SDK to CLI...');
    });

    it('returns empty string when reflection is missing', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

      const client = await getClient();
      const result = await client.reflect('cat-cafe-shared', 'test');
      assert.equal(result, '');
    });
  });

  describe('ensureBank', () => {
    it('sends PUT with bank name', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true }));

      const client = await getClient();
      await client.ensureBank('cat-cafe-shared', 'Cat Cafe Shared', 'Project knowledge base');

      const [url, opts] = mockFetch.mock.calls[0].arguments;
      assert.equal(url, 'http://test:8888/v1/default/banks/cat-cafe-shared');
      assert.equal(opts.method, 'PUT');

      const body = JSON.parse(opts.body);
      assert.equal(body.name, 'Cat Cafe Shared');
      assert.equal(body.background, 'Project knowledge base');
    });

    it('defaults name to bankId', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true }));

      const client = await getClient();
      await client.ensureBank('cat-cafe-shared');

      const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
      assert.equal(body.name, 'cat-cafe-shared');
    });

    it('sets timeout signal for ensureBank call', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true }));

      const client = await getClient();
      await client.ensureBank('cat-cafe-shared');

      const [, opts] = mockFetch.mock.calls[0].arguments;
      assert.ok(opts.signal, 'ensureBank should use timeout signal');
    });
  });

  describe('isHealthy', () => {
    it('returns true when healthy', async () => {
      mockFetch.mock.mockImplementation(() => Promise.resolve({ ok: true }));

      const client = await getClient();
      assert.equal(await client.isHealthy(), true);
    });

    it('returns false on network error', async () => {
      mockFetch.mock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));

      const client = await getClient();
      assert.equal(await client.isHealthy(), false);
    });
  });

  describe('error handling', () => {
    it('throws HindsightError on non-ok response', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        }),
      );

      const { HindsightError } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
      const client = await getClient();

      await assert.rejects(
        () => client.recall('cat-cafe-shared', 'test'),
        (err) => {
          assert.ok(err instanceof HindsightError);
          assert.equal(err.code, 'API_ERROR');
          assert.equal(err.statusCode, 500);
          return true;
        },
      );
    });

    it('throws HindsightError on connection failure', async () => {
      mockFetch.mock.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')));

      const { HindsightError } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
      const client = await getClient();

      await assert.rejects(
        () => client.recall('cat-cafe-shared', 'test'),
        (err) => {
          assert.ok(err instanceof HindsightError);
          assert.equal(err.code, 'CONNECTION_FAILED');
          return true;
        },
      );
    });

    it('throws HindsightError on bank creation failure', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 409,
          text: () => Promise.resolve('Conflict'),
        }),
      );

      const { HindsightError } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
      const client = await getClient();

      await assert.rejects(
        () => client.ensureBank('cat-cafe-shared'),
        (err) => {
          assert.ok(err instanceof HindsightError);
          assert.equal(err.code, 'BANK_CREATE_FAILED');
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    });
  });

  describe('createHindsightClient factory', () => {
    it('uses provided URL', async () => {
      const { createHindsightClient } = await import('../dist/domains/cats/services/orchestration/HindsightClient.js');
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ memories: [] }) }),
      );

      const client = createHindsightClient('http://custom:9999');
      await client.recall('test', 'q');

      assert.ok(mockFetch.mock.calls[0].arguments[0].startsWith('http://custom:9999'));
    });
  });
});
