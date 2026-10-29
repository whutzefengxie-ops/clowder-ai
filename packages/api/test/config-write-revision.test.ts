import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  configSnapshotValue,
  configWriteRevision,
  MEMBER_EDITOR_CONFIG_KEYS,
  memberEditorWriteRevisions,
} from '../src/config/config-write-revision.js';
import type { ConfigSnapshotPath } from '../src/config/ConfigStore.js';

const SNAPSHOT_PATHS: Record<string, ConfigSnapshotPath> = {
  'cli.codexSandboxMode': ['cli', 'codexSandboxMode'],
  'cli.codexApprovalPolicy': ['cli', 'codexApprovalPolicy'],
  'codex.execution.authMode': ['codexExecution', 'authMode'],
};

function resolvePath(key: string): ConfigSnapshotPath | undefined {
  return SNAPSHOT_PATHS[key];
}

describe('configWriteRevision', () => {
  it('is stable for the same key/value pair', () => {
    assert.equal(configWriteRevision('cli.codexSandboxMode', 'workspace-write'), configWriteRevision('cli.codexSandboxMode', 'workspace-write'));
  });

  it('changes when the key or the value changes', () => {
    const base = configWriteRevision('cli.codexSandboxMode', 'workspace-write');
    assert.notEqual(base, configWriteRevision('cli.codexApprovalPolicy', 'workspace-write'));
    assert.notEqual(base, configWriteRevision('cli.codexSandboxMode', 'danger-full-access'));
  });

  it('canonicalizes object key order but keeps array order significant', () => {
    const left = configWriteRevision('some.key', { b: 2, a: { d: 4, c: 3 } });
    const right = configWriteRevision('some.key', { a: { c: 3, d: 4 }, b: 2 });
    assert.equal(left, right);
    assert.notEqual(configWriteRevision('some.key', [1, 2]), configWriteRevision('some.key', [2, 1]));
  });

  it('gives an absent value a stable revision', () => {
    assert.equal(configWriteRevision('some.key', undefined), configWriteRevision('some.key', undefined));
    // JSON has no `undefined`: an absent value canonicalizes like null, which is
    // acceptable because hot-updatable config keys never hold null.
    assert.equal(configWriteRevision('some.key', undefined), configWriteRevision('some.key', null));
    assert.notEqual(configWriteRevision('some.key', undefined), configWriteRevision('some.key', 'null'));
  });
});

describe('configSnapshotValue', () => {
  const snapshot = { cli: { codexSandboxMode: 'read-only' }, codexExecution: { authMode: 'auto' } };

  it('resolves a nested ConfigStore snapshot path', () => {
    assert.equal(configSnapshotValue(snapshot, ['cli', 'codexSandboxMode']), 'read-only');
    assert.equal(configSnapshotValue(snapshot, ['codexExecution', 'authMode']), 'auto');
  });

  it('returns undefined for a missing path or missing segment', () => {
    assert.equal(configSnapshotValue(snapshot, undefined), undefined);
    assert.equal(configSnapshotValue(snapshot, ['cli', 'missing']), undefined);
    assert.equal(configSnapshotValue(undefined, ['cli']), undefined);
  });
});

describe('memberEditorWriteRevisions', () => {
  const snapshot = {
    cli: { codexSandboxMode: 'workspace-write', codexApprovalPolicy: 'on-request' },
    codexExecution: { authMode: 'oauth' },
  };

  it('returns one revision per member-editor key', () => {
    const revisions = memberEditorWriteRevisions(snapshot, resolvePath);
    assert.deepEqual(Object.keys(revisions).sort(), [...MEMBER_EDITOR_CONFIG_KEYS].sort());
    assert.equal(revisions['cli.codexSandboxMode'], configWriteRevision('cli.codexSandboxMode', 'workspace-write'));
    assert.equal(revisions['cli.codexApprovalPolicy'], configWriteRevision('cli.codexApprovalPolicy', 'on-request'));
    assert.equal(revisions['codex.execution.authMode'], configWriteRevision('codex.execution.authMode', 'oauth'));
  });

  it('is stable across reads of the same snapshot and ignores unrelated config', () => {
    const first = memberEditorWriteRevisions(snapshot, resolvePath);
    const second = memberEditorWriteRevisions(
      {
        ...snapshot,
        cli: { ...snapshot.cli },
        codexExecution: { ...snapshot.codexExecution },
        cats: { opus: { model: 'changed' } },
      },
      resolvePath,
    );
    assert.deepEqual(second, first);
  });

  it('changes only the revision of the value that changed', () => {
    const before = memberEditorWriteRevisions(snapshot, resolvePath);
    const after = memberEditorWriteRevisions(
      { ...snapshot, cli: { ...snapshot.cli, codexApprovalPolicy: 'never' } },
      resolvePath,
    );
    assert.notEqual(after['cli.codexApprovalPolicy'], before['cli.codexApprovalPolicy']);
    assert.equal(after['cli.codexSandboxMode'], before['cli.codexSandboxMode']);
    assert.equal(after['codex.execution.authMode'], before['codex.execution.authMode']);
  });
});
