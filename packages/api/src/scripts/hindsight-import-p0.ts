import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertUniqueP0DocumentIds } from '../domains/cats/services/hindsight-import/p0-contract.js';
import {
  buildImportItemsFromMarkdown,
  buildP0RetainOptions,
  collectP0ImportSources,
  readGitHeadCommit,
} from '../domains/cats/services/hindsight-import/p0-importer.js';
import { writeP0SyncWatermark } from '../domains/cats/services/hindsight-import/p0-watermark.js';
import { getEventAuditLog } from '../domains/cats/services/orchestration/EventAuditLog.js';
import { createHindsightClient } from '../domains/cats/services/orchestration/HindsightClient.js';

interface CliArgs {
  dryRun: boolean;
  source?: string;
  all: boolean;
  author: string;
  bank: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    all: false,
    author: 'codex',
    bank: process.env.HINDSIGHT_SHARED_BANK ?? 'cat-cafe-shared',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--source') {
      const value = argv[i + 1];
      if (value) args.source = value;
    } else if (arg === '--author') args.author = argv[i + 1] ?? args.author;
    else if (arg === '--bank') args.bank = argv[i + 1] ?? args.bank;

    if (arg === '--source' || arg === '--author' || arg === '--bank') i += 1;
  }

  return args;
}

function usage(): void {
  console.log(
    [
      'Usage:',
      '  node dist/scripts/hindsight-import-p0.js --all [--dry-run] [--author codex] [--bank cat-cafe-shared]',
      '  node dist/scripts/hindsight-import-p0.js --source docs/decisions/005-hindsight-integration-decisions.md [--dry-run]',
    ].join('\n'),
  );
}

function detectRepoRoot(startCwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startCwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    return startCwd;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && !args.source) {
    usage();
    process.exitCode = 1;
    return;
  }

  const repoRoot = detectRepoRoot(process.cwd());
  const sourcePaths = await collectP0ImportSources(repoRoot, args.source);
  assertUniqueP0DocumentIds(sourcePaths);
  const sourceCommit = await readGitHeadCommit(repoRoot);
  if (!sourceCommit) {
    throw new Error('failed to resolve git HEAD commit');
  }
  const client = createHindsightClient();
  const auditLog = getEventAuditLog();

  let totalItems = 0;
  let discussionChunkCount = 0;
  const discussionSources: string[] = [];

  for (const sourcePath of sourcePaths) {
    const absolutePath = resolve(repoRoot, sourcePath);
    const content = await readFile(absolutePath, 'utf8');
    const items = buildImportItemsFromMarkdown({
      sourcePath,
      sourceCommit,
      content,
      author: args.author,
    });
    totalItems += items.length;
    if (sourcePath.startsWith('docs/discussions/')) {
      discussionSources.push(sourcePath);
      discussionChunkCount += items.length;
    }

    if (items.length === 0) {
      console.log(`[skip] ${sourcePath}: no importable chunks`);
      continue;
    }

    if (args.dryRun) {
      console.log(`[dry-run] ${sourcePath}: ${items.length} chunks, document_id=${items[0]?.document_id ?? '-'}`);
      continue;
    }

    await client.retain(args.bank, items, buildP0RetainOptions(items[0]?.tags));
    console.log(`[retain] ${sourcePath}: ${items.length} chunks`);
  }

  if (!args.dryRun && args.all) {
    const watermarkPath = await writeP0SyncWatermark(repoRoot, {
      version: 1,
      bankId: args.bank,
      sourceCommit,
      importedAt: new Date().toISOString(),
      sourceCount: sourcePaths.length,
      chunkCount: totalItems,
      sourcePaths,
    });
    console.log(`[watermark] ${watermarkPath}`);
  }

  if (!args.dryRun && discussionSources.length > 0) {
    await auditLog.append({
      type: 'hindsight_discussion_exception_imported',
      data: {
        bankId: args.bank,
        sourceCommit,
        sourceCount: discussionSources.length,
        chunkCount: discussionChunkCount,
        sourcePaths: discussionSources,
      },
    });
    console.log(
      `[audit] discussion exceptions imported: sources=${discussionSources.length} chunks=${discussionChunkCount}`,
    );
  }

  console.log(`[done] sources=${sourcePaths.length} chunks=${totalItems} dryRun=${args.dryRun}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[error] hindsight-import-p0: ${message}`);
  process.exitCode = 1;
});
