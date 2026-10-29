// Live input uses the active-run fence and Host invocation identity.
//
// A supported implementation is registered against the Host's
// `activeRunDispatch` fence, the Host's ids are the ones that reach the
// provider, an unknown receipt is never retried, and an unsupported
// implementation leaves the Host's registry untouched.
//
// Dispatch is always exercised while the turn is still open: the bridge
// releases the registration when the turn ends, so calling into a released
// dispatcher would be testing an unspecified state.
//
// The Host fills `options.invocationId` and
// `options.activeRunDispatch.invocationId` from one variable, so the fixture
// must make them equal. `provider.input` / `inspectInput` receive the
// round's full `TurnRef`, `nativeTurnId` included when the turn reported one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentSessionBridgeService } from '../../dist/domains/cats/services/agents/session-contract/AgentSessionBridgeService.js';
import { AsyncInbox, collect, collectIterator, createFakeProvider, waitFor } from './fake-provider.js';

const HOST_SESSION_ID = 'host-session-1';
const INVOCATION_ID = 'inv-1';
const TURN_REF = { invocationId: INVOCATION_ID, nativeTurnId: 'turn-1' };

function outputEvent(seq, text = 'working') {
  return { scope: 'turn', sessionId: HOST_SESSION_ID, turn: TURN_REF, seq, type: 'output', text, textMode: 'append' };
}

function doneEvent(seq) {
  return { scope: 'turn', sessionId: HOST_SESSION_ID, turn: TURN_REF, seq, type: 'done', outcome: 'completed' };
}

function dispatchHarness() {
  const registrations = [];
  const releases = [];
  const activeRunDispatch = {
    invocationId: INVOCATION_ID,
    register(dispatcher) {
      registrations.push(dispatcher);
      return () => releases.push(dispatcher);
    },
  };
  return { activeRunDispatch, registrations, releases };
}

function bridgeFor(provider) {
  return new AgentSessionBridgeService({
    catId: 'cat-1',
    provider,
    resolveHostSession: () => ({ sessionId: HOST_SESSION_ID }),
    resolveMcpServers: () => [],
  });
}

/** Starts a turn and leaves it open at the first output event. */
async function openTurn(providerConfig = {}) {
  const harness = dispatchHarness();
  const inbox = new AsyncInbox();
  const fake = createFakeProvider({ inputSupport: 'supported', ...providerConfig, events: inbox });
  const service = bridgeFor(fake.provider);

  const stream = service.invoke('p', { invocationId: INVOCATION_ID, activeRunDispatch: harness.activeRunDispatch });
  const iterator = stream[Symbol.asyncIterator]();
  const firstMessage = iterator.next();
  inbox.push(outputEvent(1));
  await waitFor(() => harness.registrations.length === 1, 'dispatcher registration');
  const first = await firstMessage;
  assert.equal(first.value.type, 'text');

  return { ...harness, ...fake, inbox, iterator };
}

async function closeTurn({ iterator, inbox }) {
  inbox.push(doneEvent(2));
  inbox.close();
  return collectIterator(iterator);
}

test('[8] a supported implementation registers one dispatcher with the Host invocation id', async () => {
  const turn = await openTurn();

  assert.equal(turn.registrations.length, 1);
  const [dispatcher] = turn.registrations;
  assert.equal(dispatcher.invocationId, INVOCATION_ID, 'the Host has exactly one invocation id');
  assert.deepEqual(dispatcher.capabilities, { append: true, steer: false, inputReadReceipt: true });

  await closeTurn(turn);
});

test('[8] inputReadReceipt unsupported is reported as inputReadReceipt: false', async () => {
  const { provider } = createFakeProvider({
    inputSupport: 'supported',
    inputReadReceipt: 'unsupported',
    events: [outputEvent(1), doneEvent(2)],
  });
  const service = bridgeFor(provider);
  const { activeRunDispatch, registrations } = dispatchHarness();

  await collect(service.invoke('p', { invocationId: 'inv-1', activeRunDispatch }));

  assert.deepEqual(registrations[0].capabilities, {
    append: true,
    steer: false,
    inputReadReceipt: false,
  });
});

