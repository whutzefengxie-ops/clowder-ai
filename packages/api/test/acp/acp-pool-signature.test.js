// @ts-check

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('ACP pool spawn signature', () => {
  test('never reuses a volume-admitted pool for an unclassified startup', async () => {
    const { createAcpPoolSpawnSignature } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/acp-pool-signature.js'
    );
    const base = {
      command: 'node',
      args: [],
      cwd: '/bootstrap',
      maxLiveProcesses: 3,
      idleTtlMs: 30000,
      transport: 'stdio',
    };
    assert.notEqual(
      createAcpPoolSpawnSignature(base),
      createAcpPoolSpawnSignature({ ...base, bootstrapIsolation: 'builtin-pi' }),
    );
  });
  test('changes when supportsMultiplexing changes', async () => {
    const { createAcpPoolSpawnSignature } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/acp-pool-signature.js'
    );
    const base = {
      command: 'agent',
      args: ['--acp'],
      cwd: '/repo',
      env: { TOKEN: 'x' },
      openCodeRuntimeConfig: null,
      maxLiveProcesses: 3,
      idleTtlMs: 30_000,
      transport: 'stdio',
    };

    const singleFlight = createAcpPoolSpawnSignature({ ...base, supportsMultiplexing: false });
    const multiplexed = createAcpPoolSpawnSignature({ ...base, supportsMultiplexing: true });
    const omitted = createAcpPoolSpawnSignature(base);

    assert.notEqual(singleFlight, multiplexed);
    assert.equal(omitted, singleFlight);
  });

  test('changes when the derived member context policy changes', async () => {
    const { createAcpPoolSpawnSignature } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/acp-pool-signature.js'
    );
    const base = {
      command: 'agent',
      args: ['--acp'],
      cwd: '/repo',
      maxLiveProcesses: 3,
      idleTtlMs: 30_000,
      transport: 'stdio',
    };
    const first = createAcpPoolSpawnSignature({
      ...base,
      contextPolicy: { windowTokens: 200_000 },
    });
    const second = createAcpPoolSpawnSignature({
      ...base,
      contextPolicy: { windowTokens: 128_000 },
    });
    assert.notEqual(first, second);
  });

  test('changes when the startup policy changes (W3: policy revocation)', async () => {
    const { createAcpPoolSpawnSignature } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/acp-pool-signature.js'
    );
    const base = {
      command: 'dsh',
      args: ['--profile', 'acp'],
      cwd: '/bootstrap',
      maxLiveProcesses: 3,
      idleTtlMs: 30_000,
      transport: 'stdio',
    };

    // Different policy IDs produce different signatures
    const policy1 = createAcpPoolSpawnSignature({
      ...base,
      policyId: 'dsh-0.2.0-rc.2',
      policyRevision: 1,
    });
    const policy2 = createAcpPoolSpawnSignature({
      ...base,
      policyId: 'dsh-0.3.0',
      policyRevision: 1,
    });
    assert.notEqual(policy1, policy2, 'Different policy IDs should produce different signatures');

    // Different revisions of the same policy produce different signatures
    const rev1 = createAcpPoolSpawnSignature({
      ...base,
      policyId: 'dsh-0.2.0-rc.2',
      policyRevision: 1,
    });
    const rev2 = createAcpPoolSpawnSignature({
      ...base,
      policyId: 'dsh-0.2.0-rc.2',
      policyRevision: 2,
    });
    assert.notEqual(rev1, rev2, 'Different policy revisions should produce different signatures');

    // No policy info should differ from having policy info
    const noPolicy = createAcpPoolSpawnSignature(base);
    assert.notEqual(noPolicy, policy1, 'Absence of policy info should produce different signature');
  });
});
