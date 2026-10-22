import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { assertPlainPath, atomicWrite, defaultPreparationAdapters, readOptional } from './intranet-preparation-io.mjs';
import { acquirePreparationLock, recoverPreparationLock } from './intranet-preparation-lock.mjs';

const BOOTSTRAP = 'CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE';
const AUDIT = 'CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE';
const MARKER = 'CLOWDER_INTR_DEPLOYMENT_PREPARATION';
const permitted = new Set([BOOTSTRAP, AUDIT, 'AUDIT_LOG_DIR', 'CAT_CAFE_DATA_DIR', MARKER]);
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');

export function deploymentValues(contents) {
  const values = {};
  for (const line of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !permitted.has(match[1])) continue;
    const [, key, raw] = match;
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate deployment key: ${key}`);
    const quoted = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
    values[key] = quoted ? raw.slice(1, -1) : raw;
  }
  return values;
}

function validate(values) {
  for (const [key, allowed] of [
    [BOOTSTRAP, ['strict', 'trusted-host']],
    [AUDIT, ['required', 'warn-bootstrap-root']],
  ])
    if (values[key] !== undefined && !allowed.includes(values[key]))
      throw new Error(`Invalid ${key}; existing deployment configuration was preserved`);
  for (const key of ['AUDIT_LOG_DIR', 'CAT_CAFE_DATA_DIR'])
    if (values[key] !== undefined && (!values[key].trim() || /[\r\n\0$`]/.test(values[key])))
      throw new Error(`Invalid or dynamic ${key}; supply a literal deployment path`);
}