test('[8] dispatch forwards text, images, messageIds and the deliveryId verbatim', async () => {
  const turn = await openTurn({ inputResult: { status: 'accepted' } });

  const result = await turn.registrations[0].dispatch(
    {
      text: 'supplement',
      imagePaths: ['/tmp/supplement.png'],
      messageIds: ['message-1'],
      deliveryId: 'delivery-1',
    },
    { force: false, expectedInvocationId: 'inv-1' },
  );

  assert.equal(turn.calls.input.length, 1);
  const [call] = turn.calls.input;
  assert.equal(call.sessionId, HOST_SESSION_ID);
  assert.deepEqual(call.expected, TURN_REF, 'provider.input receives the full TurnRef');
  assert.equal(call.message.text, 'supplement');
  assert.deepEqual(call.message.images, ['/tmp/supplement.png']);
  assert.deepEqual(call.message.messageIds, ['message-1']);
  assert.equal(call.message.deliveryId, 'delivery-1');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.handle, {
    provider: 'other',
    carrier: 'other',
    threadId: 'native-1',
    turnId: 'turn-1',
  });

  await closeTurn(turn);
});

test('[14] no dispatcher is registered while no native id is known', async () => {
  const registrations = [];
  const releases = [];
  const activeRunDispatch = {
    invocationId: INVOCATION_ID,
    register(dispatcher) {
      registrations.push(dispatcher);
      return () => releases.push(dispatcher);
    },
  };
  const inbox = new AsyncInbox();
  const { provider, calls } = createFakeProvider({
    inputSupport: 'supported',
    binding: { state: 'pending_first_input' },
    nativeTurnId: null,
    events: inbox,
  });
  const service = bridgeFor(provider);
  const stream = service.invoke('p', { invocationId: INVOCATION_ID, activeRunDispatch });
  const iterator = stream[Symbol.asyncIterator]();
  const firstMessage = iterator.next();
  inbox.push(outputEvent(1));
  assert.equal((await firstMessage).value.type, 'text');

  assert.equal(registrations.length, 0, 'Host ids must never be substituted for native ids');
  assert.equal(calls.input.length, 0);

  inbox.push(doneEvent(2));
  inbox.close();
  await collectIterator(iterator);
  assert.equal(releases.length, 0);
});

test('[15] dispatch after the turn ended is refused without reaching the provider', async () => {
  const turn = await openTurn({ inputResult: { status: 'accepted' } });
  await closeTurn(turn);

  const result = await turn.registrations[0].dispatch(
    { text: 'too late', messageIds: ['message-1'], deliveryId: 'delivery-1' },
    { force: false, expectedInvocationId: 'inv-1' },
  );

  assert.deepEqual(result, { accepted: false, reason: 'active_run_closed', acceptance: 'not_accepted' });
  assert.equal(turn.calls.input.length, 0, 'a released dispatcher must not reach provider.input');
});

test('[8] a dispatch without deliveryId gets a generated id', async () => {
  const turn = await openTurn({ inputResult: { status: 'accepted' } });

  await turn.registrations[0].dispatch(
    { text: 'no delivery id', messageIds: ['message-1'] },
    { force: false, expectedInvocationId: 'inv-1' },
  );

  assert.match(
    turn.calls.input[0].message.deliveryId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'the bridge must synthesise a delivery id when the Host has none',
  );

  await closeTurn(turn);
});

test('[8] an unknown receipt is reported as acceptance unknown and is never retried', async () => {
  const turn = await openTurn({ inputResult: { status: 'unknown' } });

  const result = await turn.registrations[0].dispatch(
    { text: 'supplement', messageIds: ['message-1'], deliveryId: 'delivery-1' },
    { force: false, expectedInvocationId: 'inv-1' },
  );

  assert.deepEqual(result, { accepted: false, reason: 'exception', acceptance: 'unknown' });
  assert.equal(turn.calls.input.length, 1, 'the bridge must not retry an unknown receipt');

  await closeTurn(turn);
});

