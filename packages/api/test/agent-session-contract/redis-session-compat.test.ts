import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RedisClient } from '@cat-cafe/shared/utils';
import { computeCompatibilityKey, toSessionCompatibilitySnapshot } from '../../src/domains/cats/services/agents/session-contract/compatibility-key.js';
import type { CompatibilityStructure } from '../../src/domains/cats/services/agents/session-contract/compatibility-key.js';
import { RedisSessionChainStore } from '../../src/domains/cats/services/stores/redis/RedisSessionChainStore.js';

/**
 * Minimal in-memory Redis stand-in for the SessionChain store paths W3
 * touches: create() (Lua ARGV contract), update() hash writes and hydrate().
 * This is a fake, not a Redis substitute for the real integration suite.
 */
class FakeRedis {
  readonly hashes = new Map<string, Record<string, string>>();
  readonly evalCalls: { script: string; args: unknown[] }[] = [];
  readonly options: { keyPrefix?: string } = {};

  async eval(script: string, numkeys: number, ...rest: unknown[]): Promise<unknown> {
    this.evalCalls.push({ script, args: rest });
    const keys = rest.slice(0, numkeys) as string[];
    const argv = rest.slice(numkeys) as string[];
    if (script.includes("return {'created'")) {
      const detailKey = keys[2] as string;
      const hash: Record<string, string> = {
        id: argv[0] as string,
        threadId: argv[2] as string,
        catId: argv[3] as string,
        userId: argv[4] as string,
        seq: '0',
        status: 'active',
        messageCount: '0',
        createdAt: argv[5] as string,
        updatedAt: argv[5] as string,
      };
      const optional: [string, number][] = [
        ['cliSessionId', 1],
        ['chainKey', 8],
        ['workingDirectory', 9],
        ['workspaceFingerprint', 10],
        ['scopedInvocation', 14],
        ['compat', 15],
        ['identityArtifact', 16],
        ['fragmentSwitch', 17],
      ];
      for (const [field, position] of optional) {
        const value = argv[position - 1];
        if (value) hash[field] = value;
      }
      this.hashes.set(detailKey, hash);
      return ['created', argv[0], '0'];
    }
    return 0; // COMPARE_DELETE and similar helpers
  }
  async exists(key: string): Promise<number> {
    return this.hashes.has(key) ? 1 : 0;
  }
  async hexists(key: string, field: string): Promise<number> {
    return this.hashes.get(key)?.[field] === undefined ? 0 : 1;
  }
  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null;
  }
  async hset(key: string, ...pairs: (string | number)[]): Promise<number> {
    const hash = this.hashes.get(key) ?? {};
    for (let index = 0; index < pairs.length; index += 2) {
      hash[String(pairs[index])] = String(pairs[index + 1]);
    }
    this.hashes.set(key, hash);
    return pairs.length / 2;
  }
  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);
    if (!hash) return 0;
    let removed = 0;
    for (const field of fields) {
      if (field in hash) {
        delete hash[field];
        removed++;
      }
    }
    return removed;
  }
  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }
  async del(key: string): Promise<number> {
    return this.hashes.delete(key) ? 1 : 0;
  }
  async set(): Promise<'OK'> {
    return 'OK';
  }
  async get(): Promise<null> {
    return null;
  }
}

const structure: CompatibilityStructure = {
  clientId: 'claude',
  implementation: 'builtin:claude',
  workspaceRoot: '/repo',
  instructionDigest: 'sha-instructions',
};
const snapshot = toSessionCompatibilitySnapshot(computeCompatibilityKey(structure));
const identityArtifact = { v: 1 as const, instructionDigest: 'sha-instructions', evidenceRef: 'e1', adoptedAt: 5 };
const fragmentSwitch = { at: 9, reason: 'identity_update_unverified', changed: ['instructionDigest'] };

function storeWithFake(): { store: RedisSessionChainStore; fake: FakeRedis } {
  const fake = new FakeRedis();
  return { store: new RedisSessionChainStore(fake as unknown as RedisClient), fake };
}

const baseInput = { threadId: 'thread-1', catId: 'opus' as const, userId: 'user-1' };

test('Redis create appends compat/identityArtifact/fragmentSwitch at stable ARGV positions 15-17', async () => {
  const { store, fake } = storeWithFake();
  const record = await store.create({ ...baseInput, compat: snapshot, identityArtifact, fragmentSwitch });
  assert.deepEqual(record.compat, snapshot);
  assert.deepEqual(record.identityArtifact, identityArtifact);
  assert.deepEqual(record.fragmentSwitch, fragmentSwitch);

  const { args } = fake.evalCalls[0];
  assert.equal(args.length, 7 + 17, 'seven KEYS plus seventeen ARGV entries');
  assert.equal(args[7 + 0], record.id, 'ARGV[1] id stays at its original position');
  assert.equal(args[7 + 2], baseInput.threadId, 'ARGV[3] threadId stays at its original position');
  assert.equal(args[7 + 13], '', 'ARGV[14] scopedInvocation is still positional');
  assert.deepEqual(JSON.parse(String(args[7 + 14])), snapshot);
  assert.deepEqual(JSON.parse(String(args[7 + 15])), identityArtifact);
  assert.deepEqual(JSON.parse(String(args[7 + 16])), fragmentSwitch);
});

test('Redis create without W3 metadata keeps legacy-empty ARGV slots and a legacy record shape', async () => {
  const { store, fake } = storeWithFake();
  const record = await store.create({ ...baseInput });
  assert.equal(record.compat, undefined);
  assert.equal(record.identityArtifact, undefined);
  assert.equal(record.fragmentSwitch, undefined);
  const { args } = fake.evalCalls[0];
  assert.equal(args[7 + 14], '');
  assert.equal(args[7 + 15], '');
  assert.equal(args[7 + 16], '');
});

test('Redis update writes W3 metadata into the hash and hydrate reads it back', async () => {
  const { store, fake } = storeWithFake();
  const record = await store.create({ ...baseInput });
  const detailKey = [...fake.hashes.keys()][0];
  assert.ok(detailKey);
  const updated = await store.update(record.id, { compat: snapshot, identityArtifact, fragmentSwitch });
  assert.deepEqual(updated?.compat, snapshot);
  assert.deepEqual(fake.hashes.get(detailKey)?.compat, JSON.stringify(snapshot));
  const reread = await store.get(record.id);
  assert.deepEqual(reread?.compat, snapshot);
  assert.deepEqual(reread?.identityArtifact, identityArtifact);
  assert.deepEqual(reread?.fragmentSwitch, fragmentSwitch);
});

test('Redis hydrate treats corrupt/absent W3 metadata as unverifiable instead of trusting it', async () => {
  const { store, fake } = storeWithFake();
  const record = await store.create({ ...baseInput });
  const detailKey = [...fake.hashes.keys()][0];
  assert.ok(detailKey);
  const hash = fake.hashes.get(detailKey);
  assert.ok(hash);
  hash.compat = '{not-json';
  const reread = await store.get(record.id);
  assert.equal(reread?.compat, undefined);
  assert.equal(reread?.identityArtifact, undefined);
});
