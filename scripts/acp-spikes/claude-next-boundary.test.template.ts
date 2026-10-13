/** Copied into the pinned upstream test tree by prepare-claude-prototype.mjs. */
import { expect, it, vi } from 'vitest';
import { ClaudeAcpAgent } from '../acp-agent.js';

function fixture(pendingHuman = 0) {
  const messages: Array<{ priority?: string; uuid?: string }> = [];
  const agent = Object.create(ClaudeAcpAgent.prototype) as ClaudeAcpAgent;
  const seam = agent as unknown as { sessions: Record<string, unknown>; publishGoalFromPrompt(): Promise<void> };
  seam.sessions = {
    session: {
      queryClosed: false,
      turnQueue: [{ settled: false }],
      pendingUserInputCount: pendingHuman,
      input: {
        push(message: (typeof messages)[number]) {
          messages.push(message);
        },
      },
    },
  };
  seam.publishGoalFromPrompt = async () => {};
  const interrupt = vi.fn();
  (seam.sessions.session as Record<string, unknown>).query = { interrupt };
  return { agent, messages, interrupt };
}
it('W5.P next delivery reaches the SDK input with a unique native message UUID', async () => {
  const { agent, messages } = fixture();
  const result = await agent.steer({
    sessionId: 'session',
    prompt: [{ type: 'text', text: 'synthetic notice' }],
    _meta: { steering: { delivery: 'next', idleBehavior: 'promptRequired' } },
  });
  expect(result.outcome).toBe('injected');
  expect(messages[0].priority).toBe('next');
  expect(messages[0].uuid).toMatch(/^[\da-f-]{36}$/);
});
it('W5.P a queued next input cannot request native preemption of pending human input', async () => {
  const { agent, messages, interrupt } = fixture(1);
  await agent.steer({
    sessionId: 'session',
    prompt: [{ type: 'text', text: 'synthetic notice' }],
    _meta: { steering: { delivery: 'next', idleBehavior: 'promptRequired' } },
  });
  // Enqueueing is not execution. Native pending/answer behavior requires the
  // separate real SDK permission/elicitation evidence, not this fake flag.
  expect(messages).toHaveLength(1);
  expect(messages[0].priority).toBe('next');
  expect(interrupt).not.toHaveBeenCalled();
});
it('W5.P idle requires host-owned prompt and does not start a detached native turn', async () => {
  const { agent, messages } = fixture();
  (agent as unknown as { sessions: Record<string, { turnQueue: unknown[] }> }).sessions.session.turnQueue = [];
  expect(
    await agent.steer({
      sessionId: 'session',
      prompt: [{ type: 'text', text: 'synthetic notice' }],
      _meta: { steering: { delivery: 'next', idleBehavior: 'promptRequired' } },
    }),
  ).toEqual({ outcome: 'promptRequired', reason: 'noRunningTurn' });
  expect(messages).toHaveLength(0);
});
