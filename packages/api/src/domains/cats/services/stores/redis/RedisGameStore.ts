/**
 * Redis Game Store (F101)
 *
 * Persists game state to Redis. Enforces single active game per thread (KD-15).
 * Uses optimistic concurrency via version field.
 */

import type { GameRuntime } from '@cat-cafe/shared';
import type { RedisClient } from '@cat-cafe/shared/utils';
import type { IGameStore } from '../ports/GameStore.js';
import { GameKeys } from '../redis-keys/game-keys.js';

export class RedisGameStore implements IGameStore {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async createGame(runtime: GameRuntime): Promise<GameRuntime> {
    // KD-15: check no active game on this thread
    const existingGameId = await this.redis.get(GameKeys.threadActive(runtime.threadId));
    if (existingGameId) {
      throw new Error(`Thread ${runtime.threadId} already has an active game: ${existingGameId}`);
    }

    const pipeline = this.redis.multi();
    pipeline.set(GameKeys.detail(runtime.gameId), JSON.stringify(runtime));
    pipeline.set(GameKeys.threadActive(runtime.threadId), runtime.gameId);
    await pipeline.exec();

    return runtime;
  }

  async getGame(gameId: string): Promise<GameRuntime | null> {
    const data = await this.redis.get(GameKeys.detail(gameId));
    if (!data) return null;
    return JSON.parse(data) as GameRuntime;
  }

  async getActiveGame(threadId: string): Promise<GameRuntime | null> {
    const gameId = await this.redis.get(GameKeys.threadActive(threadId));
    if (!gameId) return null;
    return this.getGame(gameId);
  }

  async updateGame(gameId: string, runtime: GameRuntime): Promise<void> {
    const existing = await this.redis.get(GameKeys.detail(gameId));
    if (!existing) throw new Error(`Game ${gameId} not found`);

    const current = JSON.parse(existing) as GameRuntime;
    if (current.version !== runtime.version - 1) {
      throw new Error(`Version conflict for game ${gameId}: expected ${current.version}, got ${runtime.version - 1}`);
    }

    await this.redis.set(GameKeys.detail(gameId), JSON.stringify(runtime));
  }

  async endGame(gameId: string, winner: string): Promise<void> {
    const existing = await this.redis.get(GameKeys.detail(gameId));
    if (!existing) throw new Error(`Game ${gameId} not found`);

    const runtime = JSON.parse(existing) as GameRuntime;
    runtime.status = 'finished';
    runtime.winner = winner;
    runtime.version++;
    runtime.updatedAt = Date.now();

    const pipeline = this.redis.multi();
    pipeline.set(GameKeys.detail(gameId), JSON.stringify(runtime));
    // Remove from active, add to history
    pipeline.del(GameKeys.threadActive(runtime.threadId));
    pipeline.zadd(GameKeys.threadHistory(runtime.threadId), runtime.updatedAt, gameId);
    await pipeline.exec();
  }
}
