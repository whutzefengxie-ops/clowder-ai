/**
 * WerewolfDefinition Tests (F101 Task B1)
 *
 * Validates that the werewolf game definition has correct roles, phases,
 * actions, and win conditions for various player presets.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createWerewolfDefinition,
  WEREWOLF_PRESETS,
} from '../dist/domains/cats/services/game/werewolf/WerewolfDefinition.js';
import { WEREWOLF_ROLES } from '../dist/domains/cats/services/game/werewolf/WerewolfRoles.js';

describe('WerewolfRoles', () => {
  it('defines all 7 standard roles', () => {
    const roleNames = Object.keys(WEREWOLF_ROLES);
    assert.ok(roleNames.includes('wolf'), 'has wolf');
    assert.ok(roleNames.includes('seer'), 'has seer');
    assert.ok(roleNames.includes('witch'), 'has witch');
    assert.ok(roleNames.includes('hunter'), 'has hunter');
    assert.ok(roleNames.includes('guard'), 'has guard');
    assert.ok(roleNames.includes('idiot'), 'has idiot');
    assert.ok(roleNames.includes('villager'), 'has villager');
  });

  it('wolf is in wolf faction, all others in village', () => {
    assert.equal(WEREWOLF_ROLES.wolf.faction, 'wolf');
    assert.equal(WEREWOLF_ROLES.seer.faction, 'village');
    assert.equal(WEREWOLF_ROLES.witch.faction, 'village');
    assert.equal(WEREWOLF_ROLES.hunter.faction, 'village');
    assert.equal(WEREWOLF_ROLES.guard.faction, 'village');
    assert.equal(WEREWOLF_ROLES.idiot.faction, 'village');
    assert.equal(WEREWOLF_ROLES.villager.faction, 'village');
  });
});

describe('WerewolfPresets', () => {
  it('has presets for 6, 7, 8, 9, 10, 12 players', () => {
    assert.ok(WEREWOLF_PRESETS[6], '6-player preset');
    assert.ok(WEREWOLF_PRESETS[7], '7-player preset');
    assert.ok(WEREWOLF_PRESETS[8], '8-player preset');
    assert.ok(WEREWOLF_PRESETS[9], '9-player preset');
    assert.ok(WEREWOLF_PRESETS[10], '10-player preset');
    assert.ok(WEREWOLF_PRESETS[12], '12-player preset');
  });

  it('each preset role count equals player count', () => {
    for (const [count, preset] of Object.entries(WEREWOLF_PRESETS)) {
      const totalRoles = Object.values(preset.roles).reduce((a, b) => a + b, 0);
      assert.equal(totalRoles, Number(count), `${count}-player preset has ${totalRoles} roles`);
    }
  });

  it('each preset has at least 1 wolf and 1 seer', () => {
    for (const [count, preset] of Object.entries(WEREWOLF_PRESETS)) {
      assert.ok(preset.roles.wolf >= 1, `${count}p has wolf`);
      assert.ok(preset.roles.seer >= 1, `${count}p has seer`);
    }
  });
});

describe('createWerewolfDefinition', () => {
  it('creates a valid GameDefinition for 6-player preset', () => {
    const def = createWerewolfDefinition(6);
    assert.equal(def.gameType, 'werewolf');
    assert.equal(def.displayName, 'Werewolf');
    assert.equal(def.minPlayers, 6);
    assert.equal(def.maxPlayers, 6);
  });

  it('has correct phase sequence', () => {
    const def = createWerewolfDefinition(8);
    const phaseNames = def.phases.map((p) => p.name);

    // Core phases must be in order
    assert.ok(phaseNames.indexOf('night_guard') < phaseNames.indexOf('night_wolf'));
    assert.ok(phaseNames.indexOf('night_wolf') < phaseNames.indexOf('night_seer'));
    assert.ok(phaseNames.indexOf('night_seer') < phaseNames.indexOf('night_witch'));
    assert.ok(phaseNames.indexOf('night_witch') < phaseNames.indexOf('night_resolve'));
    assert.ok(phaseNames.indexOf('night_resolve') < phaseNames.indexOf('day_announce'));
    assert.ok(phaseNames.indexOf('day_announce') < phaseNames.indexOf('day_discuss'));
    assert.ok(phaseNames.indexOf('day_discuss') < phaseNames.indexOf('day_vote'));
    assert.ok(phaseNames.indexOf('day_vote') < phaseNames.indexOf('day_exile'));
  });

  it('has actions matching phases', () => {
    const def = createWerewolfDefinition(8);
    const actionNames = def.actions.map((a) => a.name);

    assert.ok(actionNames.includes('kill'), 'has kill action');
    assert.ok(actionNames.includes('divine'), 'has divine action');
    assert.ok(actionNames.includes('guard'), 'has guard action');
    assert.ok(actionNames.includes('heal'), 'has heal action');
    assert.ok(actionNames.includes('poison'), 'has poison action');
    assert.ok(actionNames.includes('vote'), 'has vote action');
  });

  it('has win conditions for wolf and village', () => {
    const def = createWerewolfDefinition(8);
    const factions = def.winConditions.map((wc) => wc.faction);
    assert.ok(factions.includes('wolf'), 'wolf win condition');
    assert.ok(factions.includes('village'), 'village win condition');
  });

  it('definition roles match preset role counts', () => {
    const def = createWerewolfDefinition(8);
    // The definition should have role definitions for all preset roles
    const defRoleNames = def.roles.map((r) => r.name);
    const preset = WEREWOLF_PRESETS[8];
    for (const roleName of Object.keys(preset.roles)) {
      if (preset.roles[roleName] > 0) {
        assert.ok(defRoleNames.includes(roleName), `definition has ${roleName} role`);
      }
    }
  });
});
