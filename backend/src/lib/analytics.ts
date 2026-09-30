import { EventType, Position } from '@prisma/client';

export interface AnalyticsEvent {
  eventType: EventType;
  playerId: string | null; // null for opponent events (isOpponentEvent=true)
  setNumber: number;
}

export interface AnalyticsPlayer {
  id: string;
  firstName: string;
  lastName: string;
  jerseyNumber: number;
  position: Position;
}

export interface StatLine {
  totalEvents: number;
  kills: number;
  attackErrors: number;
  attackAttempts: number;
  hittingPercentage: number | null;
  tips: number;
  freeBalls: number;
  aces: number;
  serviceErrors: number;
  serveAttempts: number;
  serveInPercentage: number | null;
  passAttempts: number;
  passingRating: number | null;
  soloBlocks: number;
  blockAssists: number;
  totalBlocks: number;
  blockErrors: number;
  digs: number;
  digErrors: number;
  assists: number;
  settingErrors: number;
}

export interface PlayerStatLine extends StatLine {
  player: AnalyticsPlayer;
}

function round(value: number, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function count(events: AnalyticsEvent[], eventType: EventType) {
  return events.reduce((total, event) => total + Number(event.eventType === eventType), 0);
}

/**
 * What counts as an attack attempt: TIP and FREE_BALL are non-scoring attack
 * actions, so they count. The match report uses this too (9.0.7), so its kill
 * rate matches the Advanced panel (lib/advancedMetrics.ts) and the court map.
 */
export const ATTACK_ATTEMPT_TYPES: readonly string[] = [
  EventType.KILL, EventType.ATTACK_ERROR, EventType.ATTACK_ATTEMPT, EventType.TIP, EventType.FREE_BALL,
];

export function calculateStats(events: AnalyticsEvent[]): StatLine {
  const kills = count(events, EventType.KILL);
  const attackErrors = count(events, EventType.ATTACK_ERROR);
  const attackAttempts = events.filter((e) => ATTACK_ATTEMPT_TYPES.includes(e.eventType)).length;
  const aces = count(events, EventType.ACE);
  const serviceErrors = count(events, EventType.SERVICE_ERROR);
  const serveAttempts = aces + serviceErrors + count(events, EventType.SERVE_IN);
  const pass3 = count(events, EventType.PASS_3);
  const pass2 = count(events, EventType.PASS_2);
  const pass1 = count(events, EventType.PASS_1);
  const pass0 = count(events, EventType.PASS_0);
  const passAttempts = pass3 + pass2 + pass1 + pass0;
  const soloBlocks = count(events, EventType.SOLO_BLOCK);
  const blockAssists = count(events, EventType.BLOCK_ASSIST);

  return {
    totalEvents: events.length,
    kills,
    attackErrors,
    attackAttempts,
    hittingPercentage:
      attackAttempts > 0 ? round((kills - attackErrors) / attackAttempts) : null,
    tips: count(events, EventType.TIP),
    freeBalls: count(events, EventType.FREE_BALL),
    aces,
    serviceErrors,
    serveAttempts,
    serveInPercentage:
      serveAttempts > 0 ? round((serveAttempts - serviceErrors) / serveAttempts) : null,
    passAttempts,
    passingRating:
      passAttempts > 0 ? round((pass3 * 3 + pass2 * 2 + pass1) / passAttempts, 2) : null,
    soloBlocks,
    blockAssists,
    totalBlocks: round(soloBlocks + blockAssists * 0.5, 1),
    blockErrors: count(events, EventType.BLOCK_ERROR),
    digs: count(events, EventType.DIG),
    digErrors: count(events, EventType.DIG_ERROR),
    assists: count(events, EventType.ASSIST),
    settingErrors: count(events, EventType.SETTING_ERROR),
  };
}

export function calculatePlayerStats(
  players: AnalyticsPlayer[],
  events: AnalyticsEvent[]
): PlayerStatLine[] {
  const ownEvents = events.filter((e): e is AnalyticsEvent & { playerId: string } => e.playerId != null);
  return players
    .map((player) => ({
      player,
      ...calculateStats(ownEvents.filter((event) => event.playerId === player.id)),
    }))
    .sort((a, b) => b.totalEvents - a.totalEvents || a.player.jerseyNumber - b.player.jerseyNumber);
}

export function calculateSetStats(events: AnalyticsEvent[]) {
  const setNumbers = [...new Set(events.map((event) => event.setNumber))].sort((a, b) => a - b);
  return setNumbers.map((setNumber) => ({
    setNumber,
    ...calculateStats(events.filter((event) => event.setNumber === setNumber)),
  }));
}
