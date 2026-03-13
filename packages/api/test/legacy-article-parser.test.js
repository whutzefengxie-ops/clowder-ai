import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const { parseLegacyArticles } = await import('../dist/scripts/migrate-signals/legacy-article-parser.js');

describe('legacy article parser', () => {
  it('parses YYYY-MM-DD filename prefixes when frontmatter date is missing', async () => {
    const libraryDir = await mkdtemp(join(tmpdir(), 'legacy-article-parser-'));
    const sourceDir = join(libraryDir, 'anthropic');
    await mkdir(sourceDir, { recursive: true });

    const filePath = join(sourceDir, '2026-01-23-agent-update.md');
    await writeFile(
      filePath,
      ['---', 'title: "Agent update"', 'url: "https://example.com/agent-update"', '---', '', 'content', ''].join('\n'),
      'utf-8',
    );

    const articles = await parseLegacyArticles(libraryDir);

    assert.equal(articles.length, 1);
    assert.equal(articles[0].publishedAt, '2026-01-23');
    assert.equal(articles[0].fetchedAt, '2026-01-23');
  });

  it('skips malformed markdown files and continues parsing valid legacy articles', async () => {
    const libraryDir = await mkdtemp(join(tmpdir(), 'legacy-article-parser-'));
    const sourceDir = join(libraryDir, 'anthropic');
    await mkdir(sourceDir, { recursive: true });

    await writeFile(
      join(sourceDir, '2026-01-23-valid.md'),
      ['---', 'title: "Valid article"', 'url: "https://example.com/valid"', '---', '', 'ok', ''].join('\n'),
      'utf-8',
    );

    await writeFile(
      join(sourceDir, '2026-01-24-malformed.md'),
      ['---', 'title: "Malformed article"', 'url: "https://example.com/malformed"', 'tags: [broken', '---', ''].join(
        '\n',
      ),
      'utf-8',
    );

    const skipped = [];
    const articles = await parseLegacyArticles(libraryDir, {
      onSkipMalformed: (input) => skipped.push({ filePath: input.filePath, reason: input.reason }),
    });

    assert.equal(articles.length, 1);
    assert.equal(articles[0].url, 'https://example.com/valid');
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].filePath, /2026-01-24-malformed\.md$/);
  });

  it('flags unterminated frontmatter as malformed input', async () => {
    const libraryDir = await mkdtemp(join(tmpdir(), 'legacy-article-parser-'));
    const sourceDir = join(libraryDir, 'anthropic');
    await mkdir(sourceDir, { recursive: true });

    await writeFile(
      join(sourceDir, '2026-01-23-valid.md'),
      ['---', 'title: "Valid article"', 'url: "https://example.com/valid"', '---', '', 'ok', ''].join('\n'),
      'utf-8',
    );

    await writeFile(
      join(sourceDir, '2026-01-24-unterminated.md'),
      ['---', 'title: "Unterminated article"', 'url: "https://example.com/unterminated"', 'tags: [broken'].join('\n'),
      'utf-8',
    );

    const skipped = [];
    const articles = await parseLegacyArticles(libraryDir, {
      onSkipMalformed: (input) => skipped.push({ filePath: input.filePath, reason: input.reason }),
    });

    assert.equal(articles.length, 1);
    assert.equal(articles[0].url, 'https://example.com/valid');
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].filePath, /2026-01-24-unterminated\.md$/);
  });
});
