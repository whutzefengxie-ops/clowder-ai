import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveFixture, session, turn } from './fake-session-provider.js';

const dispatchOptions = { expectedInvocationId: 'inv', force: false };
const foreign = {
  session: { sessionId: 'another-host-session' },
  invocation: { turn: { invocationId: 'previous-invocation', nativeTurnId: 'native-turn' } },
  nativeTurn: { turn: { invocationId: 'inv', nativeTurnId: 'previous-native-turn' } },
};

for (const [boundary, fields] of Object.entries(foreign)) {
  test(`a ${boundary} mismatch cannot consume the current delivery receipt or finish its turn`, async (t) => {
    const f = await liveFixture();
    t.after(() => f.finish());
    let reads = 0;
    await f.dispatcher.dispatch(
      {
        text: 'one input',
        messageIds: ['one-message'],
        deliveryId: 'same-delivery',
        onInputRead: async () => {
          reads++;
        },
      },
      dispatchOptions,
    );
    f.provider.inbox.push(turn('input_read', { deliveryId: 'same-delivery', ...fields }));
    f.provider.inbox.push(turn('output', { text: 'foreign text', textMode: 'append', ...fields }));
    f.provider.inbox.push(turn('done', { outcome: 'completed', ...fields }));
    f.provider.inbox.push(turn('status', { phase: 'still-current' }));
    const next = await f.iterator.next();
    assert.equal(reads, 0, 'a matching deliveryId does not prove the Host session or turn');
    assert.equal(next.value.type, 'status');
    assert.equal(next.value.content, 'still-current');
    assert.equal(f.releases, 0);
    f.provider.inbox.push(turn('input_read', { deliveryId: 'same-delivery' }));
    f.provider.inbox.push(turn('status', { phase: 'read-current' }));
    await f.iterator.next();
    assert.equal(reads, 1);
    assert.equal(f.provider.calls.input.length, 1);
  });
}

test('foreign session metadata cannot bind the current turn to another native history', async (t) => {
  const f = await liveFixture();
  t.after(() => f.finish());
  f.provider.inbox.push(session('native_bound', { sessionId: 'another-host', nativeSessionId: 'foreign-native' }));
  f.provider.inbox.push(session('context', { nativeTurnRef: 'previous-native-turn', model: 'foreign-model' }));
  f.provider.inbox.push(turn('status', { phase: 'current-metadata' }));
  const next = await f.iterator.next();
  assert.equal(next.value.type, 'status');
  assert.equal(next.value.content, 'current-metadata');
  assert.notEqual(next.value.metadata.sessionId, 'foreign-native');
  assert.notEqual(next.value.metadata.model, 'foreign-model');
});

test('absent native turn IDs preserve the existing Host invocation authority', async (t) => {
  const f = await liveFixture({}, {}, (provider) => {
    provider.omitNativeTurn = true;
  });
  t.after(() => f.finish());
  f.provider.inbox.push(turn('output', { text: 'current', textMode: 'append', turn: { invocationId: 'inv' } }));
  assert.equal((await f.iterator.next()).value.content, 'current');
});
