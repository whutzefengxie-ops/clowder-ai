import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

// Browser contract lane: real production page and hooks, injected HTTP boundary
// faults. This lane is NOT evidence that a model authenticated or replied.
const base = process.env.CAT_CAFE_ONBOARDING_E2E_URL;
const evidence = process.env.CAT_CAFE_ONBOARDING_E2E_EVIDENCE;
assert.ok(base && evidence, 'Pass the explicitly owned isolated URL and evidence directory');
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && !['3003', '3004'].includes(origin.port));
const labels = ['Codex', 'Claude Code', 'DSH', 'Kimi', 'Pi'];
const ids = ['codex', 'claude', 'dsh', 'kimi', 'pi'];
const runtimes = labels.map((label, index) => ({
  id: ids[index],
  label,
  installed: true,
  models: [],
  clientId: ['openai', 'anthropic', 'acp', 'kimi', 'acp'][index],
  configuredModel: `fixture-${ids[index]}`,
  ...(index === 2 || index === 4 ? { acp: { command: 'fixture', startupArgs: [], transport: 'stdio' } } : {}),
  readiness: { status: 'configured' },
}));
let browser;
before(async () => {
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const writes = [],
    errors = [];
  let discoveryFails = options.discoveryFails ?? false;
  let failure = options.failCreate;
  let discovered = options.runtimes ?? runtimes;
  const created = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/cats/native-runtimes*', (route) =>
    route.fulfill({
      status: discoveryFails ? 503 : 200,
      json: discoveryFails ? { error: 'fixture discovery unavailable' } : { runtimes: discovered },
    }),
  );
  await context.route('**/api/cats', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { cats: options.existing ?? [] } });
    const payload = route.request().postDataJSON();
    const key = route.request().headers()['idempotency-key'];
    writes.push({ payload, key });
    if (failure && writes.length === failure.at) {
      const status = failure.status;
      failure = undefined;
      return route.fulfill({ status, json: { error: 'fixture account unavailable' } });
    }
    const cat = { ...payload, id: `fixture-${created.length}`, mentionPatterns: payload.mentionPatterns ?? [] };
    created.push(cat);
    return route.fulfill({ status: 201, json: { cat } });
  });
  await page.goto(new URL('/settings?s=members&view=setup&shell=v2&lang=zh', origin).href);
  const panel = page.getByTestId('recommended-team-setup');
  await panel.waitFor();
  await page.getByRole('button', { name: '重新检测', exact: true }).waitFor();
  await page.getByText('正在检测本机工具并匹配角色…', { exact: true }).waitFor({ state: 'hidden' });
  return {
    context,
    page,
    panel,
    writes,
    errors,
    created,
    recoverDiscovery: () => {
      discoveryFails = false;
    },
    discover: (value) => {
      discovered = value;
    },
  };
}

async function select(state, mask) {
  for (let i = 0; i < labels.length; i++) {
    await state.page
      .getByRole('checkbox', { name: `加入 ${labels[i]} 伙伴`, exact: true })
      .setChecked(Boolean(mask & (1 << i)));
  }
}
const create = (page) => page.getByRole('button', { name: /^(一键创建|继续创建) \d 位伙伴$/ });

for (let mask = 0; mask < 32; mask++) {
  test(
    `selection mask ${mask}: only selected tools are submitted, including zero and every singleton`,
    { timeout: 30000 },
    async () => {
      const state = await setup();
      try {
        await select(state, mask);
        const count = ids.filter((_, i) => mask & (1 << i)).length;
        if (!count) {
          assert.equal(await create(state.page).count(), 0);
          assert.ok(await state.page.getByRole('button', { name: '暂不创建', exact: true }).isEnabled());
        } else {
          await create(state.page).click();
          await state.panel.waitFor({ state: 'hidden' });
          assert.equal(state.writes.length, count);
          const expected = ids.filter((_, i) => mask & (1 << i));
          const submitted = state.writes.map(({ payload }) =>
            payload.clientId === 'acp'
              ? payload.nickname === '派派'
                ? 'pi'
                : 'dsh'
              : { openai: 'codex', anthropic: 'claude', kimi: 'kimi' }[payload.clientId],
          );
          assert.deepEqual(submitted, expected);
        }
        assert.deepEqual(state.errors, []);
      } finally {
        await state.context.close();
      }
    },
  );
}

for (const status of [400, 401, 403, 409, 429, 500, 503]) {
  test(
    `HTTP ${status}: partial creation names the failed partner; retry keeps receipts and skips completed partners`,
    { timeout: 30000 },
    async () => {
      const state = await setup({ failCreate: { at: 2, status } });
      try {
        await create(state.page).click();
        const alert = state.panel.getByRole('alert');
        await alert.waitFor();
        assert.match(await alert.innerText(), /Claude Code.*fixture account unavailable/s);
        assert.equal(state.created.length, 1);
        const failed = state.writes[1];
        await create(state.page).click();
        await state.panel.waitFor({ state: 'hidden' });
        assert.equal(state.created.length, 5);
        assert.equal(state.writes.length, 6);
        assert.equal(state.writes[2].key, failed.key);
        assert.deepEqual(state.writes[2].payload, failed.payload);
        assert.deepEqual(state.errors, []);
      } finally {
        await state.context.close();
      }
    },
  );
}

test(
  'discovery failure is distinct from no clients; refresh recovers and later detects a newly started DSH',
  { timeout: 30000 },
  async () => {
    const state = await setup({ discoveryFails: true });
    try {
      assert.match(await state.panel.innerText(), /暂时无法检测工具/);
      state.recoverDiscovery();
      state.discover(runtimes.map((r) => ({ ...r, installed: false })));
      await state.page.getByRole('button', { name: '重新检测', exact: true }).click();
      await state.page.getByText('还没有找到可加入的工具', { exact: true }).waitFor();
      assert.equal(await create(state.page).count(), 0);
      assert.ok(await state.page.getByRole('button', { name: '手动创建单个伙伴', exact: true }).isEnabled());
      state.discover(runtimes);
      await state.page.getByRole('button', { name: '重新检测', exact: true }).click();
      await state.page.getByText('推荐伙伴 · 5 位', { exact: true }).waitFor();
      assert.ok(await state.page.getByRole('checkbox', { name: '加入 DSH 伙伴', exact: true }).isEnabled());
      await state.page.screenshot({ path: path.join(evidence, 'five-partners.png'), fullPage: true });
      for (const label of ['DSH', 'Pi']) {
        const image = state.page
          .locator('article')
          .filter({ has: state.page.getByRole('checkbox', { name: `加入 ${label} 伙伴`, exact: true }) })
          .locator('img');
        assert.ok(await image.evaluate((img) => img.complete && img.naturalWidth > 0));
      }
      assert.deepEqual(state.errors, []);
    } finally {
      await state.context.close();
    }
  },
);

test(
  'an existing roster avoids first-run recommendations; manual creation remains available',
  { timeout: 30000 },
  async () => {
    const state = await setup();
    try {
      await state.page.getByRole('button', { name: '手动创建单个伙伴', exact: true }).click();
      await state.panel.waitFor({ state: 'hidden' });
      assert.equal(new URL(state.page.url()).searchParams.get('manual'), '1');
      assert.equal(state.writes.length, 0);
      assert.deepEqual(state.errors, []);
    } finally {
      await state.context.close();
    }
  },
);
