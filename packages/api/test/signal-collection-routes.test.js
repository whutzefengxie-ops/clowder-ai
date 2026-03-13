/**
 * Route integration test: collection ↔ studyMeta atomicity.
 *
 * Uses real Fastify app.inject() + monkey-patched StudyMetaService
 * to verify that sync failures don't leave collection in dirty state.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';

const { signalCollectionRoutes } = await import('../dist/routes/signal-collection-routes.js');
const { StudyMetaService } = await import('../dist/domains/signals/services/study-meta-service.js');
const { SignalArticleQueryService } = await import('../dist/domains/signals/services/article-query-service.js');

describe('Collection routes atomicity (real Fastify inject)', () => {
  let tmpDir;
  let app;
  let originalAddCollection;
  let originalGetArticleById;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'col-route-test-'));

    // Set env so resolveSignalPaths() points to our temp dir
    process.env.SIGNALS_ROOT_DIR = tmpDir;

    // Create required directory structure
    mkdirSync(join(tmpDir, 'config'), { recursive: true });
    mkdirSync(join(tmpDir, 'library'), { recursive: true });
    mkdirSync(join(tmpDir, 'inbox'), { recursive: true });
    mkdirSync(join(tmpDir, 'logs'), { recursive: true });
    // Write minimal sources config to avoid init errors
    writeFileSync(join(tmpDir, 'config', 'sources.yaml'), '# empty\nsources: []\n');

    // Save originals for restore
    originalAddCollection = StudyMetaService.prototype.addCollection;
    originalGetArticleById = SignalArticleQueryService.prototype.getArticleById;

    // Patch getArticleById to return a fake article so syncStudyMetaCollections
    // actually reaches addCollection (otherwise it short-circuits on null).
    SignalArticleQueryService.prototype.getArticleById = async (id) => ({
      id,
      url: 'https://example.com',
      title: 'Fake Article',
      source: 'test',
      tier: 3,
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      status: 'inbox',
      tags: [],
      filePath: join(tmpDir, 'library', `${id}.md`),
      content: '# Fake',
    });

    app = Fastify();
    await app.register(signalCollectionRoutes);
    await app.ready();
  });

  afterEach(async () => {
    // Restore original methods
    StudyMetaService.prototype.addCollection = originalAddCollection;
    SignalArticleQueryService.prototype.getArticleById = originalGetArticleById;
    await app.close();
    delete process.env.SIGNALS_ROOT_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST with articleIds: sync failure leaves collection with empty articleIds', async () => {
    // Monkey-patch addCollection to throw
    StudyMetaService.prototype.addCollection = async () => {
      throw new Error('simulated disk failure');
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/signals/collections',
      headers: {
        'x-cat-cafe-user': 'test-user',
        'content-type': 'application/json',
      },
      payload: {
        name: 'Test Collection',
        articleIds: ['art-1', 'art-2'],
      },
    });

    // Route should return 500 (unhandled throw)
    assert.equal(res.statusCode, 500);

    // Verify: collection file exists but has empty articleIds (shell only)
    const collectionsDir = join(tmpDir, 'collections');
    const files = readdirSync(collectionsDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, 'shell collection should exist');

    const col = JSON.parse(readFileSync(join(collectionsDir, files[0]), 'utf-8'));
    assert.deepEqual(col.articleIds, [], 'collection should have empty articleIds after sync failure');
    assert.equal(col.name, 'Test Collection');
  });

  it('POST without articleIds: succeeds normally', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/signals/collections',
      headers: {
        'x-cat-cafe-user': 'test-user',
        'content-type': 'application/json',
      },
      payload: {
        name: 'Empty Collection',
      },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.collection.name, 'Empty Collection');
    assert.deepEqual(body.collection.articleIds, []);
  });

  it('PATCH with articleIds: sync failure preserves old articleIds', async () => {
    // First create a collection normally
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/signals/collections',
      headers: {
        'x-cat-cafe-user': 'test-user',
        'content-type': 'application/json',
      },
      payload: { name: 'My Collection' },
    });
    assert.equal(createRes.statusCode, 201);
    const colId = createRes.json().collection.id;

    // Now patch: add articleIds but make sync fail
    StudyMetaService.prototype.addCollection = async () => {
      throw new Error('simulated permission error');
    };

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/signals/collections/${colId}`,
      headers: {
        'x-cat-cafe-user': 'test-user',
        'content-type': 'application/json',
      },
      payload: {
        articleIds: ['art-new-1', 'art-new-2'],
      },
    });

    // Route should return 500
    assert.equal(patchRes.statusCode, 500);

    // Verify: collection file still has empty articleIds (not updated)
    const collectionsDir = join(tmpDir, 'collections');
    const colFile = join(collectionsDir, `${colId}.json`);
    const col = JSON.parse(readFileSync(colFile, 'utf-8'));
    assert.deepEqual(col.articleIds, [], 'collection should retain old (empty) articleIds after sync failure');
  });
});
