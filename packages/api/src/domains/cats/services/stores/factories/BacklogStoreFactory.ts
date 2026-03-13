import type { RedisClient } from '@cat-cafe/shared/utils';
import type { IBacklogStore } from '../ports/BacklogStore.js';
import { BacklogStore } from '../ports/BacklogStore.js';
import { RedisBacklogStore } from '../redis/RedisBacklogStore.js';

function resolveBacklogTtlSeconds(): number | undefined {
  const raw = process.env.BACKLOG_TTL_SECONDS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[BacklogStoreFactory] Invalid BACKLOG_TTL_SECONDS='${raw}', using default`);
    return undefined;
  }
  return Math.trunc(parsed);
}

export function createBacklogStore(redis?: RedisClient): IBacklogStore {
  if (redis) {
    const ttlSeconds = resolveBacklogTtlSeconds();
    return new RedisBacklogStore(redis, ttlSeconds !== undefined ? { ttlSeconds } : undefined);
  }
  return new BacklogStore();
}