test('[8] an unsupported implementation registers nothing', async () => {
  const { provider } = createFakeProvider({
    inputSupport: 'unsupported',
    events: [outputEvent(1), doneEvent(2)],
  });
  const service = bridgeFor(provider);
  const { activeRunDispatch, registrations } = dispatchHarness();

  await collect(service.invoke('p', { invocationId: 'inv-1', activeRunDispatch }));

  assert.equal(registrations.length, 0);
});

test('[8] the dispatcher is released exactly once when the turn ends', async () => {
  const turn = await openTurn();

  assert.equal(turn.releases.length, 0, 'release must not run while the turn is still open');

  const rest = await closeTurn(turn);

  assert.deepEqual(
    rest.map((m) => m.type),
    ['done'],
  );
  assert.equal(turn.releases.length, 1);
});

test('[19] a dispatch fenced to another invocation is refused before reaching the provider', async () => {
  const turn = await openTurn({ inputResult: { status: 'accepted' } });

  const result = await turn.registrations[0].dispatch(
    { text: 'wrong run', messageIds: ['message-1'], deliveryId: 'delivery-1' },
    { force: false, expectedInvocationId: 'inv-other' },
  );

  assert.deepEqual(result, {
    accepted: false,
    reason: 'active_run_mismatch',
    acceptance: 'not_accepted',
  });
  assert.equal(turn.calls.input.length, 0, 'a mismatched fence must not reach provider.input');

  await closeTurn(turn);
});

test('[26] the dispatcher waits for a real native bind and then registers the native ids', async () => {
  const harness = dispatchHarness();
  const inbox = new AsyncInbox();
  const { provider, calls } = createFakeProvider({
    continuityEvidence: 'none',
    inputSupport: 'supported',
    binding: { state: 'pending_first_input' },
    events: inbox,
  });
  const service = bridgeFor(provider);

  const stream = service.invoke('p', { invocationId: INVOCATION_ID, activeRunDispatch: harness.activeRunDispatch });
  const iterator = stream[Symbol.asyncIterator]();
  const firstMessage = iterator.next();

  await waitFor(() => calls.startTurn.length === 1, 'startTurn');
  // No native session id exists yet: the bridge must not invent the Host id.
  assert.equal(harness.registrations.length, 0);

  inbox.push({
    scope: 'session',
    sessionId: HOST_SESSION_ID,
    seq: 1,
    type: 'native_bound',
    nativeSessionId: 'native-late',
  });
  inbox.push({
    scope: 'turn',
    sessionId: HOST_SESSION_ID,
    turn: TURN_REF,
    seq: 2,
    type: 'output',
    text: 'after bind',
    textMode: 'append',
  });

  const first = await firstMessage;
  assert.equal(first.value.type, 'session_init');
  assert.equal(first.value.sessionId, 'native-late');
  await waitFor(() => harness.registrations.length === 1, 'registration after native_bound');
  assert.deepEqual(harness.registrations[0].handle, {
    provider: 'other',
    carrier: 'other',
    threadId: 'native-late',
    turnId: 'turn-1',
  });

  inbox.push(doneEvent(3));
  inbox.close();
  const rest = await collectIterator(iterator);
  const text = rest.find((m) => m.type === 'text');
  assert.equal(text.metadata.sessionId, 'native-late', 'later messages carry the native id');

  assert.equal(harness.releases.length, 1);
});

test('[8] inspectInput is forwarded only when the provider offers it', async () => {
  const turn = await openTurn({ withInspectInput: true, inspectInputResult: 'accepted' });

  const dispatcher = turn.registrations[0];
  assert.equal(typeof dispatcher.inspectInput, 'function');
  assert.equal(await dispatcher.inspectInput('delivery-1'), 'accepted');
  assert.deepEqual(turn.calls.inspectInput[0], {
    sessionId: HOST_SESSION_ID,
    expected: TURN_REF,
    deliveryId: 'delivery-1',
  });

  await closeTurn(turn);

  const withoutInspect = await openTurn({ withInspectInput: false });
  assert.equal(withoutInspect.registrations[0].inspectInput, undefined);
  await closeTurn(withoutInspect);
});
