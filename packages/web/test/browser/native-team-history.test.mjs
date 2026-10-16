import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { openLiveJourney, roleIdentity } from './native-team-live.harness.mjs';

// This is persistence acceptance, not task acceptance. Failed or irrelevant
// replies must survive restart too; preserving them never turns a failed task green.
test('installed application retains every recorded outcome after restart', { timeout: 180000 }, async () => {
  const source = process.env.CAT_CAFE_ONBOARDING_HISTORY_SNAPSHOT;
  assert.ok(source, 'Supply a snapshot collected before this exact instance stopped');
  const expected = JSON.parse(await fs.readFile(source, 'utf8'));
  assert.equal(expected.instance, process.env.CAT_CAFE_ONBOARDING_E2E_INSTANCE);
  const journey = await openLiveJourney();
  try {
    const cats = (await journey.request('/api/cats')).cats;
    assert.deepEqual(cats.map(roleIdentity), expected.roles);
    for (const thread of expected.threads) {
      const actual = (await journey.request(`/api/messages?threadId=${thread.id}&limit=50`)).messages;
      for (const message of thread.messages) {
        const retained = actual.find((row) => row.id === message.id);
        assert.ok(retained, `Missing original message ${message.id}`);
        assert.deepEqual(
          {
            id: retained.id,
            type: retained.type,
            catId: retained.catId,
            content: retained.content,
            lifecycle: retained.lifecycle,
          },
          message,
          `Original outcome changed: ${message.id}`,
        );
      }
      await journey.page.goto(new URL(`/thread/${thread.id}?shell=v2&lang=zh`, journey.web).href);
      for (const message of thread.messages.filter((row) => row.type === 'assistant')) {
        const body = journey.page.locator(`[data-message-id="${message.id}"]`).getByTestId('message-bubble');
        await body.getByText(message.content, { exact: false }).first().waitFor({ state: 'visible' });
      }
      await journey.screenshot(`retained-${thread.id}`);
    }
    await journey.log('all-original-success-and-failure-outcomes-preserved', {
      roles: expected.roles.length,
      threads: expected.threads.length,
      messages: expected.threads.reduce((count, thread) => count + thread.messages.length, 0),
      taskVerdictsReclassified: false,
    });
    assert.deepEqual(journey.record.pageErrors, []);
    assert.deepEqual(journey.record.dialogs, []);
  } finally {
    await journey.close();
  }
});
