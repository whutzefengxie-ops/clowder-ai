import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';

// Source-leaf characterization only: no native process, real credential read or request.
const root = resolve(import.meta.dirname, '../..');
const provider = 'packages/api/src/domains/cats/services/agents/providers/';
const paths = {
  env: `${provider}env-map.ts`,
  spawn: `${provider}acp/acp-spawn-env.ts`,
  patterns: 'packages/api/src/utils/cli-error-patterns.ts',
  sanitizer: 'packages/api/src/utils/sanitize-cli-stderr.ts',
  events: `${provider}pi/pi-acp-events.ts`,
  rpc: `${provider}pi/pi-rpc-process.ts`,
};
const sources = new Map();
function source(name) {
  const raw = readFileSync(resolve(root, paths[name]), 'utf8');
  sources.set(paths[name], createHash('sha256').update(raw).digest('hex'));
  return stripTypeScriptTypes(raw, { mode: 'transform' });
}
const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const envUrl = data(source('env'));
const spawnUrl = data(source('spawn').replace("'../env-map.js'", JSON.stringify(envUrl)));
const patternsUrl = data(source('patterns'));
const sanitizerUrl = data(source('sanitizer').replace("'./cli-error-patterns.js'", JSON.stringify(patternsUrl)));
// Import only the actual pure record() helper, without constructing PiRpcProcess.
const rpcSource = source('rpc');
const recordUrl = data(rpcSource.slice(rpcSource.indexOf('export const record ='), rpcSource.indexOf('/** Official success:false')));
const eventsUrl = data(source('events')
  .replace("'../../../../../../utils/sanitize-cli-stderr.js'", JSON.stringify(sanitizerUrl))
  .replace("'./pi-rpc-process.js'", JSON.stringify(recordUrl)));
const { prepareAcpProcessEnv } = await import(spawnUrl);
const { PiAcpEvents } = await import(eventsUrl);
const checks = [];
function check(name, fn) { fn(); checks.push({ name, result: 'pass' }); }
const account = { id: 'synthetic-review', authType: 'api_key', apiKey: 'synthetic-only' };
check('null account generates no override', () => assert.equal(prepareAcpProcessEnv({ clientId: 'acp', account: null }), undefined));
check('generic ACP provider does not guess an environment mapping', () => assert.equal(prepareAcpProcessEnv({ clientId: 'acp', provider: 'openai', account }), undefined));
check('explicit account template maps the key', () => assert.deepEqual(prepareAcpProcessEnv({ clientId: 'acp', account: { ...account, envVars: { DEEPSEEK_API_KEY: '${api_key}' } } }), { DEEPSEEK_API_KEY: 'synthetic-only' }));
check('explicit missing key fails', () => assert.throws(() => prepareAcpProcessEnv({ clientId: 'acp', account: { ...account, apiKey: '' } }), /no API key/));
check('reserved application environment cannot be templated', () => assert.equal(prepareAcpProcessEnv({ clientId: 'acp', account: { ...account, envVars: { CAT_CAFE_REVIEW_SYNTHETIC: '${api_key}' } } }), undefined));
check('Pi provider error already propagates in the event translator', () => {
  const events = new PiAcpEvents(() => {});
  events.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'synthetic failure' } });
  assert.match(events.failure?.message ?? '', /synthetic failure/);
});
check('Pi completed empty assistant is a reproducible candidate gap', () => {
  const updates = [];
  const events = new PiAcpEvents((value) => updates.push(value));
  events.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [] } });
  assert.equal(events.completedAssistant, true);
  assert.equal(events.failure, undefined);
  assert.equal(updates.length, 0);
});
check('Pi ordinary final text still emits one update', () => {
  const updates = [];
  const events = new PiAcpEvents((value) => updates.push(value));
  events.accept({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'synthetic response' }] } });
  assert.equal(updates.length, 1);
  assert.equal(events.failure, undefined);
});
const plan = readFileSync(resolve(root, 'docs/plans/issue-1668-acp-native-credentials.md'));
console.log(JSON.stringify({ kind: 'plan-review-source-characterization', node: process.version, scope: 'Node TypeScript transform of actual leaf modules with local import URL rewrite; actual record helper extracted; no native spawn, credential reads, API call or UI acceptance', planSha256: createHash('sha256').update(plan).digest('hex'), sources: Object.fromEntries(sources), checks }, null, 2));