function quote(value) {
  const literal = value.replaceAll('\\', '/');
  if (/[\r\n\0']/.test(literal))
    throw new Error('Deployment path cannot be represented safely in the shared dotenv format');
  return `'${literal}'`;
}

function loadRecord(path) {
  const text = readOptional(path);
  if (text === undefined) return undefined;
  const record = JSON.parse(text);
  if (
    record.schemaVersion !== 1 ||
    !/^[a-f0-9-]{36}$/.test(record.preparationId) ||
    !['pending', 'appended', 'complete'].includes(record.stage)
  )
    throw new Error('Invalid preparation receipt; preserve it and inspect before retrying');
  return record;
}

/** Explicit deployment-owner operation. Normal launchers and API never call this writer. */
export async function prepareIntranetDeployment(options) {
  if (!options.hostRoot || !isAbsolute(options.hostRoot))
    throw new Error('hostRoot must be an explicit absolute Host source directory');
  const hostRoot = resolve(options.hostRoot);
  assertPlainPath(hostRoot);
  if (
    JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8')).name !== 'cat-cafe' ||
    JSON.parse(readFileSync(join(hostRoot, 'packages/api/package.json'), 'utf8')).name !== '@cat-cafe/api'
  )
    throw new Error('Target is not a source Host deployment');
  const stateRoot = join(hostRoot, '.cat-cafe');
  assertPlainPath(stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(stateRoot, 'deployment-preparation.lock');
  if (options.recoverStaleLock) recoverPreparationLock(lockPath, readOptional);
  const release = acquirePreparationLock(lockPath);
  try {
    return await prepareLocked({ ...options, hostRoot, stateRoot });
  } finally {
    release();
  }
}

async function prepareLocked(options) {
  const { hostRoot, stateRoot } = options;
  const envPath = join(hostRoot, '.env');
  const previous = readOptional(envPath);
  const existing = deploymentValues(previous ?? '');
  const local = deploymentValues(readOptional(join(hostRoot, '.env.local')) ?? '');
  if ([BOOTSTRAP, AUDIT, 'AUDIT_LOG_DIR', 'CAT_CAFE_DATA_DIR'].some((key) => Object.hasOwn(local, key)))
    throw new Error(
      'Host .env.local contains deployment policy/path overrides; consolidate them into the shared Host .env before preparation to keep Windows and Bash consistent',
    );
  const values = { ...options.deploymentEnv, ...existing };
  validate(values);
  const apiCwd = join(hostRoot, 'packages/api');
  const oldDirectory = join(apiCwd, 'data/audit-logs');
  const adapters = options.appendAudit ? options : { ...(await defaultPreparationAdapters(hostRoot)), ...options };
  let auditDirectory;
  if (values.AUDIT_LOG_DIR !== undefined) auditDirectory = resolve(apiCwd, values.AUDIT_LOG_DIR);
  else if (existsSync(oldDirectory)) auditDirectory = oldDirectory;
  else {
    if (!adapters.resolveDataRoot && !values.CAT_CAFE_DATA_DIR)
      throw new Error('A real Host data-root resolver is required for a new default audit path');
    const declaredDataRoot =
      values.CAT_CAFE_DATA_DIR && !values.CAT_CAFE_DATA_DIR.startsWith('~')
        ? resolve(apiCwd, values.CAT_CAFE_DATA_DIR)
        : values.CAT_CAFE_DATA_DIR;
    const dataRoot = adapters.resolveDataRoot
      ? adapters.resolveDataRoot(declaredDataRoot, homedir())
      : resolve(declaredDataRoot);
    auditDirectory = join(dataRoot, 'audit-logs');
  }
  assertPlainPath(auditDirectory);
  const receiptPath = join(stateRoot, 'deployment-preparation.json');
  const previousReceipt = readOptional(receiptPath);
  let receipt = loadRecord(receiptPath);
  const targetFingerprint = fingerprint(
    JSON.stringify({
      hostRoot,
      auditDirectory,
      bootstrap: values[BOOTSTRAP] ?? 'trusted-host',
      audit: values[AUDIT] ?? 'warn-bootstrap-root',
    }),
  );
  if (receipt && receipt.targetFingerprint !== targetFingerprint)
    throw new Error(
      'Preparation target changed; existing receipt and audit history were preserved. Review an explicit deployment migration separately',
    );
  if (
    receipt?.stage === 'complete' &&
    existing[MARKER] === receipt.preparationId &&
    [BOOTSTRAP, AUDIT, 'AUDIT_LOG_DIR'].every((key) => Object.hasOwn(existing, key))
  )
    return { status: 'unchanged', envPath, auditDirectory, preparationId: receipt.preparationId };
  if (!receipt) {
    receipt = { schemaVersion: 1, preparationId: randomUUID(), targetFingerprint, stage: 'pending' };
    atomicWrite(receiptPath, `${JSON.stringify(receipt)}\n`, previousReceipt);
  }
  if (receipt.stage === 'pending') {
    const found = adapters.lookupAudit
      ? await adapters.lookupAudit({ auditDirectory, preparationId: receipt.preparationId })
      : false;
    if (!found)
      await adapters.appendAudit({
        auditDirectory,
        event: {
          type: 'host.deployment.audit-readiness',
          data: { schemaVersion: 1, preparationId: receipt.preparationId, operation: 'explicit-intranet-preparation' },
        },
      });
    const captured = readOptional(receiptPath);
    receipt.stage = 'appended';
    atomicWrite(receiptPath, `${JSON.stringify(receipt)}\n`, captured);
  }
  const additions = [];
  for (const [key, value] of [
    [BOOTSTRAP, values[BOOTSTRAP] ?? 'trusted-host'],
    [AUDIT, values[AUDIT] ?? 'warn-bootstrap-root'],
    ['AUDIT_LOG_DIR', values.AUDIT_LOG_DIR ?? auditDirectory],
    [MARKER, receipt.preparationId],
  ]) {
    if (!Object.hasOwn(existing, key)) additions.push(`${key}=${quote(value)}`);
  }
  if (existing[MARKER] && existing[MARKER] !== receipt.preparationId)
    throw new Error('Preparation marker conflicts with the receipt; no deployment configuration was changed');
  const newline = previous?.includes('\r\n') ? '\r\n' : '\n';
  const next = `${previous ?? ''}${previous && !previous.endsWith('\n') ? newline : ''}${additions.join(newline)}${additions.length ? newline : ''}`;
  await options.beforeCommit?.();
  atomicWrite(envPath, next, previous);
  const captured = readOptional(receiptPath);
  receipt.stage = 'complete';
  atomicWrite(receiptPath, `${JSON.stringify(receipt)}\n`, captured);
  return { status: 'prepared', envPath, auditDirectory, preparationId: receipt.preparationId };
}
