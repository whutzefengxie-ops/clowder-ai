/**
 * Task Store Factory
 * Redis → RedisTaskStore, 无 → TaskStore (内存)
 */

import type { RedisClient } from '@cat-cafe/shared/utils';
import type { ITaskStore } from '../ports/TaskStore.js';
import { TaskStore } from '../ports/TaskStore.js';
import { RedisTaskStore } from '../redis/RedisTaskStore.js';

function resolveTaskTtlSeconds(): number | undefined {
  const raw = process.env.TASK_TTL_SECONDS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[TaskStoreFactory] Invalid TASK_TTL_SECONDS='${raw}', using default`);
    return undefined;
  }
  return Math.trunc(parsed);
}

export function createTaskStore(redis?: RedisClient): ITaskStore {
  if (redis) {
    const ttlSeconds = resolveTaskTtlSeconds();
    return new RedisTaskStore(redis, ttlSeconds !== undefined ? { ttlSeconds } : undefined);
  }
  return new TaskStore();
}
