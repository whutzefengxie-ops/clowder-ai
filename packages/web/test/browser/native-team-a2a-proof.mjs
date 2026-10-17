import { findPeerObservation } from './native-team-observation.mjs';

export function realTaskOutcome(messages, catId, marker) {
  const reply = messages.find(
    (message) =>
      message.catId === catId &&
      message.type === 'assistant' &&
      message.lifecycle?.invocationId &&
      ['completed', 'failed', 'canceled', 'interrupted'].includes(message.lifecycle.status),
  );
  if (!reply) return undefined;
  if (reply.lifecycle.status === 'completed' && String(reply.content).includes(marker))
    return { status: 'passed', messageId: reply.id };
  return {
    status: 'failed',
    messageId: reply.id,
    reason: reply.lifecycle.status === 'completed' ? 'completed_without_task_result' : reply.lifecycle.status,
  };
}

export function allA2AInvocationsDone(invocations) {
  return invocations.length >= 3 && invocations.every((invocation) => invocation.status === 'done');
}

const terminalStatuses = new Set(['completed', 'done']);
const finiteTime = (...values) => values.find((value) => Number.isFinite(value));

function classifyExtraInvocation(
  invocation,
  messages,
  byId,
  { leadId, peerId, peerMarker, finalMarker, handoffIds, resultIds },
) {
  const invocationMessages = messages.filter(
    (message) => message.type === 'assistant' && message.lifecycle?.invocationId === invocation.invocationId,
  );
  const inputIds = invocationMessages.flatMap((message) => message.lifecycle?.inputMessageIds ?? []);
  if (![leadId, peerId].includes(invocation.catId)) return 'unrelated_role';
  if (!terminalStatuses.has(invocation.status)) return 'not_done';
  if (inputIds.some((id) => handoffIds.has(id))) return 'duplicate_handoff';
  if (
    invocationMessages.some(
      (message) => String(message.content).includes(peerMarker) || String(message.content).includes(finalMarker),
    )
  )
    return 'new_task_result';
  const consumedResult = inputIds
    .map((id) => byId.get(id))
    .find((message) => {
      if (!message || !resultIds.has(message.id)) return false;
      const producedAt = finiteTime(message.lifecycle?.completedAt, message.lifecycle?.startedAt, message.timestamp);
      const startedAt = finiteTime(invocation.startedAt, invocationMessages[0]?.lifecycle?.startedAt);
      return Number.isFinite(producedAt) && Number.isFinite(startedAt) && startedAt >= producedAt;
    });
  return consumedResult ? undefined : 'unrelated_input';
}

/**
 * Classify invocations beyond the persisted lead → peer → lead proof.
 *
 * A count-only assertion cannot distinguish a harmless acknowledgement from a
 * second peer computation or an unrelated client. This validator binds every
 * extra invocation to its persisted input message and its causal timestamp.
 */
export function validateA2AInvocations(messages, invocations, { leadId, peerId, peerMarker, finalMarker, proof }) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const coreInvocationIds = [...new Set([proof.initialInvocationId, proof.peerInvocationId, proof.finalInvocationId])];
  const core = new Set(coreInvocationIds);
  const handoffIds = new Set(
    messages
      .filter((message) => message.catId === leadId && producedBy(message, proof.initialInvocationId))
      .map((message) => message.id),
  );
  const resultIds = new Set(
    messages
      .filter((message) => producedBy(message, proof.peerInvocationId) || producedBy(message, proof.finalInvocationId))
      .map((message) => message.id),
  );
  const acceptedConfirmations = [];
  const rejectedInvocations = [];
  for (const invocation of invocations) {
    if (core.has(invocation.invocationId)) continue;
    const reason = classifyExtraInvocation(invocation, messages, byId, {
      leadId,
      peerId,
      peerMarker,
      finalMarker,
      handoffIds,
      resultIds,
    });
    if (reason) rejectedInvocations.push({ invocationId: invocation.invocationId, catId: invocation.catId, reason });
    else acceptedConfirmations.push(invocation.invocationId);
  }
  return {
    ok: rejectedInvocations.length === 0,
    acceptedConfirmations,
    rejectedInvocations,
    coreInvocationIds,
  };
}

const producedBy = (message, invocationId) =>
  message?.lifecycle?.invocationId === invocationId || message?.lifecycle?.producerInvocationId === invocationId;

function consumedPeerReply(response, peer, marker, byId) {
  if (response.lifecycle?.status !== 'completed' || !Number.isFinite(response.lifecycle.startedAt)) return false;
  return response.lifecycle.inputMessageIds?.some((id) => {
    const reply = byId.get(id);
    if (reply?.catId !== peer.catId || !producedBy(reply, peer.lifecycle.invocationId)) return false;
    if (!String(reply.content).includes(marker)) return false;
    const readyAt = reply.lifecycle?.producerInvocationId ? reply.timestamp : peer.lifecycle.completedAt;
    return Number.isFinite(readyAt) && response.lifecycle.startedAt >= readyAt;
  });
}

// Persisted lifecycle/causal facts are authoritative. Stream messages receive an
// ID before generation ends; array order and a model saying "received" are not proof.
export function findA2AProof(messages, { leadId, peerId, peerMarker, finalMarker, nativeToolEvents }) {
  const user = messages.find((message) => message.type === 'user');
  if (!user) return undefined;
  const lead = messages.find(
    (message) =>
      message.type === 'assistant' && message.catId === leadId && message.lifecycle?.inputMessageIds?.includes(user.id),
  );
  if (!lead?.lifecycle?.invocationId) return undefined;
  const byId = new Map(messages.map((message) => [message.id, message]));
  for (const peer of messages.filter((message) => message.catId === peerId && message.type === 'assistant')) {
    if (peer.lifecycle?.status !== 'completed' || !Number.isFinite(peer.lifecycle?.completedAt)) continue;
    if (!String(peer.content).includes(peerMarker)) continue;
    const delegation = peer.lifecycle.inputMessageIds
      ?.map((id) => byId.get(id))
      .find((message) => message?.catId === leadId && producedBy(message, lead.lifecycle.invocationId));
    if (!delegation) continue;
    const returned = messages.find(
      (message) =>
        message.type === 'assistant' &&
        message.catId === leadId &&
        message.lifecycle?.invocationId !== lead.lifecycle.invocationId &&
        consumedPeerReply(message, peer, peerMarker, byId),
    );
    if (!returned) continue;
    let observation;
    const integration = messages.find((message) => {
      if (message.type !== 'assistant' || message.catId !== leadId || !String(message.content).includes(finalMarker))
        return false;
      if (message.lifecycle?.status !== 'completed' || !Number.isFinite(message.lifecycle.startedAt)) return false;
      if (consumedPeerReply(message, peer, peerMarker, byId)) return true;
      observation = findPeerObservation(
        message,
        peer,
        peerMarker,
        byId,
        nativeToolEvents?.get(message.lifecycle.invocationId),
      );
      return Boolean(observation);
    });
    if (integration)
      return {
        userMessageId: user.id,
        initialInvocationId: lead.lifecycle.invocationId,
        delegationMessageId: delegation.id,
        peerMessageId: peer.id,
        peerInvocationId: peer.lifecycle.invocationId,
        finalMessageId: integration.id,
        finalInvocationId: integration.lifecycle.invocationId,
        returnInvocationId: returned.lifecycle.invocationId,
        ...observation,
      };
  }
  return undefined;
}
