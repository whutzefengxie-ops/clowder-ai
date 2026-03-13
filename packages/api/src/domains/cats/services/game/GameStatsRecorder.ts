/**
 * GameStatsRecorder (F101 Task B10)
 *
 * Extracts per-player stats from a finished GameRuntime for leaderboard integration.
 * All game types (werewolf, future games) produce the same stats schema.
 */

import type { GameRuntime } from '@cat-cafe/shared';

export interface PlayerStats {
  actorId: string;
  actorType: string;
  role: string;
  faction: string;
  survived: boolean;
  won: boolean;
}

export interface GameStats {
  gameId: string;
  gameType: string;
  threadId: string;
  endedAt: number;
  winner: string;
  players: PlayerStats[];
}

export class GameStatsRecorder {
  static extractStats(runtime: GameRuntime): GameStats {
    const winner = runtime.winner ?? 'unknown';
    const factionMap = new Map<string, string>();

    for (const roleDef of runtime.definition.roles) {
      factionMap.set(roleDef.name, roleDef.faction);
    }

    const players: PlayerStats[] = runtime.seats.map((seat) => {
      const faction = factionMap.get(seat.role) ?? 'unknown';
      const won = faction === winner;

      return {
        actorId: seat.actorId,
        actorType: seat.actorType,
        role: seat.role,
        faction,
        survived: seat.alive,
        won,
      };
    });

    return {
      gameId: runtime.gameId,
      gameType: runtime.gameType,
      threadId: runtime.threadId,
      endedAt: runtime.updatedAt,
      winner,
      players,
    };
  }
}
