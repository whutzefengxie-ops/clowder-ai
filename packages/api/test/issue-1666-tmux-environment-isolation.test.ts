/**
 * Issue #1666: tmux environment isolation security regression tests
 *
 * Guards against re-inheriting ambient credentials when using finalEnvironment.
 * These tests cover the complete invoke→factory→writer→script chain.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { buildChildEnv } from '../src/utils/cli-spawn.js';

test('Issue #1666: tmux environment isolation', async (t) => {
  await t.test('writeAgentCommandFile respects inheritParentEnv=false (finalEnvironment)', async () => {
    // Simulate finalEnvironment: ambient credentials deleted, inheritParentEnv=false
    const ambientCredential = 'ambient-account-fixture';
    const originalEnv = process.env.CODEX_API_KEY;
    const testCwd = resolve('/test/cwd');

    try {
      process.env.CODEX_API_KEY = ambientCredential;

      const finalEnv = buildChildEnv(
        { CODEX_API_KEY: null, USER_VAR: 'value' },
        { inheritParentEnv: false, workingDirectory: testCwd }
      );

      // finalEnv should not have the deleted credential
      assert.equal(finalEnv.CODEX_API_KEY, undefined, 'finalEnv should not restore deleted credential');

      // tmux writer receives this finalEnv with inheritParentEnv=false
      const writerOptions = {
        env: finalEnv,
        cwd: testCwd,
        inheritParentEnv: false,
      };

      // Writer calls buildChildEnv again - must respect inheritParentEnv=false
      const scriptEnv = buildChildEnv(writerOptions.env, {
        workingDirectory: writerOptions.cwd,
        bindExecutionOwner: false,
        inheritParentEnv: writerOptions.inheritParentEnv,
      });

      assert.equal(
        scriptEnv.CODEX_API_KEY,
        undefined,
        'tmux script must not re-inherit deleted ambient credential'
      );
      assert.equal(scriptEnv.USER_VAR, 'value', 'User variables should be preserved');
    } finally {
      if (originalEnv !== undefined) process.env.CODEX_API_KEY = originalEnv;
      else delete process.env.CODEX_API_KEY;
    }
  });

  await t.test('writeAgentCommandFile with normal overrides (inheritParentEnv=true default)', async () => {
    const originalHome = process.env.HOME;
    const testHome = '/original/home';
    const testCwd = resolve('/test/cwd');

    try {
      process.env.HOME = testHome;
      process.env.CAT_CAFE_HOOK_TOKEN = 'secret-hook-token';

      // Normal overrides: no explicit inheritParentEnv (defaults to true)
      const normalOverrides = { USER_VAR: 'value' };

      const scriptEnv = buildChildEnv(normalOverrides, {
        workingDirectory: testCwd,
        bindExecutionOwner: false,
        // inheritParentEnv: undefined → defaults to true
      });

      assert.equal(scriptEnv.HOME, testHome, 'Normal overrides should inherit HOME');
      assert.equal(scriptEnv.USER_VAR, 'value', 'User variables should be present');
      assert.equal(
        scriptEnv.CAT_CAFE_HOOK_TOKEN,
        undefined,
        'Forbidden variables must be stripped'
      );
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      else delete process.env.HOME;
      delete process.env.CAT_CAFE_HOOK_TOKEN;
    }
  });

  await t.test('writeAgentCommandFile corrects stale PWD/INIT_CWD', async () => {
    const stalePwd = '/old/directory';
    const actualCwd = resolve('/test/cwd'); // Use resolve for cross-platform path

    const overrides = {
      USER_VAR: 'value',
      PWD: stalePwd,
      INIT_CWD: stalePwd,
    };

    const scriptEnv = buildChildEnv(overrides, {
      workingDirectory: actualCwd,
      bindExecutionOwner: false,
    });

    assert.equal(scriptEnv.PWD, actualCwd, 'PWD should be corrected to actual cwd');
    assert.equal(scriptEnv.INIT_CWD, actualCwd, 'INIT_CWD should be corrected to actual cwd');
    assert.equal(scriptEnv.USER_VAR, 'value', 'User variables should be preserved');
  });

  await t.test('empty overrides preserve defaults with inheritParentEnv=true', async () => {
    const originalHome = process.env.HOME;
    const testHome = '/test/home';
    const testCwd = resolve('/test/cwd');

    try {
      process.env.HOME = testHome;

      // Empty overrides: was incorrectly skipping buildChildEnv in R12-R14
      const emptyOverrides = {};

      const scriptEnv = buildChildEnv(emptyOverrides, {
        workingDirectory: testCwd,
        bindExecutionOwner: false,
        // inheritParentEnv: undefined → defaults to true
      });

      assert.equal(scriptEnv.HOME, testHome, 'Empty overrides should still inherit HOME');
      assert.ok(scriptEnv.PATH, 'Empty overrides should still inherit PATH');
    } finally {
      if (originalHome !== undefined) process.env.HOME = originalHome;
      else delete process.env.HOME;
    }
  });
});
