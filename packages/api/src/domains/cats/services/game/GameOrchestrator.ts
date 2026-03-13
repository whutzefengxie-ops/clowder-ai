/**
 * GameOrchestrator (F101)
 *
 * System-driven game lifecycle: start → tick → action → advance → end.
 * Coordinates GameEngine (logic) + GameStore (persistence) + Socket (broadcast).
 */

import type { GameAction, GameConfig, GameDefinition, GameRuntime, Seat } from '@cat-cafe/shared';
import type { IGameStore } from '../stores/ports/GameStore.js';
import { GameEngine } from './GameEngine.js';
import { GameViewBuilder } from './GameViewBuilder.js';

interface SocketLike {
  broadcastToRoom(room: string, event: string, data: unknown): void;
  emitToUser(userId: string, event: string, data: unknown): void;
}

export interface GameOrchestratorDeps {
  gameStore: IGameStore;
  socketManager: SocketLike;
}

export interface StartGameInput {
  threadId: string;
  definition: GameDefinition;
  seats: Seat[];
  config: GameConfig;
}

export class GameOrchestrator {
  private readonly store: IGameStore;
  private readonly socket: SocketLike;

  constructor(deps: GameOrchestratorDeps) {
    this.store = deps.gameStore;
    this.socket = deps.socketManager;
  }

  /** Create and persist a new game, broadcast to thread */
  async startGame(input: StartGameInput): Promise<GameRuntime> {
    const now = Date.now();
    const gameId = `game-${now}-${Math.random().toString(36).slice(2, 8)}`;

    const runtime: GameRuntime = {
      gameId,
      threadId: input.threadId,
      gameType: input.definition.gameType,
      definition: input.definition,
      seats: input.seats,
      currentPhase: input.definition.phases[0]?.name ?? 'lobby',
      round: 1,
      eventLog: [],
      pendingActions: {},
      status: 'playing',
      config: input.config,
      phaseStartedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.store.createGame(runtime);

    this.socket.broadcastToRoom(`thread:${input.threadId}`, 'game:started', {
      gameId: created.gameId,
      gameType: created.gameType,
      status: created.status,
      seats: created.seats.map((s) => ({ seatId: s.seatId, actorType: s.actorType, actorId: s.actorId })),
      timestamp: now,
    });

    return created;
  }

  /** Handle a player action submission */
  async handlePlayerAction(gameId: string, seatId: string, action: GameAction): Promise<void> {
    const runtime = await this.store.getGame(gameId);
    if (!runtime) throw new Error(`Game ${gameId} not found`);
    if (runtime.status !== 'playing') throw new Error('Game is not active');

    const engine = new GameEngine(runtime);
    engine.submitAction(seatId, action);

    if (engine.allActionsCollected()) {
      this.advancePhase(engine);
    }

    await this.store.updateGame(gameId, engine.getRuntime());
    await this.broadcastGameState(gameId);
  }

  /** System tick — check timeouts and advance if expired */
  async tick(gameId: string): Promise<void> {
    const runtime = await this.store.getGame(gameId);
    if (!runtime) return;
    if (runtime.status !== 'playing') return;

    const phaseDef = runtime.definition.phases.find((p) => p.name === runtime.currentPhase);
    if (!phaseDef) return;

    const phaseStart = runtime.phaseStartedAt ?? runtime.updatedAt;
    const elapsed = Date.now() - phaseStart;

    if (elapsed < phaseDef.timeoutMs) return; // not expired

    // Timeout — advance phase
    const engine = new GameEngine(runtime);
    engine.appendEvent({
      round: runtime.round,
      phase: runtime.currentPhase,
      type: 'timeout',
      scope: 'public',
      payload: { reason: 'phase_timeout' },
    });

    this.advancePhase(engine);
    await this.store.updateGame(gameId, engine.getRuntime());
    await this.broadcastGameState(gameId);
  }

  /** Broadcast scoped game state — per-seat views to each actor */
  async broadcastGameState(gameId: string): Promise<void> {
    const runtime = await this.store.getGame(gameId);
    if (!runtime) return;

    const now = Date.now();

    // Emit per-seat scoped views (information isolation at transport layer)
    for (const seat of runtime.seats) {
      const view = GameViewBuilder.buildView(runtime, seat.seatId as import('@cat-cafe/shared').SeatId);
      this.socket.emitToUser(seat.actorId, 'game:state_update', {
        gameId: runtime.gameId,
        view,
        timestamp: now,
      });
    }
  }

  // --- Private helpers ---

  private advancePhase(engine: GameEngine): void {
    const runtime = engine.getRuntime();
    const phases = runtime.definition.phases;
    const currentIdx = phases.findIndex((p) => p.name === runtime.currentPhase);

    engine.clearPendingActions();

    const nextIdx = currentIdx + 1;
    const targetPhase = nextIdx < phases.length ? phases[nextIdx] : phases[0];
    if (!targetPhase) return; // no phases defined

    const isNewRound = nextIdx >= phases.length;
    if (isNewRound) {
      runtime.round++;
    }

    const fromPhase = runtime.currentPhase;
    runtime.currentPhase = targetPhase.name;
    runtime.phaseStartedAt = Date.now();

    engine.appendEvent({
      round: runtime.round,
      phase: targetPhase.name,
      type: isNewRound ? 'round_start' : 'phase_start',
      scope: 'public',
      payload: isNewRound ? { round: runtime.round } : { from: fromPhase, to: targetPhase.name },
    });

    this.socket.broadcastToRoom(`thread:${runtime.threadId}`, 'game:phase_changed', {
      gameId: runtime.gameId,
      phase: targetPhase.name,
      round: runtime.round,
      timestamp: Date.now(),
    });
  }
}
