// Persisted lifecycle/causal facts are authoritative. Stream messages receive an
// ID before generation ends; array order and a model saying "received" are not proof.
export function findA2AProof(messages, { leadId, peerId, peerMarker, finalMarker }) {
  const user = messages.find((message) => message.type === 'user');
  if (!user) return undefined;
  const lead = messages.find(
    (message) =>
      message.type === 'assistant' && message.catId === leadId && message.lifecycle?.inputMessageIds?.includes(user.id),
  );
  if (!lead?.lifecycle?.invocationId) return undefined;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const producedBy = (message, invocationId) =>
    message?.lifecycle?.invocationId === invocationId || message?.lifecycle?.producerInvocationId === invocationId;
  for (const peer of messages.filter((message) => message.catId === peerId && message.type === 'assistant')) {
    if (peer.lifecycle?.status !== 'completed' || !Number.isFinite(peer.lifecycle?.completedAt)) continue;
    if (!String(peer.content).includes(peerMarker)) continue;
    const delegation = peer.lifecycle.inputMessageIds
      ?.map((id) => byId.get(id))
      .find((message) => message?.catId === leadId && producedBy(message, lead.lifecycle.invocationId));
    if (!delegation) continue;
    const integration = messages.find((message) => {
      if (message.type !== 'assistant' || message.catId !== leadId || !String(message.content).includes(finalMarker))
        return false;
      if (
        message.lifecycle?.status !== 'completed' ||
        !Number.isFinite(message.lifecycle.startedAt) ||
        message.lifecycle.startedAt < peer.lifecycle.completedAt
      )
        return false;
      return message.lifecycle.inputMessageIds?.some((id) => {
        const reply = byId.get(id);
        return reply?.catId === peerId && producedBy(reply, peer.lifecycle.invocationId);
      });
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
      };
  }
  return undefined;
}
