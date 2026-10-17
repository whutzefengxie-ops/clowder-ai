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
