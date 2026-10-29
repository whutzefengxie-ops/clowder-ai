/**
 * W2: frozen L0 input (C06) — parent-side payload assembly, child rendering
 * from the frozen snapshot only, fail-closed validation, digest-keyed cache and
 * cat-catalog cache invalidation.
 *
 * Runnable without a `packages/api/dist` build for the frozen-path tests (they
 * spawn the real compiler script with `--frozen-input` and import API src via
 * tsx). The frozen-vs-legacy byte-equivalence test needs the legacy path's
 * child-side `dist` bootstrap and skips with an explicit reason until the Lead
 * builds the API package.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import type { CatCafeConfig, CatConfig } from '@cat-cafe/shared';
import { buildIdentityBlock, resolveUserCapsule } from '../../../scripts/compile-system-prompt-l0.mjs';
import { parseRawCatConfig, toAllCatConfigs } from '../src/config/cat-config-loader.js';
import { resolveMemberIdentity } from '../src/config/member-identity-resolution.js';
import { findRawMemberLocation, projectRoleProfile } from '../src/config/member-profile-projection.js';
import { compileL0ViaSubprocess } from '../src/domains/cats/services/agents/providers/l0-compiler.js';
import { L0DependencySignatureTracker } from '../src/domains/cats/services/agents/providers/l0-dependency-signature.js';
import {
  buildL0FrozenInput,
  computeL0FrozenInputDigest,
  L0_FROZEN_INPUT_VERSION,
  type L0FrozenInputBody,
  type L0FrozenInputV1,
  resolveFrozenCapsuleSection,
} from '../src/domains/cats/services/agents/providers/l0-frozen-input.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts/compile-system-prompt-l0.mjs');
const API_DIST_READY = existsSync(resolve(REPO_ROOT, 'packages/api/dist/config/cat-config-loader.js'));

interface RawVariantShape {
  catId?: string;
  roleDescription?: string;
  personality?: string;
}

interface RawBreedShape {
  id: string;
  catId?: string;
  variants: RawVariantShape[];
}

interface RawCatalogShape {
  breeds: RawBreedShape[];
  [key: string]: unknown;
}

function loadRawCatalog(): RawCatalogShape {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'cat-template.json'), 'utf8')) as RawCatalogShape;
}

function toTypedCatalog(raw: RawCatalogShape): CatCafeConfig {
  return parseRawCatConfig(JSON.stringify(raw));
}

function findRawVariant(raw: RawCatalogShape, catId: string): RawVariantShape {
  for (const breed of raw.breeds) {
    for (const variant of breed.variants) {
      if ((variant.catId ?? breed.catId) === catId) return variant;
    }
  }
  throw new Error(`fixture variant not found: ${catId}`);
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeDossier(root: string, catId: string, selfDescription: string): void {
  mkdirSync(join(root, 'docs/team'), { recursive: true });
  writeFileSync(
    join(root, 'docs/team/cat-dossier.md'),
    `# frozen fixture dossier

\`\`\`yaml
# structured-profile: cat:${catId}
entityId: "cat:${catId}"
l0SelfDescription: "${selfDescription}"
\`\`\`
`,
    'utf8',
  );
}

function writeCapsule(profileDir: string, body: string): void {
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'capsule.md'), body, 'utf8');
}

function minimalMember(catId: string): CatConfig {
  const config = toAllCatConfigs(toTypedCatalog(loadRawCatalog()))[catId];
  assert.ok(config, `fixture member ${catId} missing from the shipped template`);
  return config;
}

/** Minimal structurally-valid owner payload used to exercise the compiler seam. */
function frozenPayload(catId: string, role: string): L0FrozenInputV1 {
  const body: L0FrozenInputBody = {
    version: L0_FROZEN_INPUT_VERSION,
    catId,
    projection: 'owner',
    members: [{ catId, config: minimalMember(catId) }],
    roster: [],
    runtimeModel: 'fixture-model',
    identity: {
      roleDescription: { value: role, source: 'config' },
      personality: { value: 'fixture-personality', source: 'config' },
      selfDescription: null,
      suppressed: [],
      supplementary: [],
    },
    governanceL0: 'fixture-governance-l0',
    capsule: '',
    workflowTriggers: {
      basePath: resolve(REPO_ROOT, 'assets/prompt-templates/workflow-triggers.yaml'),
      overlayPath: null,
    },
    coCreator: null,
  };
  return { ...body, digest: computeL0FrozenInputDigest(body) };
}

