import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { readGitHeadCommit } from './p0-source-discovery.js';

const DEFAULT_P0_WATERMARK_PATH = process.env.HINDSIGHT_P0_WATERMARK_PATH?.trim() || 'data/hindsight/p0-watermark.json';

const p0SyncWatermarkSchema = z.object({
  version: z.literal(1),
  bankId: z.string().min(1),
  sourceCommit: z.string().min(1),
  importedAt: z.string().datetime(),
  sourceCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  sourcePaths: z.array(z.string()),
});

export type P0SyncWatermark = z.infer<typeof p0SyncWatermarkSchema>;

export interface P0Freshness {
  status: 'fresh' | 'stale' | 'unknown';
  checkedAt: string;
  headCommit?: string;
  watermarkCommit?: string;
  reason?: 'commit_match' | 'commit_mismatch' | 'watermark_missing' | 'head_unavailable';
}

function resolveWatermarkPath(repoRoot: string, relativePath?: string): string {
  return resolve(repoRoot, relativePath ?? DEFAULT_P0_WATERMARK_PATH);
}

export async function readP0SyncWatermark(repoRoot: string, relativePath?: string): Promise<P0SyncWatermark | null> {
  const watermarkPath = resolveWatermarkPath(repoRoot, relativePath);
  try {
    const raw = await readFile(watermarkPath, 'utf8');
    return p0SyncWatermarkSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeP0SyncWatermark(
  repoRoot: string,
  watermark: P0SyncWatermark,
  relativePath?: string,
): Promise<string> {
  const parsed = p0SyncWatermarkSchema.parse(watermark);
  const watermarkPath = resolveWatermarkPath(repoRoot, relativePath);
  await mkdir(dirname(watermarkPath), { recursive: true });
  await writeFile(watermarkPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return watermarkPath;
}

export function evaluateP0Freshness(headCommit: string | null, watermark: P0SyncWatermark | null): P0Freshness {
  const checkedAt = new Date().toISOString();
  if (!headCommit) {
    return {
      status: 'unknown',
      checkedAt,
      reason: 'head_unavailable',
    };
  }

  if (!watermark) {
    return {
      status: 'unknown',
      checkedAt,
      headCommit,
      reason: 'watermark_missing',
    };
  }

  if (watermark.sourceCommit === headCommit) {
    return {
      status: 'fresh',
      checkedAt,
      headCommit,
      watermarkCommit: watermark.sourceCommit,
      reason: 'commit_match',
    };
  }

  return {
    status: 'stale',
    checkedAt,
    headCommit,
    watermarkCommit: watermark.sourceCommit,
    reason: 'commit_mismatch',
  };
}

export async function getP0Freshness(repoRoot: string, relativePath?: string): Promise<P0Freshness> {
  const headCommit = await readGitHeadCommit(repoRoot);
  const watermark = await readP0SyncWatermark(repoRoot, relativePath);
  return evaluateP0Freshness(headCommit, watermark);
}
