import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findA2AProof } from './native-team-a2a-proof.mjs';

const options = { leadId: 'codex', peerId: 'pi', peerMarker: 'PEER', finalMarker: 'FINAL' };
function fixture() {
  return [
    { id: 'u', type: 'user' },
    {
      id: 'lead',
      type: 'assistant',
      catId: 'codex',
      content: 'FINAL',
      lifecycle: { invocationId: 'a', inputMessageIds: ['u'], status: 'completed', startedAt: 1 },
    },
    { id: 'handoff', catId: 'codex', lifecycle: { producerInvocationId: 'a' } },
    {
      id: 'peer',
      type: 'assistant',
      catId: 'pi',
      content: 'PEER',
      lifecycle: { invocationId: 'b', inputMessageIds: ['handoff'], status: 'completed', completedAt: 10 },
    },
    { id: 'return', catId: 'pi', lifecycle: { producerInvocationId: 'b' } },
    {
      id: 'final',
      type: 'assistant',
      catId: 'codex',
      content: 'FINAL',
      lifecycle: { invocationId: 'c', inputMessageIds: ['return'], status: 'completed', startedAt: 11 },
    },
  ];
}
test('accepts a persisted delegation/return chain despite an earlier premature model claim', () => {
  assert.deepEqual(findA2AProof(fixture(), options), {
    userMessageId: 'u',
    initialInvocationId: 'a',
    delegationMessageId: 'handoff',
    peerMessageId: 'peer',
    peerInvocationId: 'b',
    finalMessageId: 'final',
    finalInvocationId: 'c',
  });
});
test('model claims and response array order cannot stand in for a peer return', () => {
  const messages = fixture();
  messages.pop();
  assert.equal(findA2AProof(messages, options), undefined);
});
test('an unrelated peer invocation cannot prove delegation by the initial lead', () => {
  const messages = fixture();
  messages[2].lifecycle.producerInvocationId = 'foreign';
  assert.equal(findA2AProof(messages, options), undefined);
});
test('a final reply unrelated to the peer input cannot prove integration', () => {
  const messages = fixture();
  messages[5].lifecycle.inputMessageIds = ['u'];
  assert.equal(findA2AProof(messages, options), undefined);
});
test('an incomplete peer or integration started before peer completion cannot pass', () => {
  for (const mutate of [
    (messages) => {
      messages[3].lifecycle.status = 'streaming';
    },
    (messages) => {
      messages[5].lifecycle.startedAt = 8;
    },
  ]) {
    const messages = fixture();
    mutate(messages);
    assert.equal(findA2AProof(messages, options), undefined);
  }
});
