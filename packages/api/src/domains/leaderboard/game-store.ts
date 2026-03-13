/**
 * F075 Phase B — In-memory game record store
 * Tracks game results (猫猫杀, 谁是卧底, etc.) and computes stats.
 */

import { randomUUID } from 'node:crypto';
import type { GameRecord, GameRecordInput, GameStats, RankedCat } from '@cat-cafe/shared';

export class GameStore {
  private records: GameRecord[] = [];

  append(input: GameRecordInput): GameRecord {
    const record: GameRecord = { ...input, id: randomUUID() };
    this.records.push(record);
    return record;
  }

  getByCat(catId: string): GameRecord[] {
    return this.records.filter((r) => r.catId === catId);
  }

  getByGame(game: string): GameRecord[] {
    return this.records.filter((r) => r.game === game);
  }

  computeGameStats(catNames: Record<string, string>): GameStats {
    // Cat Kill stats
    const catKillRecords = this.records.filter((r) => r.game === 'cat-kill');
    const wins = catKillRecords.filter((r) => r.result === 'win' || r.result === 'mvp').length;
    const mvps = catKillRecords.filter((r) => r.result === 'mvp').length;

    const winCount = new Map<string, number>();
    for (const r of catKillRecords) {
      if (r.result === 'win' || r.result === 'mvp') {
        winCount.set(r.catId, (winCount.get(r.catId) ?? 0) + 1);
      }
    }
    const topCat = this.topRanked(winCount, catNames);

    // Who Spy stats
    const spyRecords = this.records.filter((r) => r.game === 'who-spy');
    const shameCount = spyRecords.filter((r) => r.result === 'shame').length;

    const shameMap = new Map<string, number>();
    for (const r of spyRecords) {
      if (r.result === 'shame') {
        shameMap.set(r.catId, (shameMap.get(r.catId) ?? 0) + 1);
      }
    }
    const shameCat = this.topRanked(shameMap, catNames);

    return {
      catKill: { wins, mvps, ...(topCat ? { topCat } : {}) },
      whoSpy: { shameCount, ...(shameCat ? { shameCat } : {}) },
    };
  }

  private topRanked(counter: Map<string, number>, catNames: Record<string, string>): RankedCat | undefined {
    if (counter.size === 0) return undefined;
    const [catId, count] = [...counter.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return { catId, displayName: catNames[catId] ?? catId, count, rank: 1 };
  }

  get size(): number {
    return this.records.length;
  }
}
