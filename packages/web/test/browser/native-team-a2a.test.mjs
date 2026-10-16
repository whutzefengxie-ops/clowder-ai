import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { findA2AProof } from './native-team-a2a-proof.mjs';
import { settleOwnedThread } from './native-team-cleanup.mjs';
import { openLiveJourney, roleIdentity } from './native-team-live.harness.mjs';

test(
  'real A2A: one initial Codex target delegates to Pi and integrates its actual reply',
  { timeout: 300000 },
  async () => {
    const journey = await openLiveJourney();
    const { page, request, record, web, log } = journey;
    record.scenario = 'real-a2a-one-initial-target';
    record.explicitToolInstruction = process.env.CAT_CAFE_ONBOARDING_A2A_EXPLICIT === '1';
    let thread;
    try {
      const cats = (await request('/api/cats')).cats;
      const lead = cats.find((cat) => cat.id === 'codex'),
        peer = cats.find((cat) => cat.id === 'pi');
      assert.ok(lead && peer, 'Use the explicitly owned test roster; never create or reset roles here');
      record.roles = [lead, peer].map(roleIdentity);
      const token = randomUUID().slice(0, 8);
      const peerMarker = `A2A_PEER_${token}=63`,
        finalMarker = `A2A_FINAL_${token}=63`;
      thread = await request('/api/threads', { method: 'POST', body: JSON.stringify({ title: '真实 A2A 传球验收' }) });
      record.threadId = thread.id;
      const writes = [];
      page.on('request', (req) => {
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/messages') writes.push(req.postDataJSON());
      });
      await page.goto(new URL(`/thread/${thread.id}?shell=v2&lang=zh`, web).href);
      const input = page.locator('textarea').first();
      await input.waitFor();
      const delivery = record.explicitToolInstruction ? '通过 cat_cafe_post_message ' : '';
      await input.fill(
        `${lead.mentionPatterns[0]} 请与派派（角色 ID pi）完成一次真实协作：先${delivery}将计算 9×7 的小任务交给派派，让它计算后回复 ${peerMarker} 并传回给你。你先完成交接，不能自行伪造派派的回复；收到派派的真实结果后，你审核并回复 ${finalMarker}。只做这次计算与传球，不运行系统命令、不改文件。`,
      );
      const accepted = page.waitForResponse(
        (res) => new URL(res.url()).pathname === '/api/messages' && res.request().method() === 'POST',
      );
      await input.press('Enter');
      assert.equal((await accepted).status(), 202);
      await log('single-initial-target-submitted', { lead: lead.id, peer: peer.id });
      const deadline = Date.now() + 240000;
      let messages = [],
        proof;
      while (Date.now() < deadline) {
        messages = (await request(`/api/messages?threadId=${thread.id}&limit=100`)).messages;
        proof = findA2AProof(messages, { leadId: lead.id, peerId: peer.id, peerMarker, finalMarker });
        if (proof) break;
        await page.waitForTimeout(1000);
      }
      record.initialBrowserMessageCount = writes.length;
      record.messageIds = messages.map((m) => m.id);
      record.assistantSequence = messages
        .filter((m) => m.type === 'assistant')
        .map((m) => ({ id: m.id, catId: m.catId }));
      assert.equal(writes.length, 1, 'The browser must not simulate another user message to wake Pi');
      const content = String(writes[0].content);
      assert.deepEqual(content.match(/@[a-z][a-z0-9-]*/g), [lead.mentionPatterns[0]]);
      record.causalProof = proof;
      assert.ok(proof, 'Persisted lifecycle must prove Codex→Pi→Codex with a completed peer result');
      const trajectories = (await request(`/api/threads/${thread.id}/invocations?limit=30`)).invocations;
      record.invocations = trajectories.map((i) => ({ id: i.invocationId, catId: i.catId, status: i.status }));
      for (const id of [proof.initialInvocationId, proof.peerInvocationId, proof.finalInvocationId])
        assert.ok(trajectories.some((i) => i.invocationId === id));
      record.extraLeadInvocations = trajectories.filter((i) => i.catId === lead.id).length - 2;
      await page.reload();
      await page.getByText(peerMarker, { exact: false }).last().waitFor();
      await page.getByText(finalMarker, { exact: false }).last().waitFor();
      await journey.screenshot('real-a2a-complete');
      assert.equal(
        record.extraLeadInvocations,
        0,
        'This single-return task must not dispatch an extra return from duplicate delivery carriers',
      );
      assert.deepEqual(record.pageErrors, []);
      await log('real-delegation-peer-answer-and-integration-passed');
    } catch (error) {
      record.failure = error.message;
      await journey.screenshot('real-a2a-failed');
      throw error;
    } finally {
      try {
        if (thread) record.cleanup = await settleOwnedThread(request, thread.id);
      } finally {
        await journey.close();
      }
    }
  },
);
