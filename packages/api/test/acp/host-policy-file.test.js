import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowsAcpBootstrapConfigAuditWarning } from '../../dist/config/acp-bootstrap-config-audit-policy.js';
import { getAcpHostPolicy, installAcpHostPolicy, resolveAcpHostPolicy } from '../../dist/config/acp-host-policy.js';
import { ENV_VARS } from '../../dist/config/env-registry.js';
import { loadAcpHostPolicy, readHostPolicyFile } from '../../dist/config/host-policy-file.js';
import { isTrustedHostCompatibilityEnabled } from '../../dist/config/trusted-host-compatibility.js';

test('deployment presets persist without environment variables and owner policy wins per key', () => {
  const preset = { bootstrapMode: 'trusted-host', auditMode: 'warn-bootstrap-root' };
  const fromPreset = resolveAcpHostPolicy({}, 'win32', { preset });
  assert.equal(fromPreset.bootstrapMode, 'trusted-host');
  assert.equal(fromPreset.auditWarningAllowed, true);
  assert.equal(fromPreset.bootstrapSource, 'preset');
  const fromOwner = resolveAcpHostPolicy({ CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE: 'strict' }, 'win32', {
    preset,
    owner: { bootstrapMode: 'trusted-host' },
  });
  assert.equal(fromOwner.bootstrapMode, 'trusted-host');
  assert.equal(fromOwner.requestedAuditMode, 'warn-bootstrap-root');
  assert.equal(fromOwner.bootstrapSource, 'owner');
  assert.equal(fromOwner.auditSource, 'preset');
});

test('explicit environment and legacy exact-one values precede presets, while owner strict suppresses audit warning', () => {
  const preset = { bootstrapMode: 'strict', auditMode: 'required' };
  assert.equal(
    resolveAcpHostPolicy({ CAT_CAFE_TRUSTED_HOST_COMPATIBILITY: '1' }, 'win32', { preset }).auditWarningAllowed,
    true,
  );
  const policy = resolveAcpHostPolicy({ CAT_CAFE_TRUSTED_HOST_COMPATIBILITY: '1' }, 'win32', {
    preset,
    owner: { bootstrapMode: 'strict' },
  });
  assert.equal(policy.bootstrapMode, 'strict');
  assert.equal(policy.requestedAuditMode, 'warn-bootstrap-root');
  assert.equal(policy.effectiveAuditMode, 'required');
  assert.equal(policy.legacyBootstrap, false);
});

test('owner policy is optional, strictly validated, never written, and preserves UTF-8 source bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'host-policy-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'host-policy.json');
  assert.deepEqual(readHostPolicyFile(undefined), {});
  assert.deepEqual(readHostPolicyFile(path), {});
  assert.throws(() => readFileSync(path), { code: 'ENOENT' });
  for (const value of [
    '',
    'null',
    '[]',
    '{',
    '{"unknown":true}',
    '{"bootstrapMode":"STRICT"}',
    '{"auditMode":"warn"}',
  ]) {
    writeFileSync(path, value);
    assert.throws(() => readHostPolicyFile(path), /Invalid Host policy file/);
    assert.equal(readFileSync(path, 'utf8'), value);
  }
  for (const value of ['{}', '\uFEFF{"bootstrapMode":"trusted-host"}']) {
    writeFileSync(path, value);
    assert.doesNotThrow(() => readHostPolicyFile(path));
    assert.equal(readFileSync(path, 'utf8'), value);
  }
  assert.throws(() => readHostPolicyFile('relative.json'), /absolute path/);
  assert.throws(() => readHostPolicyFile(''), /absolute path/);
  assert.throws(() => readHostPolicyFile(root), /Cannot read Host policy/);
});

test('all production consumers use one startup snapshot until the next installation', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'host-policy-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'host-policy.json');
  const env = { CAT_CAFE_HOST_POLICY_FILE: path, CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE: 'strict' };
  writeFileSync(path, '{"bootstrapMode":"trusted-host","auditMode":"warn-bootstrap-root"}');
  const policy = loadAcpHostPolicy(env, 'win32');
  const restore = installAcpHostPolicy(policy);
  t.after(restore);
  assert.equal(isTrustedHostCompatibilityEnabled(), true);
  assert.equal(allowsAcpBootstrapConfigAuditWarning(), true);
  writeFileSync(path, '{"bootstrapMode":"strict","auditMode":"required"}');
  assert.equal(isTrustedHostCompatibilityEnabled(), true);
  assert.equal(allowsAcpBootstrapConfigAuditWarning(), true);
  assert.equal(getAcpHostPolicy().bootstrapSource, 'owner');
  assert.equal(Object.isFrozen(getAcpHostPolicy()), true);
  installAcpHostPolicy(loadAcpHostPolicy(env, 'win32'));
  assert.equal(isTrustedHostCompatibilityEnabled(), false);
  assert.equal(allowsAcpBootstrapConfigAuditWarning(), false);
  const definition = ENV_VARS.find((entry) => entry.name === 'CAT_CAFE_HOST_POLICY_FILE');
  assert.equal(definition?.runtimeEditable, false);
  assert.equal(definition?.restartRequired, true);
});
