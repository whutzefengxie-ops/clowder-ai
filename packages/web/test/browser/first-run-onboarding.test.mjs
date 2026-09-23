import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NEXT_BIN = path.resolve(WEB_ROOT, '../../node_modules/next/dist/bin/next');

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  server.close();
  await once(server, 'close');
  return address.port;
}

async function waitForPage(url, server, output) {
  for (let i = 0; i < 180; i += 1) {
    if (server.exitCode !== null) throw new Error(`Next exited (${server.exitCode}): ${output.join('')}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for Next to compile the test route.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${output.join('').slice(-4000)}`);
}

let server;
let browser;
let baseUrl;

before(async () => {
  const port = await freePort();
  const output = [];
  server = spawn(process.execPath, [NEXT_BIN, 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: WEB_ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => output.push(String(chunk)));
  server.stderr.on('data', (chunk) => output.push(String(chunk)));
  baseUrl = `http://127.0.0.1:${port}/dev/first-run-onboarding`; 
  await waitForPage(baseUrl, server, output);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server?.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
});

function mockApi(route, clients) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === '/api/first-run/available-clients') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clients }) });
  }
  if (url.pathname === '/api/accounts') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ providers: [{ id: 'openai-default', name: 'OpenAI', displayName: 'OpenAI', provider: 'openai', clientId: 'openai', models: ['gpt-4o-mini'], authType: 'api_key' }] }) });
  }
  if (url.pathname === '/api/cat-templates') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ templates: [{ id: 'planner', name: 'Planner', nickname: 'Planner', avatar: 'cat', color: { primary: '#111', secondary: '#eee' }, roleDescription: 'Break goals into steps', personality: 'Clear', teamStrengths: ['Planning'] }] }) });
  }
  if (url.pathname === '/api/first-run/connectivity-test') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, message: '杩炴帴鎴愬姛' }) });
  }
  if (url.pathname === '/api/cats' || url.pathname === '/api/threads') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.pathname === '/api/cats' ? { cat: { id: 'cat-1', displayName: 'Planner' } } : { id: 'thread-1' }) });
  }
  return route.continue();
}

async function openPage(clients) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.removeItem('cat-cafe:onboarding-journey'));
  const page = await context.newPage();
  await page.route('**/api/**', (route) => mockApi(route, clients));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('first-run-demo-advance').waitFor();
  await page.getByTestId('first-run-demo-advance').click();
  return { context, page };
}

test('demo advances, pauses, and restores', async () => {
  const { context, page } = await openPage([{ client: 'codex', provider: 'openai', label: 'Codex', installed: true, version: '1', hasApiKey: true }]);
  try {
    await page.getByText('初稿：', { exact: false }).waitFor();
    await page.getByTestId('first-run-demo-pause').click();
    assert.equal(await page.getByTestId('first-run-demo-advance').isDisabled(), true);
    await page.getByTestId('first-run-demo-pause').click();
    await page.getByTestId('first-run-demo-advance').click();
    assert.equal(await page.getByRole('heading', { name: '审查猫找出术语' }).count(), 1);
    await page.reload();
    await page.getByText('初稿：', { exact: false }).waitFor();
    await page.getByTestId('first-run-demo-pause').click();
    await page.getByTestId('first-run-demo-pause').click();
    await page.getByTestId('first-run-demo-advance').click();
    await page.getByText('审查').waitFor();
    await page.getByTestId('first-run-demo-advance').click();
    await page.getByText('改稿').waitFor();
  } finally { await context.close(); }
});

test('missing client stops and login remains pending after reload', async () => {
  const { context, page } = await openPage([
    { client: 'codex', provider: 'openai', label: 'Codex', installed: true, hasApiKey: false },
    { client: 'gemini', provider: 'google', label: 'Gemini', installed: false, hasApiKey: false },
  ]);
  try {
    for (let i = 0; i < 4; i += 1) await page.getByTestId('first-run-demo-advance').click();
    await page.getByText('未安装：Gemini').waitFor();
    await page.getByTestId('first-run-login-codex').click();
    await page.getByText('等待登录').waitFor();
    await page.reload();
    await page.getByText('等待登录').waitFor();
  } finally { await context.close(); }
});

test('single client configures and creates real thread', async () => {
  const { context, page } = await openPage([{ client: 'codex', provider: 'openai', label: 'Codex', installed: true, hasApiKey: true }]);
  try {
    for (let i = 0; i < 4; i += 1) await page.getByTestId('first-run-demo-advance').click();
    await page.getByTestId('first-run-select-codex').click();
    await page.getByTestId('first-run-connect-test').click();
    await page.getByText('连接成功').waitFor();
    await page.getByTestId('first-run-create-cat').click();
    await page.getByText('团队已就绪').waitFor();
  } finally { await context.close(); }
});

