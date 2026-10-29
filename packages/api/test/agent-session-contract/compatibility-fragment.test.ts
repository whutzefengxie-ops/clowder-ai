import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IdentityAdoptionArtifact } from '@cat-cafe/shared';
import {
  COMPATIBILITY_FIELDS,
  COMPATIBILITY_KEY_VERSION,
  compareCompatibility,
  computeCompatibilityKey,
  digestText,
  stableConfigDigest,
  toSessionCompatibilitySnapshot,
} from '../../src/domains/cats/services/agents/session-contract/compatibility-key.js';
import type {
  CompatibilityField,
  CompatibilityStructure,
} from '../../src/domains/cats/services/agents/session-contract/compatibility-key.js';
import {
  HARD_BOUNDARY_FIELDS,
  decide,
  sanitizeChangedFields,
} from '../../src/domains/cats/services/agents/session-contract/fragment-decision.js';
import type {
  FragmentCapabilities,
  FragmentDecisionInput,
} from '../../src/domains/cats/services/agents/session-contract/fragment-decision.js';
import { SessionChainStore } from '../../src/domains/cats/services/stores/ports/SessionChainStore.js';

const structure = (extra: CompatibilityStructure = {}): CompatibilityStructure => ({
  clientId: 'claude',
  carrier: 'sdk',
  implementation: 'builtin:claude',
  accountRef: 'acct:1',
  nativeHome: '/home/me/.claude',
  workspaceRoot: '/repo',
  workspaceFingerprint: 'fp-1',
  model: 'model-a',
  permissionMode: 'request-review',
  instructionDigest: digestText('instructions:v1\nbe nice'),
  ...extra,
});

const capabilities = (extra: Partial<FragmentCapabilities> = {}): FragmentCapabilities => ({
  identityUpdate: 'new_fragment_only',
  ...extra,
});

const artifact = (instructionDigest: string): IdentityAdoptionArtifact => ({
  v: 1,
  instructionDigest,
  evidenceRef: 'adopt:1',
  adoptedAt: 1,
});

const decideFor = (input: Omit<FragmentDecisionInput, 'capabilities'> & { capabilities?: FragmentCapabilities }) =>
  decide({ capabilities: capabilities(), ...input });

const target = digestText('instructions:v1\nnew identity');

test('keyVersion is explicit and structural: same structure => same digest', () => {
  const first = computeCompatibilityKey(structure());
  const second = computeCompatibilityKey(structure());
  assert.equal(first.keyVersion, COMPATIBILITY_KEY_VERSION);
  assert.equal(first.keyVersion, 1);
  assert.equal(first.digest, second.digest);
  assert.deepEqual(first, second);
});

test('C13: callback tokens, delivery ids, invocation ids, temp paths and avatars never enter the key', () => {
  const structuralExtras = {
    callbackToken: 'secret-token',
    deliveryId: 'delivery-1',
    invocationId: 'invocation-1',
    tempPath: '/tmp/workspace-1234',
    avatar: 'data:image/png;base64,AAA',
    color: '#ff00ff',
  } as CompatibilityStructure;
  const first = computeCompatibilityKey({ ...structure(), ...structuralExtras });
  const second = computeCompatibilityKey({ ...structure(), ...structuralExtras, callbackToken: 'other-token' });
  assert.equal(first.digest, second.digest, 'invocation-local fields must not change the compatibility key');
});

test('launch config digest ignores secrets/ids/temp paths but follows real launch config', () => {
  const base = { model: 'm', args: ['--sandbox', 'read-only'], callbackToken: 'a', deliveryId: 'd', tmpDir: '/tmp/x' };
  assert.equal(stableConfigDigest(base), stableConfigDigest({ ...base, callbackToken: 'b', deliveryId: 'e' }));
  assert.notEqual(stableConfigDigest(base), stableConfigDigest({ ...base, args: ['--sandbox', 'workspace-write'] }));
});

test('a structural change is reported per field and is never compatible', () => {
  for (const field of COMPATIBILITY_FIELDS) {
    const changedValue = field === 'model' ? 'model-b' : `${field}-changed`;
    const next = structure({ [field]: changedValue } as CompatibilityStructure);
    const comparison = compareCompatibility(structure(), next);
    assert.equal(comparison.compatible, false, field);
    assert.deepEqual(comparison.changed, [field], field);
  }
});

