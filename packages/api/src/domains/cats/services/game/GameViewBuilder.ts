/**
 * GameViewBuilder (F101)
 *
 * Builds scoped GameView from GameRuntime for a specific viewer.
 * Handles role/faction visibility and event filtering.
 */

import type { EventScope, GameRuntime, GameView, SeatId, SeatView } from '@cat-cafe/shared';

export class GameViewBuilder {
  /** Build a scoped view for a specific viewer */
  static buildView(runtime: GameRuntime, viewer: SeatId | 'god'): GameView {
    const isGod = viewer === 'god';
    const viewerSeat = isGod ? undefined : runtime.seats.find((s) => s.seatId === viewer);
    // Dead players lose faction visibility (no faction leak after death)
    const viewerFaction = viewerSeat?.alive
      ? runtime.definition.roles.find((r) => r.name === viewerSeat.role)?.faction
      : undefined;

    // Filter events by visibility
    const visibleEvents = runtime.eventLog.filter(
      (e) => isGod || GameViewBuilder.isVisible(e.scope, viewer as SeatId, viewerFaction),
    );

    // Build seat views with role masking
    const seats: SeatView[] = runtime.seats.map((seat) => {
      const seatRole = runtime.definition.roles.find((r) => r.name === seat.role);
      const showRole =
        isGod ||
        seat.seatId === viewer || // always see own role
        (viewerFaction && seatRole?.faction === viewerFaction); // see faction mates

      const sv: SeatView = {
        seatId: seat.seatId,
        actorType: seat.actorType,
        actorId: seat.actorId,
        displayName: seat.actorId,
        alive: seat.alive,
      };
      if (showRole) {
        sv.role = seat.role;
        if (seatRole?.faction) sv.faction = seatRole.faction;
      }
      return sv;
    });

    const view: GameView = {
      gameId: runtime.gameId,
      threadId: runtime.threadId,
      gameType: runtime.gameType,
      status: runtime.status,
      currentPhase: runtime.currentPhase,
      round: runtime.round,
      seats,
      visibleEvents,
      config: {
        timeoutMs: runtime.config.timeoutMs,
        voiceMode: runtime.config.voiceMode,
        humanRole: runtime.config.humanRole,
        ...(runtime.config.humanSeat ? { humanSeat: runtime.config.humanSeat } : {}),
      },
    };
    if (runtime.winner) view.winner = runtime.winner;
    return view;
  }

  private static isVisible(scope: EventScope, viewer: SeatId, viewerFaction?: string): boolean {
    if (scope === 'public') return true;
    if (scope === 'god' || scope === 'judge') return false;
    if (scope === `seat:${viewer}`) return true;
    if (viewerFaction && scope === `faction:${viewerFaction}`) return true;
    return false;
  }
}
