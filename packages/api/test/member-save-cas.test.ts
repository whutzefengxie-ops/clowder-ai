/**
 * S1 (W1 save CAS): member PATCH revision enforcement + query-by-catId read.
 *
 * Formal writers (`x-clowder-formal-edit: 1`) must carry the member's
 * configurationRevision; legacy writers without the marker keep the transitional
 * blind-write behavior. The narrow GET read lets a create-timeout client look up
 * its submitted stable catId (and its configurationRevision) before retrying.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import Fastify from 'fastify';
import { catsRoutes } from '../src/routes/cats.js';
import { _clearActiveRootCacheForTest } from '../src/utils/active-project-root.js';

const USER_HEADER = { 'x-cat-cafe-user': 'member-editor' };
const FORMAL_HEADER = { ...USER_HEADER, 'x-clowder-formal-edit': '1' };

type App = ReturnType<typeof Fastify>;

function makeTemplate() {
  return {
    version: 2,
    breeds: [
      {
        id: 'ragdoll',
        catId: 'opus',
        name: '布偶猫',
        displayName: '布偶猫',
        avatar: '/avatars/opus.png',
        color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
        mentionPatterns: ['@opus'],
        roleDescription: '架构师',
        defaultVariantId: 'opus-default',
        variants: [
          {
            id: 'opus-default',
            clientId: 'anthropic',
            defaultModel: 'claude-sonnet-4-5-20250929',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
        ],
      },
      {
        id: 'codex',
        catId: 'codex',
        name: '缅因猫',
        displayName: '缅因猫',
        avatar: '/avatars/codex.png',
        color: { primary: '#123456', secondary: '#abcdef' },
        mentionPatterns: ['@codex'],
        roleDescription: '审查',
        defaultVariantId: 'codex-default',
        variants: [
          {
            id: 'codex-default',
            clientId: 'openai',
            defaultModel: 'gpt-5.4',
            mcpSupport: true,
            cli: { command: 'codex', outputFormat: 'json' },
          },
        ],
      },
    ],
    roster: {
      opus: { family: 'ragdoll', roles: ['architect'], lead: true, available: true, evaluation: 'primary' },
      codex: { family: 'codex', roles: ['review'], lead: false, available: true, evaluation: 'secondary' },
    },
    reviewPolicy: {
      requireDifferentFamily: true,
      preferActiveInThread: true,
      preferLead: true,
      excludeUnavailable: true,
    },
  };
}

async function setup(): Promise<App> {
  const projectRoot = mkdtempSync(join(tmpdir(), 'member-cas-'));
  const templatePath = join(projectRoot, 'cat-template.json');
  const template = makeTemplate();
  writeFileSync(templatePath, JSON.stringify(template, null, 2));
  const catalogDir = join(projectRoot, '.cat-cafe');
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(join(catalogDir, 'cat-catalog.json'), JSON.stringify(template, null, 2));
  process.env.CAT_TEMPLATE_PATH = templatePath;
  _clearActiveRootCacheForTest();
  const app = Fastify();
  await app.register(catsRoutes);
  await app.ready();
  return app;
}

interface CatRead {
  id: string;
  nickname?: string;
  configurationRevision?: string;
}

async function readCats(app: App, catId?: string): Promise<CatRead[]> {
  const url = catId ? `/api/cats?catId=${encodeURIComponent(catId)}` : '/api/cats';
  const response = await app.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 200, response.payload);
  return response.json().cats as CatRead[];
}

async function readMember(app: App, catId: string): Promise<CatRead> {
  const cats = await readCats(app, catId);
  assert.equal(cats.length, 1, `expected exactly one member for catId=${catId}`);
  assert.equal(cats[0]?.id, catId);
  return cats[0] as CatRead;
}

async function patchMember(app: App, payload: Record<string, unknown>, headers: Record<string, string>) {
  return app.inject({ method: 'PATCH', url: '/api/cats/opus', headers, payload });
}

describe('PATCH /api/cats/:id member CAS', () => {
  let app: App | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete process.env.CAT_TEMPLATE_PATH;
    _clearActiveRootCacheForTest();
  });

  it('GET /api/cats?catId= returns only that member with its configurationRevision', async () => {
    app = await setup();
    const all = await readCats(app);
    assert.deepEqual(all.map((cat) => cat.id).sort(), ['codex', 'opus']);
    const member = await readMember(app, 'opus');
    assert.equal(typeof member.configurationRevision, 'string');
    assert.equal(member.configurationRevision?.length, 64);
  });

  it('GET /api/cats?catId= returns an empty list for an unknown stable catId', async () => {
    app = await setup();
    assert.deepEqual(await readCats(app, 'never-created'), []);
  });

  it('formal PATCH without expectedRevision returns 428 and does not write', async () => {
    app = await setup();
    const before = await readMember(app, 'opus');
    const response = await patchMember(app, { nickname: '改名' }, FORMAL_HEADER);
    assert.equal(response.statusCode, 428, response.payload);
    assert.equal(response.json().code, 'member_revision_required');
    assert.equal((await readMember(app, 'opus')).nickname, before.nickname);
  });

  it('stale expectedRevision returns 409 member_configuration_conflict and does not write', async () => {
    app = await setup();
    const before = await readMember(app, 'opus');
    const response = await patchMember(
      app,
      { nickname: '改名', expectedRevision: 'a'.repeat(64) },
      FORMAL_HEADER,
    );
    assert.equal(response.statusCode, 409, response.payload);
    const body = response.json();
    assert.equal(body.code, 'member_configuration_conflict');
    assert.equal(typeof body.error, 'string');
    assert.equal((await readMember(app, 'opus')).nickname, before.nickname);
  });

  it('matching expectedRevision writes the member and the read-back revision changes', async () => {
    app = await setup();
    const before = await readMember(app, 'opus');
    const response = await patchMember(
      app,
      { nickname: '改名', expectedRevision: before.configurationRevision },
      FORMAL_HEADER,
    );
    assert.equal(response.statusCode, 200, response.payload);
    const after = await readMember(app, 'opus');
    assert.equal(after.nickname, '改名');
    assert.notEqual(after.configurationRevision, before.configurationRevision);
    assert.equal(response.json().cat.configurationRevision, after.configurationRevision);
  });

  it('legacy writers without the formal header still blind-write (transitional compatibility)', async () => {
    app = await setup();
    const before = await readMember(app, 'opus');
    const response = await patchMember(app, { nickname: '旧页面保存' }, USER_HEADER);
    assert.equal(response.statusCode, 200, response.payload);
    const after = await readMember(app, 'opus');
    assert.equal(after.nickname, '旧页面保存');
    assert.notEqual(after.configurationRevision, before.configurationRevision);
  });

  it('a stale expectedRevision on the legacy path still conflicts instead of overwriting', async () => {
    app = await setup();
    const response = await patchMember(
      app,
      { nickname: '改名', expectedRevision: 'b'.repeat(64) },
      USER_HEADER,
    );
    assert.equal(response.statusCode, 409, response.payload);
    assert.equal(response.json().code, 'member_configuration_conflict');
    assert.equal((await readMember(app, 'opus')).nickname, undefined);
  });
});
