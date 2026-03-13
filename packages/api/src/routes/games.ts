/**
 * Game API Routes (F101)
 *
 * CRUD for game lifecycle within a thread.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GameOrchestrator } from '../domains/cats/services/game/GameOrchestrator.js';
import { GameViewBuilder } from '../domains/cats/services/game/GameViewBuilder.js';
import type { IGameStore } from '../domains/cats/services/stores/ports/GameStore.js';

interface SocketLike {
  broadcastToRoom(room: string, event: string, data: unknown): void;
  emitToUser(userId: string, event: string, data: unknown): void;
}

export interface GameRoutesOptions {
  gameStore: IGameStore;
  socketManager: SocketLike;
}

const seatSchema = z.object({
  seatId: z.string().regex(/^P\d+$/),
  actorType: z.enum(['human', 'cat', 'system']),
  actorId: z.string().min(1),
  role: z.string().min(1),
  alive: z.boolean(),
  properties: z.record(z.unknown()).default({}),
});

const roleSchema = z.object({
  name: z.string().min(1),
  faction: z.string().min(1),
  description: z.string(),
  nightActionPhase: z.string().optional(),
});

const phaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['night_action', 'day_discuss', 'day_vote', 'resolve', 'announce']),
  actingRole: z.string().optional(),
  timeoutMs: z.number().int().positive(),
  autoAdvance: z.boolean(),
});

const actionDefSchema = z.object({
  name: z.string().min(1),
  allowedRole: z.string().min(1),
  allowedPhase: z.string().min(1),
  targetRequired: z.boolean(),
  schema: z.record(z.unknown()).default({}),
});

const definitionSchema = z.object({
  gameType: z.string().min(1),
  displayName: z.string().min(1),
  minPlayers: z.number().int().positive(),
  maxPlayers: z.number().int().positive(),
  roles: z.array(roleSchema),
  phases: z.array(phaseSchema).min(1),
  actions: z.array(actionDefSchema),
  winConditions: z.array(
    z.object({
      faction: z.string(),
      description: z.string(),
      check: z.string(),
    }),
  ),
});

const startGameSchema = z.object({
  definition: definitionSchema,
  seats: z.array(seatSchema).min(1),
  config: z
    .object({
      timeoutMs: z.number().int().positive(),
      voiceMode: z.boolean(),
      humanRole: z.enum(['player', 'god-view']),
      humanSeat: z
        .string()
        .regex(/^P\d+$/)
        .optional(),
    })
    .refine((c) => c.humanRole !== 'player' || c.humanSeat, {
      message: 'humanSeat is required when humanRole is player',
    }),
});

const actionSchema = z.object({
  seatId: z.string().regex(/^P\d+$/),
  actionName: z.string().min(1),
  targetSeat: z
    .string()
    .regex(/^P\d+$/)
    .optional(),
  params: z.record(z.unknown()).optional(),
});

export const gameRoutes: FastifyPluginAsync<GameRoutesOptions> = async (app, opts) => {
  const { gameStore, socketManager } = opts;
  const orchestrator = new GameOrchestrator({ gameStore, socketManager });

  // POST /api/threads/:threadId/game — Start a game
  app.post<{ Params: { threadId: string } }>('/api/threads/:threadId/game', async (request, reply) => {
    const parseResult = startGameSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parseResult.error.issues };
    }

    const { threadId } = request.params;
    const { definition, seats, config } = parseResult.data;

    try {
      const runtime = await orchestrator.startGame({
        threadId,
        definition: definition as Parameters<typeof orchestrator.startGame>[0]['definition'],
        seats: seats as Parameters<typeof orchestrator.startGame>[0]['seats'],
        config: config as Parameters<typeof orchestrator.startGame>[0]['config'],
      });
      return runtime;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already has an active game')) {
        reply.status(409);
        return { error: message };
      }
      reply.status(500);
      return { error: message };
    }
  });

  // GET /api/threads/:threadId/game?viewer=P2 — Get scoped game view
  app.get<{ Params: { threadId: string }; Querystring: { viewer?: string } }>(
    '/api/threads/:threadId/game',
    async (request, reply) => {
      const { threadId } = request.params;
      const runtime = await gameStore.getActiveGame(threadId);
      if (!runtime) {
        reply.status(404);
        return { error: 'No active game in this thread' };
      }

      const requestedViewer = (request.query as { viewer?: string }).viewer;

      // Determine effective viewer based on humanRole
      let viewer: string;
      if (runtime.config.humanRole === 'god-view') {
        // God-view mode: allow god or any seat
        viewer = requestedViewer ?? 'god';
      } else {
        // Player mode: lock to humanSeat, reject god/other-seat requests
        const humanSeat = runtime.config.humanSeat;
        if (!humanSeat) {
          reply.status(400);
          return { error: 'player mode requires humanSeat in game config' };
        }
        if (requestedViewer && requestedViewer !== humanSeat) {
          reply.status(403);
          return { error: `viewer must be your own seat (${humanSeat})` };
        }
        viewer = humanSeat;
      }

      const view = GameViewBuilder.buildView(runtime, viewer as import('@cat-cafe/shared').SeatId | 'god');
      return view;
    },
  );

  // POST /api/threads/:threadId/game/action — Submit player action
  app.post<{ Params: { threadId: string } }>('/api/threads/:threadId/game/action', async (request, reply) => {
    const parseResult = actionSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid action', details: parseResult.error.issues };
    }

    const { threadId } = request.params;
    const runtime = await gameStore.getActiveGame(threadId);
    if (!runtime) {
      reply.status(404);
      return { error: 'No active game in this thread' };
    }

    // God-view cannot submit actions
    if (runtime.config.humanRole === 'god-view') {
      reply.status(403);
      return { error: 'god-view mode: actions are not allowed' };
    }

    const { seatId, actionName, targetSeat, params } = parseResult.data;

    // Bind seatId to humanSeat — prevent impersonating other seats
    if (runtime.config.humanSeat && seatId !== runtime.config.humanSeat) {
      reply.status(403);
      return { error: `seat mismatch: you are assigned to ${runtime.config.humanSeat}, not ${seatId}` };
    }

    try {
      const action: import('@cat-cafe/shared').GameAction = {
        seatId: seatId as `P${number}`,
        actionName,
        submittedAt: Date.now(),
      };
      if (targetSeat) action.targetSeat = targetSeat as `P${number}`;
      if (params) action.params = params;
      await orchestrator.handlePlayerAction(runtime.gameId, seatId, action);
      return { ok: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reply.status(400);
      return { error: message };
    }
  });

  // DELETE /api/threads/:threadId/game — Abort game
  app.delete<{ Params: { threadId: string } }>('/api/threads/:threadId/game', async (request, reply) => {
    const { threadId } = request.params;
    const runtime = await gameStore.getActiveGame(threadId);
    if (!runtime) {
      reply.status(404);
      return { error: 'No active game in this thread' };
    }

    await gameStore.endGame(runtime.gameId, 'aborted');

    socketManager.broadcastToRoom(`thread:${threadId}`, 'game:aborted', {
      gameId: runtime.gameId,
      timestamp: Date.now(),
    });

    return { ok: true, gameId: runtime.gameId };
  });
};
