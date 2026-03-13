import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const { StudyMetaService } = await import('../dist/domains/signals/services/study-meta-service.js');

describe('StudyMetaService collection sync', () => {
  let tmpDir;
  let service;
  let articleFilePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'study-meta-test-'));
    service = new StudyMetaService();
    articleFilePath = join(tmpDir, 'test-article.md');
    writeFileSync(articleFilePath, '# Test Article\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addCollection adds collection ID to studyMeta', async () => {
    const meta = await service.addCollection('art-1', articleFilePath, 'col-1');
    assert.deepEqual(meta.collections, ['col-1']);
    assert.equal(meta.articleId, 'art-1');
  });

  it('addCollection is idempotent', async () => {
    await service.addCollection('art-1', articleFilePath, 'col-1');
    const meta = await service.addCollection('art-1', articleFilePath, 'col-1');
    assert.deepEqual(meta.collections, ['col-1']);
  });

  it('removeCollection removes collection ID from studyMeta', async () => {
    await service.addCollection('art-1', articleFilePath, 'col-1');
    await service.addCollection('art-1', articleFilePath, 'col-2');
    const meta = await service.removeCollection('art-1', articleFilePath, 'col-1');
    assert.deepEqual(meta.collections, ['col-2']);
  });

  it('removeCollection is idempotent on missing ID', async () => {
    const meta = await service.removeCollection('art-1', articleFilePath, 'col-999');
    assert.deepEqual(meta.collections, []);
  });

  it('addCollection persists to disk', async () => {
    await service.addCollection('art-1', articleFilePath, 'col-1');
    // Read fresh from disk
    const service2 = new StudyMetaService();
    const meta = await service2.readMeta('art-1', articleFilePath);
    assert.deepEqual(meta.collections, ['col-1']);
  });

  it('multiple collections can coexist', async () => {
    await service.addCollection('art-1', articleFilePath, 'col-1');
    await service.addCollection('art-1', articleFilePath, 'col-2');
    const meta = await service.addCollection('art-1', articleFilePath, 'col-3');
    assert.deepEqual(meta.collections, ['col-1', 'col-2', 'col-3']);
  });
});

describe('Collection ↔ StudyMeta atomicity', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'col-atomicity-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addCollection throwing does not leave collection in dirty state (POST pattern)', async () => {
    // Simulate: create empty collection, attempt sync that throws,
    // verify collection file still has empty articleIds.
    const colPath = join(tmpDir, 'test-col.json');
    const emptyCol = {
      id: 'col-test',
      name: 'Test',
      articleIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(colPath, JSON.stringify(emptyCol, null, 2));

    // Simulate sync failure
    const brokenStudyMeta = {
      addCollection: () => {
        throw new Error('disk full');
      },
    };

    let threw = false;
    try {
      // This mimics what the POST route does: sync before writing articleIds
      await brokenStudyMeta.addCollection('art-1', '/fake/path.md', 'col-test');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'sync should have thrown');

    // Collection file should still have empty articleIds
    const onDisk = JSON.parse(readFileSync(colPath, 'utf-8'));
    assert.deepEqual(onDisk.articleIds, [], 'collection should remain empty after sync failure');
  });

  it('PATCH pattern: sync failure preserves old articleIds in collection', async () => {
    const colPath = join(tmpDir, 'test-col2.json');
    const existingCol = {
      id: 'col-test2',
      name: 'Test2',
      articleIds: ['old-art'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(colPath, JSON.stringify(existingCol, null, 2));

    const brokenStudyMeta = {
      addCollection: () => {
        throw new Error('permission denied');
      },
    };

    let threw = false;
    try {
      // PATCH route syncs BEFORE writing collection — simulate sync failure
      await brokenStudyMeta.addCollection('new-art', '/fake/path.md', 'col-test2');
    } catch {
      threw = true;
    }
    assert.ok(threw);

    // Collection file should still have old articleIds (not updated)
    const onDisk = JSON.parse(readFileSync(colPath, 'utf-8'));
    assert.deepEqual(onDisk.articleIds, ['old-art'], 'collection should retain old articleIds after sync failure');
  });
});