function seedRepoRoot(): string {
  const root = makeTempDir('l0-frozen-repo-');
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'compile-system-prompt-l0.mjs'), '// fake compiler', 'utf8');
  mkdirSync(join(root, 'assets', 'system-prompts'), { recursive: true });
  mkdirSync(join(root, 'assets', 'prompt-templates'), { recursive: true });
  mkdirSync(join(root, 'cat-cafe-skills', 'refs'), { recursive: true });
  writeFileSync(join(root, 'assets/system-prompts/system-prompt-l0.md'), 'BASE L0 TEMPLATE', 'utf8');
  writeFileSync(join(root, 'cat-cafe-skills/refs/shared-rules.md'), 'RULES', 'utf8');
  return root;
}

interface CapturedSpawnCall {
  readonly args: readonly string[];
  readonly payloadPath: string;
  readonly payload: L0FrozenInputV1;
  readonly payloadExistedAtSpawn: boolean;
}

/**
 * Fake spawn that echoes the frozen payload's role back as stdout and records
 * the payload bytes at spawn time (proves the owned temp artifact exists then).
 */
function buildPayloadEchoSpawn(): { fn: typeof import('node:child_process').spawn; calls: CapturedSpawnCall[] } {
  const calls: CapturedSpawnCall[] = [];
  const fn = ((_cmd: string, args: readonly string[]) => {
    const payloadIdx = args.indexOf('--frozen-input');
    const payloadPath = payloadIdx >= 0 ? args[payloadIdx + 1] : '';
    assert.ok(payloadPath, 'frozen compile must pass --frozen-input');
    const payloadExistedAtSpawn = existsSync(payloadPath);
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as L0FrozenInputV1;
    calls.push({ args, payloadPath, payload, payloadExistedAtSpawn });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from(payload.identity?.roleDescription.value ?? ''));
      child.emit('close', 0);
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { fn, calls };
}

describe('frozen input payload', () => {
  test('assigns a verifiable digest and is independent of object key order', () => {
    const payload = frozenPayload('codex', 'ROLE-A');
    const { digest, ...body } = payload;
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(computeL0FrozenInputDigest(body as L0FrozenInputBody), digest);
    // Reordered shallow keys must canonicalize to the same digest.
    const reordered = Object.fromEntries(Object.entries(body).reverse()) as unknown as L0FrozenInputBody;
    assert.equal(computeL0FrozenInputDigest(reordered), digest);
  });

  test('builds identity authority, roster models and capsule from parent-side resolution', async () => {
    const dossierRoot = makeTempDir('l0-frozen-dossier-');
    const profileDir = makeTempDir('l0-frozen-profile-');
    try {
      writeDossier(dossierRoot, 'codex', 'DOSSIER-SELF-CANARY');
      writeCapsule(profileDir, 'CAPSULE-CANARY');
      const raw = loadRawCatalog();
      // Explicit member identity edit on the variant (where runtime edits land).
      const variant = findRawVariant(raw, 'codex');
      variant.roleDescription = 'EXPLICIT-ROLE-CANARY';
      variant.personality = 'EXPLICIT-PERSONALITY-CANARY';
      const catalog = toTypedCatalog(raw);
      const location = findRawMemberLocation(catalog, 'codex');
      assert.ok(location);
      const role = projectRoleProfile({
        config: toAllCatConfigs(catalog).codex,
        breed: location.breed,
        variant: location.variant,
      });
      const identity = resolveMemberIdentity({
        catId: 'codex',
        roleDescription: role.roleDescription.value,
        personality: role.personality.value,
        roleDescriptionSource: role.roleDescription.source,
        personalitySource: role.personality.source,
        dossier: { selfDescription: 'DOSSIER-SELF-CANARY' },
      });

      const payload = await buildL0FrozenInput({
        catId: 'codex',
        profileDir,
        cwd: REPO_ROOT,
        repoRoot: REPO_ROOT,
        dossierRoot,
        loadConfig: () => catalog,
        loadGovernance: async () => 'fixture-GOVERNANCE-L0',
      });

      assert.equal(payload.version, L0_FROZEN_INPUT_VERSION);
      assert.equal(payload.projection, 'owner');
      assert.equal(payload.governanceL0, 'fixture-GOVERNANCE-L0');
      assert.match(payload.capsule, /CAPSULE-CANARY/);
      assert.equal(payload.runtimeModel, toAllCatConfigs(catalog).codex.defaultModel);
      assert.deepEqual(payload.identity?.roleDescription, { value: 'EXPLICIT-ROLE-CANARY', source: 'config' });
      assert.equal(
        payload.identity?.selfDescription,
        null,
        'explicit identity must suppress the dossier self description',
      );
      assert.equal(identity.suppressed[0]?.text, 'DOSSIER-SELF-CANARY');
      assert.deepEqual(payload.identity?.suppressed, [
        { text: 'DOSSIER-SELF-CANARY', reason: 'explicit_config_identity' },
      ]);
      assert.equal(payload.members.length, 1);
      assert.equal(payload.members[0]?.catId, 'codex');
      // Roster is available teammates only, each with its runtime model resolved now.
      assert.ok(payload.roster.length > 0);
      assert.ok(payload.roster.every((entry) => entry.catId !== 'codex'));
      assert.ok(
        payload.roster.every((entry) => typeof entry.runtimeModel === 'string' && entry.runtimeModel.length > 0),
      );
      assert.ok(payload.coCreator !== null);
    } finally {
      rmSync(dossierRoot, { recursive: true, force: true });
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test('fails closed before spawn when the member is unresolvable', async () => {
    const spawn = buildPayloadEchoSpawn();
    await assert.rejects(
      () =>
        compileL0ViaSubprocess({
          catId: 'ghost-member',
          cwd: REPO_ROOT,
          spawnFn: spawn.fn,
          buildFrozenInput: async () => {
            throw new Error('frozen snapshot unavailable: ghost-member');
          },
        }),
      /snapshot unavailable|ghost-member/,
    );
    assert.equal(spawn.calls.length, 0, 'no child process may be spawned without a snapshot');
  });

  test('rejects a tampered payload before spawn', async () => {
    const spawn = buildPayloadEchoSpawn();
    const payload = frozenPayload('codex', 'ROLE-A');
    const identity = payload.identity;
    if (!identity) throw new Error('fixture payload must include identity authority');
    const tampered: L0FrozenInputV1 = {
      ...payload,
      identity: { ...identity, roleDescription: { value: 'TAMPERED', source: 'config' } },
    };
    await assert.rejects(
      () =>
        compileL0ViaSubprocess({
          catId: 'codex',
          cwd: REPO_ROOT,
          spawnFn: spawn.fn,
          buildFrozenInput: async () => tampered,
        }),
      /digest mismatch/,
    );
    assert.equal(spawn.calls.length, 0);
  });
});

describe('frozen compiler path', () => {
  test('child renders the frozen catalog, not the live one, and ignores a later member edit', async () => {
    const dossierRoot = makeTempDir('l0-frozen-e2e-dossier-');
    const profileDir = makeTempDir('l0-frozen-e2e-profile-');
    const payloadFile = join(makeTempDir('l0-frozen-e2e-payload-'), 'payload.json');
    try {
      writeCapsule(profileDir, 'CAPSULE-E2E-CANARY');
      const raw = loadRawCatalog();
      const variant = findRawVariant(raw, 'codex');
      variant.roleDescription = 'FROZEN-ROLE-CANARY';
      variant.personality = 'FROZEN-PERSONALITY-CANARY';
      const catalogA = toTypedCatalog(raw);
      const payload = await buildL0FrozenInput({
        catId: 'codex',
        profileDir,
        cwd: REPO_ROOT,
        repoRoot: REPO_ROOT,
        dossierRoot,
        loadConfig: () => catalogA,
        loadGovernance: async () => '## 3. 家规 fixture-GOV-L0-CANARY',
      });
      writeFileSync(payloadFile, JSON.stringify(payload), 'utf8');

      // Simulate a member edit after capture: the payload must stay authoritative.
      const mutatedRaw = loadRawCatalog();
      findRawVariant(mutatedRaw, 'codex').roleDescription = 'LIVE-EDIT-ROLE-CANARY';
      void toTypedCatalog(mutatedRaw);

      const result = spawnSync(process.execPath, [SCRIPT_PATH, '--frozen-input', payloadFile], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 60000,
        // Prove the frozen child never re-reads member configuration: point the
        // template env at a missing file. A legacy child would fail here.
        env: { ...process.env, CAT_TEMPLATE_PATH: join(dossierRoot, 'does-not-exist.json') },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = result.stdout;
      assert.match(output, /FROZEN-ROLE-CANARY/, 'frozen child must render the captured config role');
      assert.match(output, /FROZEN-PERSONALITY-CANARY/);
      assert.doesNotMatch(output, /LIVE-EDIT-ROLE-CANARY/);
      assert.match(output, /CAPSULE-E2E-CANARY/);
      assert.match(output, /fixture-GOV-L0-CANARY/);
      assert.match(output, /Identity constant: `@codex` model=/);
      assert.match(output, /## 队友名册/);
      assert.match(output, /@opus/);
      // The frozen payload cannot include the live catalog's later edit.
      const frozenAgain = JSON.parse(readFileSync(payloadFile, 'utf8')) as L0FrozenInputV1;
      assert.equal(frozenAgain.identity?.roleDescription.value, 'FROZEN-ROLE-CANARY');
    } finally {
      rmSync(dossierRoot, { recursive: true, force: true });
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(dirname(payloadFile), { recursive: true, force: true });
    }
  });

  test('legacy-compatible members without explicit identity keep the dossier self description', async () => {
    const dossierRoot = makeTempDir('l0-frozen-legacy-dossier-');
    const profileDir = makeTempDir('l0-frozen-legacy-profile-');
    const payloadFile = join(makeTempDir('l0-frozen-legacy-payload-'), 'payload.json');
    try {
      writeCapsule(profileDir, 'CAPSULE-LEGACY-CANARY');
      writeDossier(dossierRoot, 'codex', 'DOSSIER-LEGACY-CANARY');
      // `codex` still declares a variant personality in the shipped template, so
      // drop it to model a member whose identity has no explicit config edit.
      const raw = loadRawCatalog();
      const variant = findRawVariant(raw, 'codex');
      delete variant.roleDescription;
      delete variant.personality;
      const catalog = toTypedCatalog(raw);
      const payload = await buildL0FrozenInput({
        catId: 'codex',
        profileDir,
        cwd: REPO_ROOT,
        repoRoot: REPO_ROOT,
        dossierRoot,
        loadConfig: () => catalog,
        loadGovernance: async () => 'fixture-GOV-LEGACY',
      });
      assert.deepEqual(payload.identity?.selfDescription, {
        text: 'DOSSIER-LEGACY-CANARY',
        source: 'dossier',
        legacyCompatibility: true,
      });
      writeFileSync(payloadFile, JSON.stringify(payload), 'utf8');

      const result = spawnSync(process.execPath, [SCRIPT_PATH, '--frozen-input', payloadFile], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 60000,
        env: { ...process.env, CAT_TEMPLATE_PATH: join(dossierRoot, 'does-not-exist.json') },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /角色与自我校准：DOSSIER-LEGACY-CANARY/);
    } finally {
      rmSync(dossierRoot, { recursive: true, force: true });
      rmSync(profileDir, { recursive: true, force: true });
      rmSync(dirname(payloadFile), { recursive: true, force: true });
    }
  });

  test('capsule resolution matches the legacy compiler helper byte-for-byte', () => {
    const profileDir = makeTempDir('l0-capsule-parity-');
    try {
      writeCapsule(profileDir, 'CAPSULE-PARITY-BODY');
      mkdirSync(join(profileDir, 'relationship'), { recursive: true });
      writeFileSync(join(profileDir, 'relationship', 'maine-coon-primer.md'), 'PRIMER', 'utf8');
      mkdirSync(join(profileDir, 'corpus'), { recursive: true });
      writeFileSync(join(profileDir, 'corpus', 'shared-facts.md'), 'FACT', 'utf8');

      const legacy = resolveUserCapsule(profileDir, 'maine-coon');
      const frozen = resolveFrozenCapsuleSection(profileDir, 'maine-coon');
      assert.equal(frozen, legacy);
      assert.match(frozen, /CAPSULE-PARITY-BODY/);
      assert.match(frozen, /关系轨迹: cat-cafe-profile:\/\/relationship\/current/);
      assert.match(frozen, /共享事实: cat-cafe-profile:\/\/corpus\/current/);
    } finally {
      rmSync(profileDir, { recursive: true, force: true });
    }
  });

  test('identity block applies explicit config authority and preserves legacy bytes otherwise', () => {
    const config = { ...minimalMember('codex'), catId: 'codex' } as CatConfig & { catId: string };
    const explicitIdentity = {
      roleDescription: { value: 'CONFIG-ROLE-WINS', source: 'config' as const },
      personality: { value: 'CONFIG-PERSONALITY-WINS', source: 'config' as const },
      selfDescription: null,
      suppressed: [{ text: 'DOSS-SELF-CANARY', reason: 'explicit_config_identity' as const }],
      supplementary: [],
    };
    const explicitBlock = buildIdentityBlock(config, 'fixture-model', REPO_ROOT, explicitIdentity);
    assert.match(explicitBlock, /角色：CONFIG-ROLE-WINS/);
    assert.doesNotMatch(explicitBlock, /DOSS-SELF-CANARY/);

    const legacyFill = {
      ...explicitIdentity,
      selfDescription: { text: 'DOSS-SELF-CANARY', source: 'dossier' as const, legacyCompatibility: true },
    };
    const legacyBlock = buildIdentityBlock(config, 'fixture-model', REPO_ROOT, legacyFill);
    assert.match(legacyBlock, /角色与自我校准：DOSS-SELF-CANARY/);

    const supplementaryIdentity = {
      ...explicitIdentity,
      supplementary: [{ text: 'SUPPLEMENT-CANARY', source: 'dossier' as const, legacyCompatibility: false }],
    };
    const supplementaryBlock = buildIdentityBlock(config, 'fixture-model', REPO_ROOT, supplementaryIdentity);
    assert.match(supplementaryBlock, /补充事实（dossier，独立来源）：/);
    assert.match(supplementaryBlock, /SUPPLEMENT-CANARY/);
  });

  test('passes --frozen-input, keys cache by payload digest and removes the temp artifact', async () => {
    const root = seedRepoRoot();
    const dataDir = makeTempDir('l0-frozen-cachedata-');
    const spawn = buildPayloadEchoSpawn();
    const payloadA = frozenPayload('codex', 'ROLE-A');
    const payloadB = frozenPayload('codex', 'ROLE-B');
    const compile = (payload: L0FrozenInputV1) =>
      compileL0ViaSubprocess({
        catId: 'codex',
        userId: 'default-user',
        cwd: root,
        dataDir,
        spawnFn: spawn.fn,
        buildFrozenInput: async () => payload,
      });
    try {
      const first = await compile(payloadA);
      assert.equal(first, 'ROLE-A');
      assert.equal(spawn.calls.length, 1);
      assert.ok(spawn.calls[0]?.args.includes('--frozen-input'));
      // The owned temp artifact existed during spawn and is removed afterwards.
      assert.equal(spawn.calls[0]?.payloadExistedAtSpawn, true);
      assert.equal(
        existsSync(dirname(spawn.calls[0]?.payloadPath ?? '')),
        false,
        'frozen payload temp dir must be cleaned',
      );

      assert.equal(await compile(payloadA), 'ROLE-A');
      assert.equal(spawn.calls.length, 1, 'identical payload digest must hit the cache');

      assert.equal(await compile(payloadB), 'ROLE-B');
      assert.equal(spawn.calls.length, 2, 'changed member input must invalidate the cache');

      // A saved member edit changes the catalog hash -> dependency invalidation.
      mkdirSync(join(root, '.cat-cafe'), { recursive: true });
      writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), '{"version":2,"breeds":[]}', 'utf8');
      assert.equal(await compile(payloadB), 'ROLE-B');
      assert.equal(spawn.calls.length, 3, 'cat-catalog content changes must invalidate cached L0');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('dependency signature includes the cat catalog content hash', () => {
    const root = seedRepoRoot();
    try {
      writeFileSync(join(root, 'cat-template.json'), '{"version":2,"template":1}', 'utf8');
      mkdirSync(join(root, '.cat-cafe'), { recursive: true });
      writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), '{"version":2,"catalog":1}', 'utf8');
      const tracker = new L0DependencySignatureTracker();
      const scriptPath = join(root, 'scripts', 'compile-system-prompt-l0.mjs');
      let invalidations = 0;
      const refresh = () => tracker.refresh(root, scriptPath, () => invalidations++);

      const initial = refresh();
      assert.ok(initial);
      assert.equal(refresh(), initial);
      assert.equal(invalidations, 0);

      writeFileSync(join(root, '.cat-cafe', 'cat-catalog.json'), '{"version":2,"catalog":2}', 'utf8');
      const afterCatalogEdit = refresh();
      assert.notEqual(afterCatalogEdit, initial);
      assert.equal(invalidations, 1);

      writeFileSync(join(root, 'cat-template.json'), '{"version":2,"template":2}', 'utf8');
      assert.notEqual(refresh(), afterCatalogEdit);
      assert.equal(invalidations, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('frozen public projection and CLI fail-closed', () => {
  function runFrozenScript(args: readonly string[], extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, ...extraEnv },
    });
  }

  test('public projection renders from the frozen payload without reading member config', async () => {
    const dir = makeTempDir('l0-frozen-public-');
    const payloadFile = join(dir, 'payload.json');
    try {
      const payload = await buildL0FrozenInput({
        catId: 'codex',
        projection: 'public',
        cwd: REPO_ROOT,
        repoRoot: REPO_ROOT,
        loadConfig: () => {
          throw new Error('public frozen payload must not read member configuration');
        },
      });
      assert.equal(payload.projection, 'public');
      writeFileSync(payloadFile, JSON.stringify(payload), 'utf8');
      const result = runFrozenScript(['--frozen-input', payloadFile], {
        CAT_TEMPLATE_PATH: join(dir, 'does-not-exist.json'),
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Identity constant: `@codex`/);
      assert.doesNotMatch(result.stdout, /队友名册/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects missing, unsupported, tampered and mismatched snapshots', () => {
    const dir = makeTempDir('l0-frozen-refused-');
    try {
      const missing = runFrozenScript(['--frozen-input', join(dir, 'missing.json')]);
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /frozen input unreadable/);

      const unsupportedPath = join(dir, 'unsupported.json');
      writeFileSync(unsupportedPath, JSON.stringify({ version: 99, catId: 'codex' }), 'utf8');
      const unsupported = runFrozenScript(['--frozen-input', unsupportedPath]);
      assert.notEqual(unsupported.status, 0);
      assert.match(unsupported.stderr, /unsupported frozen input version 99/);

      const payload = frozenPayload('codex', 'ROLE-CLI');
      const tamperedPath = join(dir, 'tampered.json');
      const tampered = {
        ...payload,
        members: [{ catId: 'codex', config: { ...payload.members[0]?.config, roleDescription: 'TAMPERED' } }],
      };
      writeFileSync(tamperedPath, JSON.stringify(tampered), 'utf8');
      const tamperedResult = runFrozenScript(['--frozen-input', tamperedPath]);
      assert.notEqual(tamperedResult.status, 0);
      assert.match(tamperedResult.stderr, /digest mismatch/);

      const validPath = join(dir, 'valid.json');
      writeFileSync(validPath, JSON.stringify(payload), 'utf8');
      const catMismatch = runFrozenScript(['--cat', 'opus', '--frozen-input', validPath]);
      assert.notEqual(catMismatch.status, 0);
      assert.match(catMismatch.stderr, /does not match frozen input catId/);
      // A valid payload without --cat still renders.
      const ok = runFrozenScript(['--frozen-input', validPath]);
      assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('frozen vs legacy L0', () => {
  test('produces byte-identical output for the same captured member', async (t) => {
    if (!API_DIST_READY) {
      t.skip('requires packages/api/dist build (legacy child bootstrap imports dist); Lead runs the build');
      return;
    }
    const { clearL0Cache } = await import('../src/domains/cats/services/agents/providers/l0-compiler.js');
    const dataDir = makeTempDir('l0-equivalence-data-');
    const templateDir = makeTempDir('l0-equivalence-template-');
    const templatePath = join(templateDir, 'cat-template.json');
    try {
      writeFileSync(templatePath, readFileSync(resolve(REPO_ROOT, 'cat-template.json'), 'utf8'), 'utf8');
      writeCapsule(join(dataDir, 'profiles', 'default-user'), 'CAPSULE-EQUIVALENCE-CANARY');

      const previousTemplatePath = process.env.CAT_TEMPLATE_PATH;
      process.env.CAT_TEMPLATE_PATH = templatePath;
      try {
        clearL0Cache();
        const legacy = await compileL0ViaSubprocess({
          catId: 'codex',
          userId: 'default-user',
          cwd: REPO_ROOT,
          dataDir,
          frozenInputMode: 'legacy',
        });
        clearL0Cache();
        const frozen = await compileL0ViaSubprocess({
          catId: 'codex',
          userId: 'default-user',
          cwd: REPO_ROOT,
          dataDir,
        });
        assert.equal(frozen, legacy, 'frozen render must match the legacy render for the same input');
        assert.match(frozen, /CAPSULE-EQUIVALENCE-CANARY/);
        assert.match(frozen, /## 3. 家规（shared-rules.md）/);
        assert.match(frozen, /## 队友名册/);
      } finally {
        if (previousTemplatePath === undefined) delete process.env.CAT_TEMPLATE_PATH;
        else process.env.CAT_TEMPLATE_PATH = previousTemplatePath;
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(templateDir, { recursive: true, force: true });
    }
  });
});
