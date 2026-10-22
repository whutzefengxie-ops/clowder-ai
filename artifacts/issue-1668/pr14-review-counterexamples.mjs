import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const authorRoot = resolve(root, '../feat-issue-1668-acp-credentials');
const base = '1baaed2e9fadca8b550ae7041ef5a663994ab2d4';
const head = process.argv[2] ?? '117b0e76381ec04752c25257bb0f1a2c1537e767';
const expectFixed = process.argv[3] === 'fixed';
const actualBase = execFileSync('git', ['merge-base', base, head], { cwd: root, encoding: 'utf8' }).trim();
const provider = 'packages/api/src/domains/cats/services/agents/providers/';
const sources = {};
const data = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
function raw(sha, path) {
  const result = execFileSync('git', ['show', `${sha}:${path}`], { cwd: root });
  sources[`${sha}:${path}`] = createHash('sha256').update(result).digest('hex');
  return result;
}
function source(sha, path) { return stripTypeScriptTypes(raw(sha, path).toString('utf8'), { mode: 'transform' }); }
async function modules(sha) {
  const env = data(source(sha, `${provider}env-map.ts`));
  const spawn = data(source(sha, `${provider}acp/acp-spawn-env.ts`).replace("'../env-map.js'", JSON.stringify(env)));
  const patterns = data(source(sha, 'packages/api/src/utils/cli-error-patterns.ts'));
  const sanitizer = data(source(sha, 'packages/api/src/utils/sanitize-cli-stderr.ts').replace("'./cli-error-patterns.js'", JSON.stringify(patterns)));
  const rpc = source(sha, `${provider}pi/pi-rpc-process.ts`);
  const record = data(rpc.slice(rpc.indexOf('export const record ='), rpc.indexOf('/** Official success:false')));
  const events = data(source(sha, `${provider}pi/pi-acp-events.ts`)
    .replace("'../../../../../../utils/sanitize-cli-stderr.js'", JSON.stringify(sanitizer))
    .replace("'./pi-rpc-process.js'", JSON.stringify(record)));
  return { ...(await import(spawn)), ...(await import(events)) };
}
const observations = [];
for (const sha of [base, head]) {
  const { prepareAcpProcessEnv, PiAcpEvents } = await modules(sha);
  const account = { id: 'synthetic-review', authType: 'api_key', apiKey: 'synthetic-only' };
  for (const [name, options] of [
    ['null-account', { account: null }],
    ['literal-provider-key', { account: { ...account, envVars: { DEEPSEEK_API_KEY: 'synthetic-literal' } } }],
    ['no-template-native-or-parent-env', { account }],
    ['explicit-key-template', { account: { ...account, envVars: { DEEPSEEK_API_KEY: '${api_key}' } } }],
  ]) {
    try {
      const env = prepareAcpProcessEnv({ clientId: 'acp', ...options });
      observations.push({ sha, name, accepted: true, env: env ?? null });
    } catch (error) { observations.push({ sha, name, accepted: false, error: error.message }); }
  }
  for (const [name, content, delta] of [
    ['empty-content-array', []],
    ['empty-text-block', [{ type: 'text', text: '' }]],
    ['empty-thinking-block', [{ type: 'thinking', thinking: '' }]],
    ['empty-stream-delta', [], ''],
    ['ordinary-text', [{ type: 'text', text: 'synthetic text' }]],
  ]) {
    const updates = [];
    const events = new PiAcpEvents((value) => updates.push(value));
    events.accept({ type: 'message_start', message: { role: 'assistant' } });
    if (delta !== undefined) events.accept({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
    events.accept({ type: 'message_end', message: { role: 'assistant', content, stopReason: 'stop' } });
    observations.push({ sha, name, completedAssistant: events.completedAssistant, failure: events.failure?.message ?? null, visibleCharacterCount: updates.reduce((sum, update) => sum + (update.content?.text?.length ?? 0), 0) });
  }
}
const find = (sha, name) => observations.find((item) => item.sha === sha && item.name === name);
assert.equal(find(base, 'literal-provider-key').accepted, true);
assert.equal(find(head, 'literal-provider-key').accepted, expectFixed);
if (expectFixed) assert.equal(find(head, 'no-template-native-or-parent-env').accepted, true);
assert.equal(find(head, 'empty-content-array').completedAssistant, false);
for (const name of ['empty-text-block', 'empty-thinking-block', 'empty-stream-delta']) {
  assert.equal(find(head, name).completedAssistant, !expectFixed);
  assert.equal(find(head, name).visibleCharacterCount, 0);
}
const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', actualBase, head, '--', 'packages'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const biome = resolve(authorRoot, 'node_modules/@biomejs/biome/bin/biome');
const formatting = [];
for (const path of changed) {
  const input = raw(head, path);
  const result = spawnSync(process.execPath, [biome, 'format', `--stdin-file-path=${path}`], { cwd: authorRoot, input, encoding: 'utf8' });
  formatting.push({ path, formatterExitCode: result.status, committedBytesMatchFormatter: input.equals(Buffer.from(result.stdout)), error: result.status === 0 ? null : result.stderr });
}
console.log(JSON.stringify({ kind: 'pr14-exact-commit-source-counterexamples', requiredBase: base, actualBase, head, scope: 'Actual Git blobs, Node TypeScript transform, import URL rewrite and extraction of actual record helper. Synthetic leaf inputs only; no real credentials, native model process or provider requests. Format checks consume committed LF bytes from the six implementation files relative to actual fork base.', observations, formatting, sources }, null, 2));
