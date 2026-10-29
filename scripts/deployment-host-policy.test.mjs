import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectDeploymentProfiles, resolveDeploymentDefaults } from '../packages/shared/src/deployment-defaults.ts';

test('host policy is optional, validated and projected only from the selected deployment', () => {
  const input = JSON.parse(
    readFileSync(new URL('../packages/shared/src/deployment-profiles.json', import.meta.url), 'utf8'),
  );
  const profile = structuredClone(input.profiles[input.activeProfile]);
  delete profile.hostPolicy;
  input.activeProfile = 'intranet-fixture';
  input.profiles = { 'intranet-fixture': profile, 'public-fixture': structuredClone(profile) };
  assert.equal(resolveDeploymentDefaults(input).hostPolicy, undefined);
  input.profiles['intranet-fixture'].hostPolicy = { bootstrapMode: 'trusted-host', auditMode: 'warn-bootstrap-root' };
  input.profiles['public-fixture'].hostPolicy = { bootstrapMode: 'strict' };
  assert.deepEqual(resolveDeploymentDefaults(input).hostPolicy, input.profiles['intranet-fixture'].hostPolicy);
  const projected = projectDeploymentProfiles(input, 'public-fixture');
  assert.deepEqual(resolveDeploymentDefaults(projected).hostPolicy, { bootstrapMode: 'strict' });
  assert.equal(JSON.stringify(projected).includes('trusted-host'), false);
  for (const bad of [null, [], 'strict', { bootstrapMode: 'typo' }, { auditMode: 'warn' }, { other: 'strict' }]) {
    input.profiles['intranet-fixture'].hostPolicy = bad;
    assert.throws(() => resolveDeploymentDefaults(input), /hostPolicy/);
  }
});
