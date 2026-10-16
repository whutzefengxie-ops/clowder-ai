import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { settleOwnedThread } from './native-team-cleanup.mjs';

// Opt-in only: these tests invoke paid, locally authenticated clients. They never
// reset data or copy credentials. HTTP/model traffic must not be mocked here.
export async function openLiveJourney() {
  assert.equal(process.env.CAT_CAFE_ONBOARDING_LIVE_CALLS, 'approved');
  const web = new URL(process.env.CAT_CAFE_ONBOARDING_E2E_URL);
  const api = new URL(process.env.CAT_CAFE_ONBOARDING_E2E_API);
  for (const url of [web, api]) {
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(url.port && !['3003', '3004'].includes(url.port), 'Never use production ports');
  }
  const directory = process.env.CAT_CAFE_ONBOARDING_E2E_EVIDENCE;
  assert.ok(directory && path.isAbsolute(directory));
  await fs.mkdir(directory, { recursive: true });
  const record = { modelRequestsMocked: false, web: web.origin, api: api.origin, steps: [], calls: [], pageErrors: [] };
  const save = () => fs.writeFile(path.join(directory, 'live-journey.json'), JSON.stringify(record, null, 2));
  const request = async (url, options = {}, acceptedStatuses = []) => {
    const response = await fetch(new URL(url, api), {
      ...options,
      headers: { 'X-Cat-Cafe-User': 'default-user', 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(response.ok || acceptedStatuses.includes(response.status), `${url}: HTTP ${response.status}`);
    return response.json();
  };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => record.pageErrors.push(error.message));
  const log = async (name, details = {}) => {
    record.steps.push({ name, at: new Date().toISOString(), ...details });
    await save();
    console.log(name);
  };
  return {
    web,
    api,
    page,
    record,
    request,
    save,
    log,
    screenshot: (name) => page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true }),
    close: async () => {
      try {
        await save();
      } finally {
        try {
          await context.close();
        } finally {
          await browser.close();
        }
      }
    },
  };
}

export function roleIdentity(cat) {
  return {
    id: cat.id,
    name: cat.displayName,
    nickname: cat.nickname,
    clientId: cat.clientId,
    avatar: cat.avatar,
    mentionPatterns: cat.mentionPatterns,
  };
}

export async function callRealPartner(journey, cat) {
  const { request, page, web, record, save } = journey;
  const marker = `LIVE_${cat.id.replaceAll('-', '_')}_${randomUUID().slice(0, 8)}`;
  const result = { catId: cat.id, marker, passed: false };
  record.calls.push(result);
  const started = Date.now();
  try {
    const thread = await request('/api/threads', {
      method: 'POST',
      body: JSON.stringify({ title: `端到端验收 ${cat.displayName}` }),
    });
    result.threadId = thread.id;
    await page.goto(new URL(`/thread/${thread.id}?shell=v2&lang=zh`, web).href);
    const input = page.locator('textarea').first();
    await input.waitFor();
    await input.fill(`${cat.mentionPatterns[0]} 请只回复 ${marker}，不要调用任何工具。`);
    const response = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/messages' && res.request().method() === 'POST',
    );
    await input.press('Enter');
    assert.equal((await response).status(), 202);
    const deadline = Date.now() + 180000;
    let messages = [];
    while (Date.now() < deadline) {
      messages = (await request(`/api/messages?threadId=${thread.id}&limit=50`)).messages;
      const reply = messages.find(
        (message) =>
          message.catId === cat.id && message.type === 'assistant' && JSON.stringify(message.content).includes(marker),
      );
      if (reply) {
        result.replyMessageId = reply.id;
        break;
      }
      await page.waitForTimeout(750);
    }
    assert.ok(result.replyMessageId, `${cat.id} did not return the unique task marker within 180s`);
    result.historyMessageIds = messages.map((message) => message.id);
    await page.reload();
    await page.getByText(marker, { exact: true }).first().waitFor();
    result.passed = true;
    await journey.screenshot(`reply-${cat.id}-${marker.slice(-8)}`);
  } catch (error) {
    result.error = String(error.message).slice(0, 400);
    await journey.screenshot(`failure-${cat.id}-${marker.slice(-8)}`);
  } finally {
    result.durationMs = Date.now() - started;
    try {
      if (result.threadId) result.cleanup = await settleOwnedThread(request, result.threadId);
    } finally {
      await save();
      console.log(`${cat.id}: ${result.passed ? 'PASS' : result.error}`);
    }
  }
  return result;
}

export async function verifyRetainedHistory(journey, previous) {
  const cats = (await journey.request('/api/cats')).cats;
  for (const role of previous.roles) assert.deepEqual(roleIdentity(cats.find((cat) => cat.id === role.id)), role);
  for (const call of previous.calls) {
    assert.ok(
      call.threadId && call.replyMessageId && call.historyMessageIds?.length,
      'Failed calls are not persistence acceptance evidence',
    );
    const messages = (await journey.request(`/api/messages?threadId=${call.threadId}&limit=50`)).messages;
    const ids = new Set(messages.map((message) => message.id));
    for (const id of call.historyMessageIds) assert.ok(ids.has(id), `Persisted message missing: ${id}`);
    const reply = messages.find((message) => message.id === call.replyMessageId);
    assert.ok(JSON.stringify(reply.content).includes(call.marker));
    await journey.page.goto(new URL(`/thread/${call.threadId}?shell=v2&lang=zh`, journey.web).href);
    await journey.page.getByText(call.marker, { exact: true }).first().waitFor();
  }
  await journey.log('retained-roles-and-message-ids-verified', {
    roles: previous.roles.length,
    threads: previous.calls.length,
  });
  return cats;
}
