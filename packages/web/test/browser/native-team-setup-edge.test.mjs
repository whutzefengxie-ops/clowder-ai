import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create, runtimes, select, setup } from './native-team-setup.harness.mjs';

test(
  'regression: deselecting a logged-out Claude never submits or blocks that partner',
  { timeout: 30000 },
  async () => {
    const tools = runtimes.map((runtime) =>
      runtime.id === 'claude'
        ? { ...runtime, readiness: { status: 'login_required', loginCommand: 'claude auth login' } }
        : runtime,
    );
    const state = await setup({ runtimes: tools });
    try {
      await select(state, 29);
      await create(state.page).click();
      await state.panel.waitFor({ state: 'hidden' });
      assert.equal(state.writes.length, 4);
      assert.ok(state.writes.every(({ payload }) => payload.clientId !== 'anthropic'));
      assert.deepEqual(state.errors, []);
    } finally {
      await state.context.close();
    }
  },
);

test('unavailable ACP adapters cannot be selected; other tools can still be created', { timeout: 30000 }, async () => {
  const tools = runtimes.map((runtime) =>
    runtime.id === 'pi' ? { ...runtime, acp: undefined, discoveryStatus: 'adapter_missing' } : runtime,
  );
  const state = await setup({ runtimes: tools });
  try {
    await state.page.getByText('其他工具与安装帮助', { exact: true }).click();
    assert.ok(await state.page.getByRole('checkbox', { name: '加入 Pi 伙伴', exact: true }).isDisabled());
    await create(state.page).click();
    await state.panel.waitFor({ state: 'hidden' });
    assert.equal(state.writes.length, 4);
    assert.deepEqual(state.errors, []);
  } finally {
    await state.context.close();
  }
});

test('deselection persists across a page reload and a fresh detection', { timeout: 30000 }, async () => {
  const state = await setup();
  try {
    await select(state, 20);
    await state.page.reload();
    await state.panel.waitFor();
    await state.page.getByText('正在检测本机工具并匹配角色…', { exact: true }).waitFor({ state: 'hidden' });
    await state.page.getByRole('button', { name: '重新检测', exact: true }).click();
    await state.page.getByText('正在检测本机工具并匹配角色…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(
      await state.page.getByRole('checkbox', { name: '加入 Claude Code 伙伴', exact: true }).isChecked(),
      false,
    );
    await create(state.page).click();
    await state.panel.waitFor({ state: 'hidden' });
    assert.equal(state.writes.length, 2);
    assert.ok(state.writes.every(({ payload }) => payload.clientId === 'acp'));
    assert.deepEqual(state.errors, []);
  } finally {
    await state.context.close();
  }
});

test(
  'partial creation survives reload and retries exactly the failed key and payload',
  { timeout: 30000 },
  async () => {
    const state = await setup({ failCreate: { at: 3, status: 503 } });
    try {
      await create(state.page).click();
      await state.panel.getByRole('alert').waitFor();
      const failed = state.writes[2];
      assert.equal(state.created.length, 2);
      await state.page.reload();
      await state.panel.waitFor();
      await state.page.getByText('正在检测本机工具并匹配角色…', { exact: true }).waitFor({ state: 'hidden' });
      await create(state.page).click();
      await state.panel.waitFor({ state: 'hidden' });
      assert.equal(state.writes.length, 6);
      assert.equal(state.created.length, 5);
      assert.equal(state.writes[3].key, failed.key);
      assert.deepEqual(state.writes[3].payload, failed.payload);
      assert.deepEqual(state.errors, []);
    } finally {
      await state.context.close();
    }
  },
);

test('double click does not create a second batch', { timeout: 30000 }, async () => {
  const state = await setup();
  try {
    await create(state.page).dblclick({ force: true });
    await state.panel.waitFor({ state: 'hidden' });
    assert.equal(state.writes.length, 5);
    assert.equal(new Set(state.writes.map(({ key }) => key)).size, 5);
    assert.deepEqual(state.errors, []);
  } finally {
    await state.context.close();
  }
});
