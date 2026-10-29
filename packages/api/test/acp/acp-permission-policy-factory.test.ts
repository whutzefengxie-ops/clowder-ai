/**
 * C09/O1: the ACP factory turns the member's explicit `permissionPolicy` into
 * the client's fail-closed default decision.
 *
 * Default/missing/invalid => 'reject'; only an exact `'auto_allow'` => 'allow';
 * iCode keeps its stricter adapter contract (reject) even when the member opts
 * in. Imports src via tsx so it runs without the api dist build; the same wiring
 * is asserted against dist in acp-icode-adapter.test.js after the Lead's build.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createAcpServiceForConfig } from '../../src/domains/cats/services/agents/providers/acp/AcpServiceFactory.js';
import { createAcpPoolSpawnSignature } from '../../src/domains/cats/services/agents/providers/acp/acp-pool-signature.js';

type AcpConfigOverrides = {
  protocolAdapter?: 'icode';
  modelProfileId?: string;
  permissionPolicy?: string;
};

function makeBaseInput(
  projectRoot: string,
  profileId: string,
  poolRegistry: Map<string, { closeAll?: () => Promise<void>; clientFactory: () => { config: Record<string, unknown> } }>,
  acpConfig: AcpConfigOverrides,
) {
  return {
    projectRoot,
    profileId,
    effectiveModel: 'gpt-5.6-sol',
    config: {
      id: profileId,
      name: 'ACP policy test',
      displayName: 'ACP policy test',
      color: { primary: '#111827', secondary: '#e5e7eb' },
      avatar: '/avatars/default.png',
      mentionPatterns: [`@${profileId}`],
      roleDescription: 'factory policy test member',
      clientId: 'acp',
      defaultModel: 'gpt-5.6-sol',
      mcpSupport: false,
    },
    poolRegistry,
    log: { info() {}, warn() {} },
    acpConfig: { command: 'mock-acp', startupArgs: ['acp'], ...acpConfig },
  };
}

async function decisionFor(acpConfig: AcpConfigOverrides, profileId: string): Promise<unknown> {
  const projectRoot = mkdtempSync(join(tmpdir(), 'acp-policy-factory-'));
  const poolRegistry = new Map<string, { closeAll?: () => Promise<void>; clientFactory: () => { config: Record<string, unknown> } }>();
  try {
    const service = await createAcpServiceForConfig(makeBaseInput(projectRoot, profileId, poolRegistry, acpConfig));
    assert.ok(service, `factory must produce a service for ${profileId}`);
    const pool = poolRegistry.get(profileId);
    assert.ok(pool, 'factory must register a pool');
    return pool.clientFactory().config.defaultPermissionDecision;
  } finally {
    await Promise.all([...poolRegistry.values()].map((pool) => pool.closeAll?.()));
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

describe('AcpServiceFactory permissionPolicy wiring (C09)', () => {
  it('fails closed for members without an explicit policy', async () => {
    assert.equal(await decisionFor({}, 'policy-default'), 'reject');
  });

  it('threads an explicit auto_allow opt-in and denies explicit deny', async () => {
    assert.equal(await decisionFor({ permissionPolicy: 'auto_allow' }, 'policy-allow'), 'allow');
    assert.equal(await decisionFor({ permissionPolicy: 'deny' }, 'policy-deny'), 'reject');
  });

  it('treats an invalid policy value as deny', async () => {
    assert.equal(await decisionFor({ permissionPolicy: 'allow' }, 'policy-invalid'), 'reject');
  });

  it('keeps iCode reject-only even when the member opts into auto_allow', async () => {
    assert.equal(
      await decisionFor({ protocolAdapter: 'icode', modelProfileId: 'profile-sol', permissionPolicy: 'auto_allow' }, 'policy-icode'),
      'reject',
    );
  });
});

describe('ACP pool generation key includes the permission decision (C09)', () => {
  const base = {
    command: 'mock-acp',
    args: ['acp'],
    cwd: '/tmp',
    maxLiveProcesses: 3,
    idleTtlMs: 30_000,
    transport: 'stdio' as const,
  };

  it('produces a new pool generation when an explicit auto_allow is revoked', () => {
    const allowed = createAcpPoolSpawnSignature({ ...base, permissionDecision: 'allow' });
    const rejected = createAcpPoolSpawnSignature({ ...base, permissionDecision: 'reject' });
    assert.notEqual(allowed, rejected, 'revoking auto_allow must retire the warm client generation');
    assert.equal(createAcpPoolSpawnSignature(base), rejected, 'absent decision means fail closed');
  });

  it('replaces the registered pool when the member permissionPolicy changes', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'acp-policy-pool-'));
    const profileId = 'policy-pool-revocable';
    const poolRegistry = new Map<
      string,
      {
        closeAll?: () => Promise<void>;
        clientFactory: () => { config: Record<string, unknown> };
      }
    >();
    try {
      const first = await createAcpServiceForConfig(makeBaseInput(projectRoot, profileId, poolRegistry, {}));
      assert.ok(first);
      const firstPool = poolRegistry.get(profileId);
      assert.ok(firstPool);
      assert.equal(firstPool.clientFactory().config.defaultPermissionDecision, 'reject');

      const second = await createAcpServiceForConfig(
        makeBaseInput(projectRoot, profileId, poolRegistry, { permissionPolicy: 'auto_allow' }),
      );
      assert.ok(second);
      const secondPool = poolRegistry.get(profileId);
      assert.ok(secondPool);
      assert.notEqual(secondPool, firstPool, 'the stale client closure must not be reused');
      assert.equal(secondPool.clientFactory().config.defaultPermissionDecision, 'allow');
    } finally {
      await Promise.all([...poolRegistry.values()].map((pool) => pool.closeAll?.()));
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
