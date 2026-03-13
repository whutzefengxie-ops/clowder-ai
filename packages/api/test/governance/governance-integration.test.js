import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { tryGovernanceBootstrap } from '../../dist/config/capabilities/capability-orchestrator.js';
import { GOVERNANCE_PACK_VERSION, MANAGED_BLOCK_START } from '../../dist/config/governance/governance-pack.js';
import { GovernanceRegistry } from '../../dist/config/governance/governance-registry.js';

describe('governance integration with capability-orchestrator', () => {
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

  it('returns needsConfirmation for never-bootstrapped project', async () => {
    const result = await tryGovernanceBootstrap(externalProject, catCafeRoot);
    assert.equal(result.bootstrapped, false);
    assert.equal(result.needsConfirmation, true);
  });

  it('auto-bootstraps confirmed project', async () => {
    // Pre-register as confirmed
    const registry = new GovernanceRegistry(catCafeRoot);
    await registry.register(externalProject, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc123',
      syncedAt: Date.now(),
      confirmedByUser: true,
    });

    const result = await tryGovernanceBootstrap(externalProject, catCafeRoot);
    assert.equal(result.bootstrapped, true);
    assert.equal(result.needsConfirmation, false);

    // Verify files were actually written
    const claudeMd = await readFile(join(externalProject, 'CLAUDE.md'), 'utf-8');
    assert.ok(claudeMd.includes(MANAGED_BLOCK_START));
  });

  it('does not auto-bootstrap unconfirmed project', async () => {
    // Register but NOT confirmed
    const registry = new GovernanceRegistry(catCafeRoot);
    await registry.register(externalProject, {
      packVersion: '0.9.0',
      checksum: 'old',
      syncedAt: Date.now(),
      confirmedByUser: false,
    });

    const result = await tryGovernanceBootstrap(externalProject, catCafeRoot);
    assert.equal(result.bootstrapped, false);
    assert.equal(result.needsConfirmation, true);
  });

  it('governance health returns never-synced for unknown project', async () => {
    const registry = new GovernanceRegistry(catCafeRoot);
    const health = await registry.checkHealth(externalProject);
    assert.equal(health.status, 'never-synced');
    assert.equal(health.packVersion, null);
  });

  it('governance health returns healthy after bootstrap', async () => {
    // Pre-register and bootstrap
    const registry = new GovernanceRegistry(catCafeRoot);
    await registry.register(externalProject, {
      packVersion: GOVERNANCE_PACK_VERSION,
      checksum: 'abc123',
      syncedAt: Date.now(),
      confirmedByUser: true,
    });
    await tryGovernanceBootstrap(externalProject, catCafeRoot);

    const health = await registry.checkHealth(externalProject);
    assert.equal(health.status, 'healthy');
    assert.equal(health.packVersion, GOVERNANCE_PACK_VERSION);
  });

  it('governance health returns stale for old version', async () => {
    const registry = new GovernanceRegistry(catCafeRoot);
    await registry.register(externalProject, {
      packVersion: '0.9.0',
      checksum: 'old',
      syncedAt: Date.now() - 86400000,
      confirmedByUser: true,
    });

    const health = await registry.checkHealth(externalProject);
    assert.equal(health.status, 'stale');
  });
});
