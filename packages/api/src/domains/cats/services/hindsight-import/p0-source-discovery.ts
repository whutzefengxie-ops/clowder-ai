import { execFile, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  isP0AllowedSourcePath,
  isP0DiscussionSourcePath,
  normalizeSourcePath,
  P0_AGENTS_PATH,
  P0_CLAUDE_PATH,
  P0_LESSONS_PATH,
} from './p0-contract.js';
import { hasHindsightIncludeDirective } from './p0-markdown-parser.js';

const execFileAsync = promisify(execFile);

function listTrackedDocsInDir(repoRoot: string, dir: string): string[] {
  const output = execFileSync('git', ['ls-files', dir], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map((line) => normalizeSourcePath(line))
    .filter((line) => line.endsWith('.md'))
    .sort();
}

function isTrackedSource(repoRoot: string, sourcePath: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', sourcePath], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function shouldIncludeDiscussionSource(repoRoot: string, sourcePath: string): Promise<boolean> {
  if (!isP0DiscussionSourcePath(sourcePath)) return true;
  const fullPath = resolve(repoRoot, sourcePath);
  const content = await readFile(fullPath, 'utf8');
  return hasHindsightIncludeDirective(content);
}

export async function collectP0ImportSources(repoRoot: string, explicitSource?: string): Promise<string[]> {
  if (explicitSource) {
    const source = normalizeSourcePath(explicitSource);
    if (!isP0AllowedSourcePath(source)) {
      throw new Error(`source path is not in P0 allowlist: ${source}`);
    }
    if (!isTrackedSource(repoRoot, source)) {
      throw new Error(`source path is not git-tracked: ${source}`);
    }
    if (isP0DiscussionSourcePath(source) && !(await shouldIncludeDiscussionSource(repoRoot, source))) {
      throw new Error('discussion source must include frontmatter marker hindsight: include');
    }
    return [source];
  }

  const decisions = listTrackedDocsInDir(repoRoot, 'docs/decisions');
  const discussions = listTrackedDocsInDir(repoRoot, 'docs/discussions');
  const baselineSources = [P0_CLAUDE_PATH, P0_AGENTS_PATH, P0_LESSONS_PATH].filter((source) =>
    isTrackedSource(repoRoot, source),
  );
  const includedDiscussions: string[] = [];
  for (const source of discussions) {
    if (await shouldIncludeDiscussionSource(repoRoot, source)) {
      includedDiscussions.push(source);
    }
  }

  return [...decisions, ...includedDiscussions, ...baselineSources];
}

export async function readGitHeadCommit(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch {
    return null;
  }
}
