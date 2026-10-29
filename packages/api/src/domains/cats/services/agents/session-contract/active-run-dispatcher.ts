/**
 * W3: live-input dispatcher registration for one still-open native turn.
 *
 * A dispatcher may only be registered with provider-native ids that the turn
 * actually reported. The Host ids (hostSessionId / invocationId) are correlation
 * truth, not native ids, so they are never substituted into the handle: an
 * unknown native id means "no dispatcher", never a fabricated one (C12/C13).
 *
 * Internal / unstable (#1647).
 */
import { randomUUID } from 'node:crypto';
import type * as Service from '../../types.js';
import type * as Contract from './types.js';

export function dispatchResult(
  result: Contract.InputResult,
  handle: Service.AgentClientActiveRunHandle,
): Service.AgentClientDispatchResult {
  if (result.status === 'accepted') return { accepted: true, handle };
  const reasons = { unknown: 'exception', turn_ended: 'active_run_closed', unsupported: 'provider_rejected' } as const;
  return {
    accepted: false,
    reason: result.status === 'rejected' ? result.reason : reasons[result.status],
    acceptance: result.status === 'unknown' ? 'unknown' : 'not_accepted',
  };
}

export interface ActiveRunDispatcherInput {
  readonly provider: Contract.AgentSessionProvider;
  readonly sessionId: string;
  /** Real provider-native session id reported by the open/bind event. */
  readonly nativeSessionId: string;
  /** Real provider-native turn id reported by startTurn. */
  readonly nativeTurnId: string;
  /** Host invocation id fenced by the registrar. */
  readonly invocationId: string;
  /** Full Host turn ref expected by provider.input/inspectInput. */
  readonly turn: Contract.TurnRef;
  readonly capabilities: Contract.AgentSessionCapabilities;
  readonly isAccepting: () => boolean;
  readonly receipts: Map<string, () => Promise<void>>;
  readonly warn: (message: string) => void;
}

export interface ActiveRunDispatcherProduct {
  readonly dispatcher: Service.AgentClientActiveRunDispatcher;
  readonly handle: Service.AgentClientActiveRunHandle;
}

/** Build the Host-facing dispatcher for exactly one live native turn. */
export function createActiveRunDispatcher(input: ActiveRunDispatcherInput): ActiveRunDispatcherProduct {
  const { provider, capabilities } = input;
  const expected: Contract.TurnRef = { ...input.turn, invocationId: input.invocationId };
  const handle: Service.AgentClientActiveRunHandle = {
    provider: 'other',
    carrier: 'other',
    threadId: input.nativeSessionId,
    turnId: input.nativeTurnId,
  };
  const dispatcher: Service.AgentClientActiveRunDispatcher = {
    invocationId: input.invocationId,
    handle,
    capabilities: { append: true, steer: false, inputReadReceipt: capabilities.inputReadReceipt === 'supported' },
    dispatch: async (message, options) => {
      if (!input.isAccepting()) return { accepted: false, reason: 'active_run_closed', acceptance: 'not_accepted' };
      if (options.expectedInvocationId !== expected.invocationId)
        return { accepted: false, reason: 'active_run_mismatch', acceptance: 'not_accepted' };
      if (options.force) return { accepted: false, reason: 'provider_rejected', acceptance: 'not_accepted' };
      const deliveryId = message.deliveryId ?? randomUUID();
      if (message.onInputRead) input.receipts.set(deliveryId, message.onInputRead);
      try {
        const result = await provider.input(input.sessionId, expected, {
          text: message.text,
          images: message.imagePaths,
          messageIds: message.messageIds,
          deliveryId,
        });
        if (result.status !== 'accepted' && result.status !== 'unknown') input.receipts.delete(deliveryId);
        return dispatchResult(result, handle);
      } catch {
        input.warn('Session input dispatch failed');
        return dispatchResult({ status: 'unknown' }, handle);
      }
    },
  };
  const inspect = provider.inspectInput;
  if (inspect)
    dispatcher.inspectInput = (deliveryId) =>
      input.isAccepting()
        ? inspect.call(provider, input.sessionId, expected, deliveryId)
        : Promise.resolve('unknown');
  return { dispatcher, handle };
}
