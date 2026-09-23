import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { detectAvailableClients } from '../src/domains/cats/services/first-run-quest/client-detection.js';

const homeDir = join(process.cwd(), 'test-home-unused');
const claudePath = join(homeDir, '.claude', '.credentials.json');
const codexPath = join(homeDir, '.codex', 'auth.json');
const claude = { claudeAiOauth: { accessToken: 'fake-access', refreshToken: 'fake-refresh' } };
const codex = { tokens: { access_token: 'fake-access', refresh_token: 'fake-refresh' } };

async function detect(files: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) {
  return detectAvailableClients({
    existsOnPath: async () => true,
    auth: { homeDir, env, readFile: (path: string) => {
      if (!(path in files)) throw new Error('missing');
      return typeof files[path] === 'string' ? files[path] as string : JSON.stringify(files[path]);
    } },
  });
}

test('native Claude and Codex OAuth credentials are detected without accounts or env keys', async () => {
  const clients = await detect({ [claudePath]: claude, [codexPath]: codex });
  for (const id of ['claude', 'codex']) {
    assert.equal(clients.find((client) => client.client === id)?.authenticated, true);
  }
  assert.equal(JSON.stringify(clients).includes('fake-access'), false);
  assert.equal(JSON.stringify(clients).includes('fake-refresh'), false);
});

test('CODEX_HOME selects the runtime account without falling back to ambient credentials', async () => {
  const custom = join(homeDir, 'custom-codex');
  const clients = await detect({ [codexPath]: codex }, { CODEX_HOME: custom });
  assert.equal(clients.find((client) => client.client === 'codex')?.authenticated, false);
  const loggedIn = await detect({ [join(custom, 'auth.json')]: codex }, { CODEX_HOME: custom });
  assert.equal(loggedIn.find((client) => client.client === 'codex')?.authenticated, true);
});

test('missing, malformed and incomplete credentials fail closed', async () => {
  for (const value of ['{', [], null, {}, { tokens: { access_token: 7, refresh_token: 'x' } }, { tokens: { access_token: ' ', refresh_token: 'x' } }]) {
    const clients = await detect({ [codexPath]: value, [claudePath]: value });
    assert.equal(clients.some((client) => client.authenticated), false);
  }
});

test('environment keys remain supported and whitespace keys are rejected', async () => {
  const clients = await detect({}, { OPENAI_API_KEY: 'fake-key', ANTHROPIC_API_KEY: ' ', GEMINI_API_KEY: 'fake-gemini' });
  assert.equal(clients.find((client) => client.client === 'codex')?.authenticated, true);
  assert.equal(clients.find((client) => client.client === 'gemini')?.authenticated, true);
  assert.equal(clients.find((client) => client.client === 'claude')?.authenticated, false);
});
