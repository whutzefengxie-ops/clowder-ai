import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface CliArgs {
  baseUrl: string;
  bank: string;
  dryRun: boolean;
  yes: boolean;
  snapshotPath?: string;
  listPathTemplate: string;
  detailPathTemplate: string;
  deletePathTemplate: string;
  selfTest: boolean;
}

interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
}

interface SnapshotDetail {
  documentId: string;
  status?: number;
  ok?: boolean;
  body?: unknown;
  error?: string;
}

interface CleanupSnapshot {
  generatedAt: string;
  baseUrl: string;
  bank: string;
  listPath: string;
  detailPathTemplate: string;
  deletePathTemplate: string;
  totalDocumentIds: number;
  candidateCount: number;
  candidates: string[];
  documentIds: string[];
  details: SnapshotDetail[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOVERNANCE_ID_PREFIXES = ['adr:', 'phase:', 'll:', 'path:docs/decisions/', 'path:docs/discussions/'];
const GOVERNANCE_ID_EXACT = new Set(['path:CLAUDE.md', 'path:AGENTS.md', 'path:docs/lessons-learned.md']);

function usage(): void {
  console.log(
    [
      'Usage:',
      '  node dist/scripts/hindsight-clean-uuid-docs.js [--dry-run]',
      '  node dist/scripts/hindsight-clean-uuid-docs.js --apply --yes',
      '',
      'Options:',
      '  --base-url <url>             default: $HINDSIGHT_URL or http://localhost:8888',
      '  --bank <bank>                default: $HINDSIGHT_SHARED_BANK or cat-cafe-shared',
      '  --dry-run                    do not delete (default)',
      '  --apply                      perform deletes (requires --yes)',
      '  --yes                        required safety flag when using --apply',
      '  --snapshot <path>            write snapshot JSON path',
      '  --list-path <template>       default: /v1/default/banks/{bankId}/documents',
      '  --detail-path <template>     default: /v1/default/banks/{bankId}/documents/{documentId}',
      '  --delete-path <template>     default: /v1/default/banks/{bankId}/documents/{documentId}',
      '  --self-test                  run parser/filter self checks',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseUrl: process.env.HINDSIGHT_URL ?? 'http://localhost:8888',
    bank: process.env.HINDSIGHT_SHARED_BANK ?? 'cat-cafe-shared',
    dryRun: true,
    yes: false,
    listPathTemplate: '/v1/default/banks/{bankId}/documents',
    detailPathTemplate: '/v1/default/banks/{bankId}/documents/{documentId}',
    deletePathTemplate: '/v1/default/banks/{bankId}/documents/{documentId}',
    selfTest: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = argv[i + 1] ?? args.baseUrl;
      i += 1;
      continue;
    }
    if (arg === '--bank') {
      args.bank = argv[i + 1] ?? args.bank;
      i += 1;
      continue;
    }
    if (arg === '--snapshot') {
      const next = argv[i + 1];
      if (typeof next === 'string') {
        args.snapshotPath = next;
      }
      i += 1;
      continue;
    }
    if (arg === '--list-path') {
      args.listPathTemplate = argv[i + 1] ?? args.listPathTemplate;
      i += 1;
      continue;
    }
    if (arg === '--detail-path') {
      args.detailPathTemplate = argv[i + 1] ?? args.detailPathTemplate;
      i += 1;
      continue;
    }
    if (arg === '--delete-path') {
      args.deletePathTemplate = argv[i + 1] ?? args.deletePathTemplate;
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--apply') {
      args.dryRun = false;
      continue;
    }
    if (arg === '--yes') {
      args.yes = true;
      continue;
    }
    if (arg === '--self-test') {
      args.selfTest = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryReadDocumentId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(value)) return null;

  const candidate = value.document_id ?? value.documentId ?? value.id ?? value.doc_id ?? value.docId;
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pushIds(source: unknown, out: Set<string>): void {
  if (Array.isArray(source)) {
    for (const item of source) {
      const id = tryReadDocumentId(item);
      if (id) out.add(id);
    }
    return;
  }

  const id = tryReadDocumentId(source);
  if (id) out.add(id);
}

function extractDocumentIds(payload: unknown): string[] {
  const ids = new Set<string>();
  if (Array.isArray(payload)) {
    pushIds(payload, ids);
    return Array.from(ids);
  }
  if (!isRecord(payload)) return [];

  pushIds(payload.document_ids, ids);
  pushIds(payload.documents, ids);
  pushIds(payload.items, ids);
  pushIds(payload.data, ids);
  pushIds(payload.results, ids);
  pushIds(payload.documentId, ids);
  pushIds(payload.document_id, ids);
  pushIds(payload.id, ids);

  return Array.from(ids);
}

function isGovernanceDocumentId(documentId: string): boolean {
  if (GOVERNANCE_ID_EXACT.has(documentId)) return true;
  return GOVERNANCE_ID_PREFIXES.some((prefix) => documentId.startsWith(prefix));
}

function isUuidDocumentId(documentId: string): boolean {
  return UUID_RE.test(documentId);
}

function selectUuidCleanupCandidates(documentIds: string[]): string[] {
  return documentIds.filter((documentId) => isUuidDocumentId(documentId) && !isGovernanceDocumentId(documentId));
}

function renderPathTemplate(template: string, bankId: string, documentId?: string): string {
  let path = template.replaceAll('{bankId}', encodeURIComponent(bankId));
  if (documentId != null) {
    path = path.replaceAll('{documentId}', encodeURIComponent(documentId));
  }
  return path;
}

function normalizeBaseUrl(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

async function request(baseUrl: string, path: string, method: 'GET' | 'DELETE'): Promise<HttpResult> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text().catch(() => '');
  let body: unknown = {};
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
  };
}

function defaultSnapshotPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(process.cwd(), 'data', 'hindsight', 'snapshots', `uuid-cleanup-${stamp}.json`);
}

async function writeSnapshot(path: string, snapshot: CleanupSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function runSelfTest(): void {
  const sampleUuidA = '6f3bf5a6-8ee0-4cc9-a5e1-9f602ec3b0d5';
  const sampleUuidB = '5f80ffcc-2e96-4e89-a4f6-a68fa08d4f0f';

  const ids = extractDocumentIds({
    document_ids: ['adr:005'],
    documents: [{ id: sampleUuidA }, { document_id: 'path:CLAUDE.md' }],
    items: [{ documentId: sampleUuidB }, { docId: 'phase:5.1' }],
  });
  assert(ids.includes('adr:005'), 'extractDocumentIds should include adr id');
  assert(ids.includes(sampleUuidA), 'extractDocumentIds should include uuid from id');
  assert(ids.includes(sampleUuidB), 'extractDocumentIds should include uuid from documentId');

  const candidates = selectUuidCleanupCandidates(ids);
  assert(candidates.length === 2, 'selectUuidCleanupCandidates should keep only non-governance UUID ids');
  assert(candidates.includes(sampleUuidA), 'candidate A missing');
  assert(candidates.includes(sampleUuidB), 'candidate B missing');

  const rendered = renderPathTemplate(
    '/v1/default/banks/{bankId}/documents/{documentId}',
    'cat-cafe-shared',
    sampleUuidA,
  );
  assert(rendered.includes('cat-cafe-shared'), 'renderPathTemplate should include bankId');
  assert(rendered.includes(sampleUuidA), 'renderPathTemplate should include documentId');

  console.log('[PASS] self-test passed');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const listPath = renderPathTemplate(args.listPathTemplate, args.bank);
  const listResult = await request(args.baseUrl, listPath, 'GET');
  if (!listResult.ok) {
    throw new Error(`document list request failed (${listResult.status}): ${listPath}`);
  }

  const documentIds = extractDocumentIds(listResult.body).sort((a, b) => a.localeCompare(b));
  const candidates = selectUuidCleanupCandidates(documentIds);
  const details: SnapshotDetail[] = [];
  for (const documentId of candidates) {
    const detailPath = renderPathTemplate(args.detailPathTemplate, args.bank, documentId);
    try {
      const detail = await request(args.baseUrl, detailPath, 'GET');
      details.push({
        documentId,
        status: detail.status,
        ok: detail.ok,
        body: detail.body,
      });
    } catch (err) {
      details.push({
        documentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const snapshot: CleanupSnapshot = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    bank: args.bank,
    listPath,
    detailPathTemplate: args.detailPathTemplate,
    deletePathTemplate: args.deletePathTemplate,
    totalDocumentIds: documentIds.length,
    candidateCount: candidates.length,
    candidates,
    documentIds,
    details,
  };
  const snapshotPath = args.snapshotPath ?? defaultSnapshotPath();
  await writeSnapshot(snapshotPath, snapshot);

  console.log(`[snapshot] ${snapshotPath}`);
  console.log(`[scan] documentIds=${documentIds.length} uuidCandidates=${candidates.length}`);

  if (args.dryRun) {
    console.log('[dry-run] no deletions performed');
    return;
  }

  if (!args.yes) {
    throw new Error('refusing to delete without --yes');
  }

  let deleted = 0;
  let failed = 0;
  for (const documentId of candidates) {
    const deletePath = renderPathTemplate(args.deletePathTemplate, args.bank, documentId);
    try {
      const result = await request(args.baseUrl, deletePath, 'DELETE');
      if (result.ok) {
        deleted += 1;
        console.log(`[delete] ok documentId=${documentId}`);
      } else {
        failed += 1;
        console.log(`[delete] fail documentId=${documentId} status=${result.status}`);
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[delete] fail documentId=${documentId} error=${msg}`);
    }
  }

  if (failed > 0) {
    throw new Error(`cleanup completed with failures: deleted=${deleted} failed=${failed}`);
  }

  console.log(`[done] deleted=${deleted} failed=${failed}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[error] hindsight-clean-uuid-docs: ${message}`);
  process.exitCode = 1;
});