test('legacy/missing or foreign-version keys are unverifiable, not compatible', () => {
  assert.deepEqual(compareCompatibility(undefined, structure()), {
    compatible: false,
    changed: [],
    reason: 'no_previous_key',
  });
  assert.equal(compareCompatibility(structure(), undefined).reason, 'missing_next_structure');
  const foreign = { ...toSessionCompatibilitySnapshot(computeCompatibilityKey(structure())), keyVersion: 0 as const };
  const comparison = compareCompatibility(foreign, structure());
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.reason, 'key_version_mismatch');
  assert.equal(comparison.previousKeyVersion, 0);
});

test('persisted snapshot compares equal to the live structure only when unchanged', () => {
  const snapshot = toSessionCompatibilitySnapshot(computeCompatibilityKey(structure()));
  assert.equal(compareCompatibility(snapshot, structure()).compatible, true);
  assert.deepEqual(compareCompatibility(snapshot, structure({ model: 'model-b' })).changed, ['model']);
});

test('C07: display-only / unrelated changes reach the decision as reuse', () => {
  // avatar/colour/unrelated catalog fields are simply absent from the key.
  const avatarOnly = decideFor({ changed: [] });
  assert.deepEqual(avatarOnly, { action: 'reuse', reason: 'no_structural_change', requiresVerifiedAdoption: false });
  assert.deepEqual(sanitizeChangedFields(['avatar', 'color', 'nicknameLabel'] as CompatibilityField[]), []);
  assert.deepEqual(decideFor({ changed: sanitizeChangedFields(['avatar']) as CompatibilityField[] }).action, 'reuse');
});

test('C10/C01: identity changes only update in place with verified capability AND matching adoption artifact', () => {
  const noCapability = decideFor({ changed: ['instructionDigest'] });
  assert.deepEqual(noCapability, {
    action: 'new_fragment',
    reason: 'identity_update_unverified',
    requiresVerifiedAdoption: false,
  });
  const unverified = decideFor({
    changed: ['instructionDigest'],
    capabilities: capabilities({ identityUpdate: 'in_place_unverified' }),
  });
  assert.equal(unverified.action, 'new_fragment');
  const missingArtifact = decideFor({
    changed: ['instructionDigest'],
    capabilities: capabilities({ identityUpdate: 'in_place_verified' }),
  });
  assert.deepEqual(missingArtifact, {
    action: 'new_fragment',
    reason: 'adoption_artifact_missing',
    requiresVerifiedAdoption: false,
  });
  const staleArtifact = decideFor({
    changed: ['instructionDigest'],
    capabilities: capabilities({ identityUpdate: 'in_place_verified' }),
    requested: { instructionDigest: target, identityArtifact: artifact(digestText('other')) },
  });
  assert.equal(staleArtifact.reason, 'adoption_artifact_stale');
  const adopted = decideFor({
    changed: ['instructionDigest'],
    capabilities: capabilities({ identityUpdate: 'in_place_verified' }),
    requested: { instructionDigest: target, identityArtifact: artifact(target) },
  });
  assert.deepEqual(adopted, {
    action: 'in_place_update',
    reason: 'identity_update_verified',
    requiresVerifiedAdoption: true,
  });
});

test('C07: hard boundaries always start a new fragment, before any soft capability', () => {
  for (const field of HARD_BOUNDARY_FIELDS) {
    const decision = decideFor({
      changed: [field],
      capabilities: capabilities({ identityUpdate: 'in_place_verified' }),
    });
    assert.equal(decision.action, 'new_fragment', field);
    assert.equal(decision.reason, 'hard_boundary_changed', field);
    assert.equal(decision.requiresVerifiedAdoption, false);
  }
  assert.deepEqual(decideFor({ changed: ['accountRef', 'instructionDigest'] }).reason, 'hard_boundary_changed');
});

