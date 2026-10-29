/**
 * W1: member profile projection + identity authority (C02).
 *
 * Pure unit coverage: role/execution projections and their config/inherited/
 * default provenance, null/empty preservation, the distinct clientId/provider/
 * carrier/implementation concepts, and explicit-config-wins-over-dossier
 * identity resolution. No database, no filesystem writes, no model calls.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import type { CatCafeConfig, MemberProfilePreview } from '@cat-cafe/shared';
import { parseRawCatConfig, toAllCatConfigs } from '../src/config/cat-config-loader.js';
import {
  hasExplicitIdentity,
  resolveMemberIdentity,
  toIdentityAuthorityPreview,
} from '../src/config/member-identity-resolution.js';
import {
  findRawMemberLocation,
  projectExecutionProfile,
  projectMemberProfile,
  projectRoleProfile,
} from '../src/config/member-profile-projection.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

interface RawVariantShape {
  catId?: string;
  roleDescription?: string;
  personality?: string;
  nickname?: string | null;
  teamStrengths?: string;
  avatar?: string;
  caution?: string | null;
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

function loadCatalogShape(): RawCatalogShape {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, 'cat-template.json'), 'utf8')) as RawCatalogShape;
}

function toTypedConfig(raw: RawCatalogShape): CatCafeConfig {
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

describe('member profile projection', () => {
  test('labels explicit variant, inherited breed and default provenance separately', () => {
    const raw = loadCatalogShape();
    const config = toTypedConfig(raw);
    const catId = 'codex';
    const location = findRawMemberLocation(config, catId);
    assert.ok(location, 'codex must be located in the fixture catalog');
    const effective = toAllCatConfigs(config)[catId];
    assert.ok(effective, 'codex must have an effective config');

    const role = projectRoleProfile({ config: effective, breed: location.breed, variant: location.variant });
    // `codex` declares no variant roleDescription -> inherited from the breed.
    assert.equal(role.roleDescription.source, 'inherited');
    assert.equal(role.roleDescription.value, location.breed.roleDescription);
    // `codex` declares a personality on the variant -> explicit config.
    assert.equal(role.personality.source, 'config');
    assert.equal(role.personality.value, location.variant.personality);
    // displayName comes from the breed.
    assert.equal(role.displayName.source, 'inherited');
    // teamStrengths is a breed declaration -> inherited by the member.
    assert.equal(role.teamPosition.source, 'inherited');
    assert.equal(role.teamPosition.value, location.breed.teamStrengths);
    // No caution declaration anywhere in the fixture -> default null.
    assert.equal(role.collaborationRules.caution.source, 'default');
    assert.equal(role.collaborationRules.caution.value, null);
    assert.deepEqual(role.collaborationRules.restrictions.value, []);

    // Identity edits always land on the variant (runtime-cat-catalog update rules).
    const editedRaw = loadCatalogShape();
    const editedVariant = findRawVariant(editedRaw, catId);
    editedVariant.roleDescription = 'EXPLICIT-ROLE-CANARY';
    editedVariant.nickname = null;
    editedVariant.caution = null;
    const editedConfig = toTypedConfig(editedRaw);
    const editedLocation = findRawMemberLocation(editedConfig, catId);
    assert.ok(editedLocation);
    const editedRole = projectRoleProfile({
      config: toAllCatConfigs(editedConfig)[catId],
      breed: editedLocation.breed,
      variant: editedLocation.variant,
    });
    assert.equal(editedRole.roleDescription.source, 'config');
    assert.equal(editedRole.roleDescription.value, 'EXPLICIT-ROLE-CANARY');
    // Explicit null is preserved as a config-sourced null (not an absent field).
    assert.equal(editedRole.nickname.value, null);
    assert.equal(editedRole.nickname.source, 'config');
    assert.equal(editedRole.collaborationRules.caution.value, null);
    assert.equal(editedRole.collaborationRules.caution.source, 'config');
  });

  test('execution projection keeps client, provider, carrier and implementation distinct', () => {
    const raw = loadCatalogShape();
    const config = toTypedConfig(raw);
    const location = findRawMemberLocation(config, 'codex');
    assert.ok(location);
    const effective = toAllCatConfigs(config).codex;
    const execution = projectExecutionProfile({
      config: effective,
      breed: location.breed,
      variant: location.variant,
    });

    assert.equal(execution.catId, 'codex');
    assert.equal(execution.clientId.value, effective.clientId);
    assert.equal(execution.carrier.value, effective.carrier);
    assert.equal(execution.model.value, effective.defaultModel);
    assert.equal(execution.model.source, 'config');
    // model preference, client kind, model provider and implementation ref are
    // separate fields; none of them is derived from another.
    assert.notEqual(execution.clientId.value, execution.provider.value);
    assert.equal(execution.implementationRef.value, effective.agentProvider ?? null);
    assert.equal(execution.implementationRef.source, effective.agentProvider === undefined ? 'default' : 'config');
    assert.equal(execution.provider.value, effective.provider ?? null);
    // Absent effort means "inherit from the native client", not an empty string.
    assert.equal(execution.effort.value, effective.cli?.effort ?? null);
    assert.deepEqual(execution.launchArgs.defaultArgs.value, effective.cli?.defaultArgs ?? []);
    assert.equal(execution.mcpExposure.value, effective.mcpSupport);
  });

  test('projection is read-only and does not change flat fields', () => {
    const raw = loadCatalogShape();
    const config = toTypedConfig(raw);
    const effective = Object.freeze(toAllCatConfigs(config).codex);
    const before = JSON.stringify(effective);
    const projection = projectMemberProfile({ config: effective });

    assert.equal(projection.role.catId, 'codex');
    assert.equal(projection.execution.catId, 'codex');
    assert.equal(JSON.stringify(effective), before, 'flat CatConfig fields must be unchanged');
    // Dossier-free projection still produces a stable preview shape.
    const preview: MemberProfilePreview = {
      ...projection,
      identity: toIdentityAuthorityPreview(
        resolveMemberIdentity({
          catId: 'codex',
          roleDescription: projection.role.roleDescription.value,
          personality: projection.role.personality.value,
          roleDescriptionSource: projection.role.roleDescription.source,
          personalitySource: projection.role.personality.source,
        }),
      ),
    };
    assert.equal(preview.identity.selfDescription, null);
    assert.deepEqual(preview.identity.suppressed, []);
  });
});

describe('member identity authority (C02)', () => {
  const BASE = {
    catId: 'codex',
    roleDescription: 'CONFIG-ROLE',
    personality: 'CONFIG-PERSONALITY',
  };

  test('explicit config identity suppresses a conflicting dossier self-description', () => {
    const resolution = resolveMemberIdentity({
      ...BASE,
      roleDescriptionSource: 'config',
      personalitySource: 'config',
      dossier: { selfDescription: 'DOSSIER-SELF-CANARY' },
    });

    assert.equal(resolution.explicitIdentity, true);
    assert.equal(
      hasExplicitIdentity({ roleDescriptionSource: 'config', personalitySource: 'config' }),
      true,
      'explicit identity is decided by declaration provenance',
    );
    assert.equal(resolution.roleDescription.value, 'CONFIG-ROLE');
    assert.equal(resolution.roleDescription.source, 'config');
    assert.equal(resolution.selfDescription, null, 'dossier must not fill an explicitly configured identity');
    assert.deepEqual(resolution.suppressed, [{ text: 'DOSSIER-SELF-CANARY', reason: 'explicit_config_identity' }]);
    assert.deepEqual(resolution.supplementary, []);

    const preview = toIdentityAuthorityPreview(resolution);
    assert.equal(preview.suppressed[0]?.text, 'DOSSIER-SELF-CANARY');
    assert.equal(preview.selfDescription, null);
  });

  test('one explicit identity field suppresses the combined dossier self-description block', () => {
    const resolution = resolveMemberIdentity({
      ...BASE,
      roleDescriptionSource: 'inherited',
      personalitySource: 'config',
      dossier: { selfDescription: 'DOSSIER-SELF-CANARY' },
    });
    assert.equal(resolution.explicitIdentity, true);
    assert.equal(resolution.selfDescription, null);
    assert.equal(resolution.suppressed.length, 1);
  });

  test('legacy-compatible dossier fill only applies without explicit identity', () => {
    const resolution = resolveMemberIdentity({
      ...BASE,
      roleDescriptionSource: 'inherited',
      personalitySource: 'default',
      dossier: { selfDescription: 'DOSSIER-SELF-CANARY' },
    });
    assert.equal(resolution.explicitIdentity, false);
    assert.deepEqual(resolution.selfDescription, {
      text: 'DOSSIER-SELF-CANARY',
      source: 'dossier',
      legacyCompatibility: true,
    });
    assert.deepEqual(resolution.suppressed, []);
    // The config values stay visible in the preview for explainability.
    assert.equal(resolution.roleDescription.source, 'inherited');
    assert.equal(resolution.personality.source, 'default');
  });

  test('independent dossier supplements stay as a separate source when explicit identity wins', () => {
    const resolution = resolveMemberIdentity({
      ...BASE,
      roleDescriptionSource: 'config',
      personalitySource: 'config',
      dossier: {
        selfDescription: 'DOSSIER-SELF-CANARY',
        supplementary: ['DOSSIER-SUPPLEMENT-CANARY', ''],
      },
    });
    assert.deepEqual(resolution.supplementary, [
      { text: 'DOSSIER-SUPPLEMENT-CANARY', source: 'dossier', legacyCompatibility: false },
    ]);
  });

  test('absent dossier preserves empty/null semantics without inventing text', () => {
    const resolution = resolveMemberIdentity({
      catId: 'codex',
      roleDescription: 'CONFIG-ROLE',
      personality: '',
      roleDescriptionSource: 'config',
      personalitySource: 'config',
      dossier: { selfDescription: '' },
    });
    assert.equal(resolution.selfDescription, null);
    assert.deepEqual(resolution.suppressed, []);
    assert.equal(resolution.personality.value, '');
    assert.equal(resolution.personality.source, 'config');
  });
});
