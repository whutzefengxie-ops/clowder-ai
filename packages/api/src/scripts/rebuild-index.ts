/**
 * F102 Phase B: rebuild-index CLI
 * Scans docs/, parses frontmatter, rebuilds evidence.sqlite FTS index.
 *
 * Usage: pnpm --filter @cat-cafe/api rebuild-index [--force]
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IndexBuilder } from '../domains/memory/IndexBuilder.js';
import { SqliteEvidenceStore } from '../domains/memory/SqliteEvidenceStore.js';

interface RebuildIndexArgs {
  force: boolean;
  docsRoot: string;
  dbPath: string;
}

function parseArgs(argv: string[]): RebuildIndexArgs {
  const force = argv.includes('--force');
  const docsRoot = join(process.cwd(), 'docs');
  const dbPath = join(process.cwd(), 'data', 'evidence.sqlite');
  return { force, docsRoot, dbPath };
}

export async function runRebuildIndexCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  console.log(`[rebuild-index] docs: ${args.docsRoot}`);
  console.log(`[rebuild-index] db: ${args.dbPath}`);
  console.log(`[rebuild-index] force: ${args.force}`);

  const store = new SqliteEvidenceStore(args.dbPath);
  await store.initialize();

  const builder = new IndexBuilder(store, args.docsRoot);

  const result = await builder.rebuild({ force: args.force });

  console.log(
    `[rebuild-index] indexed: ${result.docsIndexed}, skipped: ${result.docsSkipped}, duration: ${result.durationMs}ms`,
  );

  const consistency = await builder.checkConsistency();
  if (!consistency.ok) {
    console.error(`[rebuild-index] CONSISTENCY ERROR: doc=${consistency.docCount} fts=${consistency.ftsCount}`);
    process.exitCode = 1;
  } else {
    console.log(`[rebuild-index] consistency OK (${consistency.docCount} docs)`);
  }

  store.close();
}

// Direct invocation
const entryPath = process.argv[1];
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runRebuildIndexCli().catch((err) => {
    console.error('[rebuild-index] Fatal:', err);
    process.exitCode = 1;
  });
}
