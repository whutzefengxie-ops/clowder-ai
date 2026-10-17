import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, before } from 'node:test';
import { chromium } from 'playwright';

// Browser contract lane: real production page and hooks, injected HTTP boundary
// faults. This lane is NOT evidence that a model authenticated or replied.
const base = process.env.CAT_CAFE_ONBOARDING_E2E_URL;
export const evidence = process.env.CAT_CAFE_ONBOARDING_E2E_EVIDENCE;
assert.ok(base && evidence, 'Pass the explicitly owned isolated URL and evidence directory');
const origin = new URL(base);
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname) && !['3003', '3004'].includes(origin.port));
export const labels = ['Codex', 'Claude Code', 'DSH', 'Kimi', 'Pi'];
export const ids = ['codex', 'claude', 'dsh', 'kimi', 'pi'];
export const runtimes = labels.map((label, index) => ({
  id: ids[index],
  label,
  installed: true,
  models: [],
  clientId: ['openai', 'anthropic', 'acp', 'kimi', 'acp'][index],
  configuredModel: `fixture-${ids[index]}`,
  ...(index === 2 || index === 4 ? { acp: { command: 'fixture', startupArgs: [ids[index]], transport: 'stdio' } } : {}),
  readiness: { status: 'configured' },
}));
let browser;
before(async () => {
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function respondFault(route, failure, commit) {
  if (failure.committed) commit();
  if (failure.disconnect) return route.abort('connectionreset');
  if (failure.hang) return new Promise(() => {});
  return route.fulfill({ status: failure.status, json: { error: failure.message ?? 'fixture account unavailable' } });
}

export async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const shell = options.shell ?? 'v2';
  assert.ok(['classic', 'v2'].includes(shell));
  await context.addInitScript(
    ({ shell, origin }) => {
      if (location.origin === origin && !localStorage.getItem('cat-cafe:shell-presentation'))
        localStorage.setItem('cat-cafe:shell-presentation', shell);
    },
    { shell, origin: origin.origin },
  );
  // Keep registration real but omit fetch interception in the HTTP-fault lane.
  // Playwright's serviceWorkers:block makes Workbox registration return undefined.
  // The separate installed live journey uses the unmodified production worker.
  await context.route('**/sw.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'self.addEventListener("install",()=>self.skipWaiting());',
    }),
  );
  const page = await context.newPage();
  const writes = [],
    errors = [];
  let discoveryFails = options.discoveryFails ?? false;
  let failure = options.failCreate;
  let discovered = options.runtimes ?? runtimes;
  const created = [];
  const entryWrites = [];
  let entryStatus = options.entryStatus ?? 'not_started';
  await context.route('**/api/config/onboarding/entry', async (route) => {
    if (route.request().method() === 'PUT') {
      const intent = route.request().postDataJSON().status;
      entryWrites.push(intent);
      if (entryStatus !== 'completed' && !(entryStatus === 'dismissed' && intent === 'pending')) entryStatus = intent;
    }
    await route.fulfill({ json: { userId: 'fixture-user', version: 'first-run-entry-v1', status: entryStatus } });
  });
  const receipts = new Map();
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  await context.route('**/api/cats/native-runtimes*', (route) =>
    route.fulfill({
      status: discoveryFails ? 503 : 200,
      json: discoveryFails ? { error: 'fixture discovery unavailable' } : { runtimes: discovered },
    }),
  );
  await context.route('**/api/cats', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { cats: options.existing ?? created } });
    const payload = route.request().postDataJSON();
    const key = route.request().headers()['idempotency-key'];
    writes.push({ payload, key });
    if (receipts.has(key)) return route.fulfill({ status: 201, json: { cat: receipts.get(key) } });
    if (failure && writes.length === failure.at) {
      const fault = failure;
      failure = undefined;
      return respondFault(route, fault, () => {
        const cat = {
          ...payload,
          id: payload.id ?? `fixture-${created.length}`,
          mentionPatterns: payload.mentionPatterns ?? [],
        };
        created.push(cat);
        receipts.set(key, cat);
      });
    }
    const cat = { ...payload, id: `fixture-${created.length}`, mentionPatterns: payload.mentionPatterns ?? [] };
    created.push(cat);
    receipts.set(key, cat);
    return route.fulfill({ status: 201, json: { cat } });
  });
  await page.goto(new URL(`/settings?s=members&view=setup&shell=${shell}&lang=zh`, origin).href);
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
    entryWrites,
    recoverDiscovery: () => {
      discoveryFails = false;
    },
    discover: (value) => {
      discovered = value;
    },
  };
}

export async function select(state, mask) {
  for (let i = 0; i < labels.length; i++) {
    await state.page
      .getByRole('checkbox', { name: `加入 ${labels[i]} 伙伴`, exact: true })
      .setChecked(Boolean(mask & (1 << i)));
  }
}
export const create = (page) => page.getByRole('button', { name: /^(一键创建|继续创建) \d 位伙伴$/ });
