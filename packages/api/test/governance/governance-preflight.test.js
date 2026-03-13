import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { GovernanceBootstrapService } from '../../dist/config/governance/governance-bootstrap.js';
import { GOVERNANCE_PACK_VERSION } from '../../dist/config/governance/governance-pack.js';
import { checkGovernancePreflight } from '../../dist/config/governance/governance-preflight.js';
import { GovernanceRegistry } from '../../dist/config/governance/governance-registry.js';

describe('governance-preflight', () => {
  let catCafeRoot;
  let externalProject;

  beforeEach(async () => {
    catCafeRoot = await mkdtemp(join(tmpdir(), 'cat-cafe-root-'));
    externalProject = await mkdtemp(join(tmpdir(), 'external-project-'));
    await mkdir(join(catCafeRoot, 'cat-cafe-skills'), { recursive: true });
  });

  afterEach(async () => {
    await rm(catCafeRoot, { recursive: true, force: true });
    await rm(externalProject, { recursive: true, force: true });
  });

  it('passes for cat-cafe project (not external)', async () => {
    const result = await checkGovernancePreflight(catCafeRoot, catCafeRoot);
    assert.equal(result.ready, true);
    assert.equal(result.reason, undefined);
  });

  it('fails for unbootstrapped external project', async () => {
    const result = await checkGovernancePreflight(externalProject, catCafeRoot);
    assert.equal(result.ready, false);
    assert.ok(result.reason?.includes('not bootstrapped'));
  });

  it('fails for unconfirmed project', async () => {
    const registry = new GovernanceRegistry(catCafeRoot);
    await registry.register(externalProject, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc',
      syncedAt: Date.now(),
      confirmedByUser: false,
    });

    const result = await checkGovernancePreflight(externalProject, catCafeRoot);
    assert.equal(result.ready, false);
    assert.ok(result.reason?.includes('confirmation'));
  });

  it('passes for bootstrapped and confirmed project', async () => {
    const service = new GovernanceBootstrapService(catCafeRoot);
    await service.bootstrap(externalProject, { dryRun: false });

    const result = await checkGovernancePreflight(externalProject, catCafeRoot);
    assert.equal(result.ready, true);
  });

  it('fails when registry confirmed but CLAUDE.md deleted', async () => {
    // Bootstrap fully, then delete CLAUDE.md
    const service = new GovernanceBootstrapService(catCafeRoot);
    await service.bootstrap(externalProject, { dryRun: false });
    await rm(join(externalProject, 'CLAUDE.md'));

    const result = await checkGovernancePreflight(externalProject, catCafeRoot);
    assert.equal(result.ready, false);
    assert.ok(result.reason?.includes('CLAUDE.md'));
  });

  it('fails when registry confirmed but skills symlinks removed', async () => {
    // Bootstrap fully, then remove all skills symlinks
    const service = new GovernanceBootstrapService(catCafeRoot);
    await service.bootstrap(externalProject, { dryRun: false });
    for (const dir of ['.claude/skills', '.codex/skills', '.gemini/skills']) {
      await rm(join(externalProject, dir), { force: true }).catch(() => {});
    }

    const result = await checkGovernancePreflight(externalProject, catCafeRoot);
    assert.equal(result.ready, false);
    assert.ok(result.reason?.includes('symlink'));
  });
});
