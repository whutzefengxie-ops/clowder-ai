// @ts-check

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('ACP startup policy import and revocation (W2)', () => {
  test('importPolicy validates schema and required fields', async () => {
    const { importPolicy } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    // Invalid schema version
    const result1 = importPolicy({
      schemaVersion: 99,
      policyId: 'test',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }],
      assurance: 'test',
    });
    assert.equal(result1.success, false);
    assert.match(result1.error, /schema version/i);

    // Missing provenance
    const result2 = importPolicy({
      schemaVersion: 1,
      policyId: 'test',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: '', auditDate: '2024-01-01', evidenceRef: '' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }],
      assurance: 'test',
    });
    assert.equal(result2.success, false);
    assert.match(result2.error, /provenance/i);

    // Missing artifacts
    const result3 = importPolicy({
      schemaVersion: 1,
      policyId: 'test',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [],
      assurance: 'test',
    });
    assert.equal(result3.success, false);
    assert.match(result3.error, /artifact/i);

    // Invalid SHA-256 hash
    const result4 = importPolicy({
      schemaVersion: 1,
      policyId: 'test',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abc' }],
      assurance: 'test',
    });
    assert.equal(result4.success, false);
    assert.match(result4.error, /SHA-256/i);
  });

  test('importPolicy accepts valid policy and makes it active', async () => {
    const { importPolicy, getActivePolicies, revokePolicy } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    const testPolicy = {
      schemaVersion: 1,
      policyId: 'test-synthetic-dsh',
      revision: 1,
      label: 'Test Synthetic DSH',
      provenance: {
        reviewer: 'test-reviewer',
        auditDate: '2024-01-01',
        evidenceRef: 'test-case',
      },
      launchShape: {
        entryPattern: 'node-absolute',
        requiredArgs: { named: { '--profile': 'acp' } },
      },
      artifacts: [
        { path: 'entry', sha256: '1a03dee18683483ff6a1b27b2a1e650230da6bcca9a0f55f7d81b3308c3f307f' },
      ],
      assurance: 'Test policy for W2 verification',
    };

    const result = importPolicy(testPolicy);
    assert.equal(result.success, true);

    // Verify it's now active
    const active = getActivePolicies();
    const imported = active.find((p) => p.policyId === 'test-synthetic-dsh');
    assert.ok(imported);
    assert.equal(imported.revision, 1);

    // Clean up
    revokePolicy('test-synthetic-dsh');
  });

  test('importPolicy rejects duplicate policyId+revision', async () => {
    const { importPolicy, revokePolicy } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    const testPolicy = {
      schemaVersion: 1,
      policyId: 'test-duplicate',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }],
      assurance: 'test',
    };

    const result1 = importPolicy(testPolicy);
    assert.equal(result1.success, true);

    const result2 = importPolicy(testPolicy);
    assert.equal(result2.success, false);
    assert.match(result2.error, /already exists/i);

    // Clean up
    revokePolicy('test-duplicate');
  });

  test('revokePolicy removes policy and prevents reuse', async () => {
    const { importPolicy, revokePolicy, isPolicyActive } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    const testPolicy = {
      schemaVersion: 1,
      policyId: 'test-revoke',
      revision: 1,
      label: 'Test',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }],
      assurance: 'test',
    };

    importPolicy(testPolicy);
    assert.equal(isPolicyActive('test-revoke', 1), true);

    const result = revokePolicy('test-revoke', 1);
    assert.equal(result.success, true);
    assert.equal(isPolicyActive('test-revoke', 1), false);
  });

  test('revokePolicy cannot revoke builtin policies', async () => {
    const { revokePolicy } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    const result = revokePolicy('builtin-pi-bridge', 1);
    assert.equal(result.success, false);
    assert.match(result.error, /builtin/i);
  });

  test('revokePolicy can revoke all revisions of a policy', async () => {
    const { importPolicy, revokePolicy, isPolicyActive } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.js'
    );

    const policy1 = {
      schemaVersion: 1,
      policyId: 'test-multi-rev',
      revision: 1,
      label: 'Test v1',
      provenance: { reviewer: 'test', auditDate: '2024-01-01', evidenceRef: 'test' },
      launchShape: { entryPattern: 'node-absolute' },
      artifacts: [{ path: 'entry', sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' }],
      assurance: 'test',
    };

    const policy2 = {
      ...policy1,
      revision: 2,
      label: 'Test v2',
      artifacts: [{ path: 'entry', sha256: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }],
    };

    importPolicy(policy1);
    importPolicy(policy2);

    assert.equal(isPolicyActive('test-multi-rev', 1), true);
    assert.equal(isPolicyActive('test-multi-rev', 2), true);

    // Revoke all revisions
    const result = revokePolicy('test-multi-rev');
    assert.equal(result.success, true);

    assert.equal(isPolicyActive('test-multi-rev', 1), false);
    assert.equal(isPolicyActive('test-multi-rev', 2), false);
  });
});
