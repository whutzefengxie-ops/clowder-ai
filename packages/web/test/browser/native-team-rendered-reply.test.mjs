import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { waitForRenderedReply } from './native-team-rendered-reply.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());
async function withPage(html, action) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await action(page);
  } finally {
    await page.close();
  }
}
test('a persisted assistant reply may carry its normal identity signature', () =>
  withPage(
    '<div data-message-id="user-1">LIVE_TOKEN</div><div data-message-id="reply-1"><div data-testid="message-bubble">LIVE_TOKEN [砚砚/GPT-6🐾]</div></div>',
    (page) => waitForRenderedReply(page, 'reply-1', 'LIVE_TOKEN', { timeout: 1000 }),
  ));
test('a user echo cannot stand in for the actual assistant message', () =>
  withPage(
    '<div data-message-id="user-1">LIVE_TOKEN</div><div data-message-id="reply-1"><div data-testid="message-bubble">尚无回复</div></div>',
    (page) => assert.rejects(waitForRenderedReply(page, 'reply-1', 'LIVE_TOKEN', { timeout: 200 })),
  ));
test('another assistant or a hidden reply cannot satisfy this persisted message identity', async () => {
  for (const html of [
    '<div data-message-id="other-reply"><div data-testid="message-bubble">LIVE_TOKEN</div></div><div data-message-id="reply-1"><div data-testid="message-bubble">其他回复</div></div>',
    '<div data-message-id="reply-1" style="display:none"><div data-testid="message-bubble">LIVE_TOKEN</div></div>',
  ])
    await withPage(html, (page) =>
      assert.rejects(waitForRenderedReply(page, 'reply-1', 'LIVE_TOKEN', { timeout: 200 })),
    );
});

test('a quoted user marker in the assistant header cannot stand in for its reply body', () =>
  withPage(
    '<div data-message-id="reply-1"><header>co-creator: LIVE_TOKEN</header><div data-testid="message-bubble">尚无回复</div></div>',
    (page) => assert.rejects(waitForRenderedReply(page, 'reply-1', 'LIVE_TOKEN', { timeout: 200 })),
  ));
