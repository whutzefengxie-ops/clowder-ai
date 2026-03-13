import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const { StudyMetaService } = await import('../dist/domains/signals/services/study-meta-service.js');

describe('StudyMetaService addOrReplaceArtifact', () => {
  let tmpDir;
  let service;
  let articleFilePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'study-meta-dedup-'));
    service = new StudyMetaService();
    articleFilePath = join(tmpDir, 'test-article.md');
    writeFileSync(articleFilePath, '# Test Article\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces existing artifact with matching kind+prefix', async () => {
    // Add first podcast-essence artifact
    await service.addArtifact('art-1', articleFilePath, {
      id: 'podcast-essence-1000',
      kind: 'podcast',
      createdAt: '2026-03-11T00:00:00Z',
      createdBy: 'opus',
      state: 'ready',
      filePath: '/old/path.json',
    });

    // Replace with new podcast-essence artifact
    const result = await service.addOrReplaceArtifact(
      'art-1',
      articleFilePath,
      {
        id: 'podcast-essence-2000',
        kind: 'podcast',
        createdAt: '2026-03-11T01:00:00Z',
        createdBy: 'opus',
        state: 'queued',
        filePath: '',
      },
      'podcast-essence-',
    );

    assert.equal(result.meta.artifacts.length, 1);
    assert.equal(result.meta.artifacts[0].id, 'podcast-essence-2000');
    assert.equal(result.replaced.length, 1);
    assert.equal(result.replaced[0].id, 'podcast-essence-1000');
  });

  it('does not replace artifacts with different prefix', async () => {
    // Add podcast-deep artifact
    await service.addArtifact('art-1', articleFilePath, {
      id: 'podcast-deep-1000',
      kind: 'podcast',
      createdAt: '2026-03-11T00:00:00Z',
      createdBy: 'opus',
      state: 'ready',
      filePath: '/old/path.json',
    });

    // Add podcast-essence — should NOT replace podcast-deep
    const result = await service.addOrReplaceArtifact(
      'art-1',
      articleFilePath,
      {
        id: 'podcast-essence-2000',
        kind: 'podcast',
        createdAt: '2026-03-11T01:00:00Z',
        createdBy: 'opus',
        state: 'queued',
        filePath: '',
      },
      'podcast-essence-',
    );

    assert.equal(result.meta.artifacts.length, 2);
    assert.equal(result.meta.artifacts[0].id, 'podcast-deep-1000');
    assert.equal(result.meta.artifacts[1].id, 'podcast-essence-2000');
    assert.equal(result.replaced.length, 0);
  });

  it('does not replace non-podcast artifacts', async () => {
    // Add a notes artifact
    await service.addArtifact('art-1', articleFilePath, {
      id: 'notes-1000',
      kind: 'notes',
      createdAt: '2026-03-11T00:00:00Z',
      createdBy: 'opus',
      state: 'ready',
      filePath: '/notes/path.md',
    });

    // Add podcast-essence — should NOT touch notes artifact
    const result = await service.addOrReplaceArtifact(
      'art-1',
      articleFilePath,
      {
        id: 'podcast-essence-2000',
        kind: 'podcast',
        createdAt: '2026-03-11T01:00:00Z',
        createdBy: 'opus',
        state: 'queued',
        filePath: '',
      },
      'podcast-essence-',
    );

    assert.equal(result.meta.artifacts.length, 2);
    assert.equal(result.meta.artifacts[0].id, 'notes-1000');
    assert.equal(result.meta.artifacts[1].id, 'podcast-essence-2000');
    assert.equal(result.replaced.length, 0);
  });
});