test('C07: implementation generation change rebuilds', () => {
  const decision = decideFor({ changed: ['implementationGeneration'] });
  assert.deepEqual(decision, {
    action: 'new_fragment',
    reason: 'implementation_generation_changed',
    requiresVerifiedAdoption: false,
  });
});

test('C07: model/effort update only with a client-verified update; otherwise a new fragment', () => {
  assert.deepEqual(decideFor({ changed: ['model'] }), {
    action: 'new_fragment',
    reason: 'model_update_unverified',
    requiresVerifiedAdoption: false,
  });
  assert.equal(decideFor({ changed: ['effort'] }).reason, 'model_update_unverified');
  const verified = decideFor({
    changed: ['model'],
    capabilities: capabilities({ modelUpdate: 'verified' }),
  });
  assert.deepEqual(verified, {
    action: 'in_place_update',
    reason: 'model_update_verified',
    requiresVerifiedAdoption: true,
  });
});

test('C07: permission/MCP changes need a verified dynamic update, else a new fragment; launch config always rebuilds', () => {
  assert.equal(decideFor({ changed: ['permissionMode'] }).reason, 'permission_update_unverified');
  assert.equal(
    decideFor({ changed: ['permissionMode'], capabilities: capabilities({ permissionUpdate: 'verified_dynamic' }) })
      .action,
    'in_place_update',
  );
  assert.equal(decideFor({ changed: ['mcpSurfaceDigest'] }).reason, 'mcp_update_unverified');
  assert.equal(
    decideFor({ changed: ['mcpSurfaceDigest'], capabilities: capabilities({ mcpUpdate: 'verified_dynamic' }) }).action,
    'in_place_update',
  );
  assert.deepEqual(decideFor({ changed: ['launchConfigDigest'] }), {
    action: 'new_fragment',
    reason: 'launch_config_changed',
    requiresVerifiedAdoption: false,
  });
});

test('explicit preferences and unverifiable input fail closed', () => {
  assert.equal(decideFor({ changed: [], requested: { preference: 'new_fragment' } }).reason, 'requested_new_fragment');
  assert.deepEqual(decideFor({ changed: 'unverifiable' }), {
    action: 'new_fragment',
    reason: 'unverifiable_structure',
    requiresVerifiedAdoption: false,
  });
  assert.deepEqual(decideFor({ changed: ['instructionDigest'], requested: { preference: 'reuse' } }).action, 'new_fragment');
});

test('W3 persistence: compat/identityArtifact/fragmentSwitch round-trip in the in-memory store', () => {
  const store = new SessionChainStore();
  const snapshot = toSessionCompatibilitySnapshot(computeCompatibilityKey(structure()));
  const identity = artifact(target);
  const switchRecord = { at: 123, reason: 'identity_update_unverified', changed: ['instructionDigest'] };
  const created = store.create({
    threadId: 'thread-w3',
    catId: 'opus',
    userId: 'user-1',
    compat: snapshot,
    identityArtifact: identity,
    fragmentSwitch: switchRecord,
  });
  const loaded = store.get(created.id);
  assert.deepEqual(loaded?.compat, snapshot);
  assert.deepEqual(loaded?.identityArtifact, identity);
  assert.deepEqual(loaded?.fragmentSwitch, switchRecord);

  const updatedCompat = toSessionCompatibilitySnapshot(computeCompatibilityKey(structure({ model: 'model-b' })));
  store.update(created.id, { compat: updatedCompat });
  assert.deepEqual(store.get(created.id)?.compat, updatedCompat);
  assert.equal(store.getChain('opus', 'thread-w3', 'user-1')[0]?.compat?.digest, updatedCompat.digest);
});

test('W3 legacy record without compat is unverifiable and decides a new fragment', () => {
  const store = new SessionChainStore();
  const legacy = store.create({ threadId: 'thread-legacy', catId: 'opus', userId: 'user-1' });
  assert.equal(legacy.compat, undefined);
  const comparison = compareCompatibility(legacy.compat, structure());
  assert.equal(comparison.compatible, false);
  assert.equal(comparison.reason, 'no_previous_key');
  assert.deepEqual(decideFor({ changed: 'unverifiable' }).action, 'new_fragment');
});
