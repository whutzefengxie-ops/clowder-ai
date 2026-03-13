import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectP0ImportSources,
  readGitHeadCommit,
} from '../../dist/domains/cats/services/hindsight-import/p0-source-discovery.js';

test('collectP0ImportSources includes only git-tracked decision docs', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cat-cafe-p0-source-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'docs', 'decisions'), { recursive: true });
  writeFileSync(join(repoRoot, 'CLAUDE.md'), '# CLAUDE\n');
  writeFileSync(join(repoRoot, 'AGENTS.md'), '# AGENTS\n');
  writeFileSync(join(repoRoot, 'docs', 'lessons-learned.md'), '# Lessons\n');
  writeFileSync(join(repoRoot, 'docs', 'decisions', '001-alpha.md'), '# ADR 001\n');
  writeFileSync(join(repoRoot, 'docs', 'decisions', '999-untracked.md'), '# ADR 999\n');

  execFileSync('git', ['add', 'CLAUDE.md', 'AGENTS.md', 'docs/lessons-learned.md', 'docs/decisions/001-alpha.md'], {
    cwd: repoRoot,
  });

  const sources = await collectP0ImportSources(repoRoot);
  assert.ok(sources.includes('docs/decisions/001-alpha.md'));
  assert.ok(!sources.includes('docs/decisions/999-untracked.md'));
});

test('collectP0ImportSources includes tracked discussion docs only when frontmatter has hindsight: include', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cat-cafe-p0-discussion-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'docs', 'decisions'), { recursive: true });
  mkdirSync(join(repoRoot, 'docs', 'discussions'), { recursive: true });
  writeFileSync(join(repoRoot, 'CLAUDE.md'), '# CLAUDE\n');
  writeFileSync(join(repoRoot, 'AGENTS.md'), '# AGENTS\n');
  writeFileSync(join(repoRoot, 'docs', 'lessons-learned.md'), '# Lessons\n');
  writeFileSync(join(repoRoot, 'docs', 'decisions', '001-alpha.md'), '# ADR 001\n');
  writeFileSync(
    join(repoRoot, 'docs', 'discussions', 'included.md'),
    ['---', 'hindsight: include', '---', '', '# Included discussion'].join('\n'),
  );
  writeFileSync(
    join(repoRoot, 'docs', 'discussions', 'ignored.md'),
    ['---', 'hindsight: skip', '---', '', '# Ignored discussion'].join('\n'),
  );

  execFileSync(
    'git',
    [
      'add',
      'CLAUDE.md',
      'AGENTS.md',
      'docs/lessons-learned.md',
      'docs/decisions/001-alpha.md',
      'docs/discussions/included.md',
      'docs/discussions/ignored.md',
    ],
    { cwd: repoRoot },
  );

  const sources = await collectP0ImportSources(repoRoot);
  assert.ok(sources.includes('docs/discussions/included.md'));
  assert.ok(!sources.includes('docs/discussions/ignored.md'));
});

test('collectP0ImportSources explicit discussion source requires hindsight: include marker', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cat-cafe-p0-discussion-explicit-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'docs', 'discussions'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'docs', 'discussions', 'no-include.md'),
    ['---', 'hindsight: skip', '---', '', '# Discussion'].join('\n'),
  );
  execFileSync('git', ['add', 'docs/discussions/no-include.md'], { cwd: repoRoot });

  await assert.rejects(
    () => collectP0ImportSources(repoRoot, 'docs/discussions/no-include.md'),
    /discussion source must include frontmatter marker hindsight: include/,
  );
});

test('readGitHeadCommit returns null when repo has no git metadata', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cat-cafe-p0-nogit-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  const head = await readGitHeadCommit(repoRoot);
  assert.equal(head, null);
});

test('readGitHeadCommit returns HEAD sha for git repo', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'cat-cafe-p0-head-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  execFileSync('git', ['init'], { cwd: repoRoot });
  writeFileSync(join(repoRoot, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  const head = await readGitHeadCommit(repoRoot);
  assert.ok(head);
  assert.match(head, /^[0-9a-f]{40}$/);
});
