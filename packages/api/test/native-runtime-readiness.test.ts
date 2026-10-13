import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeAuthenticationStatus } from '../src/routes/native-runtime-readiness.js';

test('installed is not authenticated; supported CLIs report missing login before a model turn', () => {
  assert.equal(nativeAuthenticationStatus('claude', { loggedIn: false }), 'login_required');
  assert.equal(nativeAuthenticationStatus('codex', { account: null, requiresOpenaiAuth: true }), 'login_required');
});
test('recognizes native login without returning its credentials or declaring model availability', () => {
  assert.equal(
    nativeAuthenticationStatus('claude', { loggedIn: true, email: 'private', authMethod: 'api_key' }),
    'configured',
  );
  assert.equal(nativeAuthenticationStatus('codex', { account: { type: 'chatgpt', email: 'private' } }), 'configured');
  assert.equal(nativeAuthenticationStatus('codex', { account: { type: 'apiKey' } }), 'configured');
  assert.equal(nativeAuthenticationStatus('codex', { account: null, requiresOpenaiAuth: false }), 'configured');
});
test('unsupported ACP auth and malformed observations remain unknown rather than usable', () => {
  for (const input of [null, {}, { loggedIn: 'true' }, { account: {} }]) {
    assert.equal(nativeAuthenticationStatus('claude', input), 'unknown');
    assert.equal(nativeAuthenticationStatus('codex', input), 'unknown');
  }
  assert.equal(nativeAuthenticationStatus('dsh', { loggedIn: true }), 'unknown');
});
