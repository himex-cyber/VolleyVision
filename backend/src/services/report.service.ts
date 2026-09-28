import { HOME_POINT_SET, AWAY_POINT_SET, scoringTeam } from '../lib/scoringRules';
import { selectTopPerformer, PerformerPlayer, PerformerEvent } from './performer.service';
import { calculateMomentum, MomentumEvent } from './momentum.service';
import { calculateRotations, RotationEvent } from './rotation.service';

export interface ReportEvent {
  eventType: string;
  setNumber: number;
  courtZone: number | null;
  rotationNumber: number | null;
  playerId: string | null; // null for opponent events
  recordedAt: Date;
}

export interface ReportMatch {
  teamName: string;
  opponent: string;
  homeSetsWon: number;
  awaySetsWon: number;
  setScores: unknown;
}

export interface MatchReportData {
  generatedAt: string;
  result: {
    teamName: string;
    opponent: string;
    homeSetsWon: number;
    awaySetsWon: number;
    winner: 'home' | 'away' | 'in_progress';
    resultText: string;
    setScores: { set: number; home: number; away: number }[];
  };
  topPerformer: ReturnType<typeof selectTopPerformer>;
  momentum: {
    longestRun: number;
    longestRunTeam: string;
    leadChanges: number;
    largestHomeLead: number;
    largestAwayLead: number;
  } | null;
  attack: {
    killRate: number | null;
    hittingPct: number | null;
    kills: number;
    errors: number;
    attempts: number;
  };
  serve: { aceRate: number | null; aces: number; attempts: number };
  heatMapHighlight: string | null;
  bestRotation: {
    rotation: number;
    won: number;
    lost: number;
    net: number;
    efficiency: number | null;
  } | null;
}

export function generateMatchReport(
  match: ReportMatch,
  events: ReportEvent[],
  players: PerformerPlayer[],
): MatchReportData {
  const { teamName, opponent, homeSetsWon, awaySetsWon } = match;

  // ── Result ──────────────────────────────────────────────────────────────
  const winner: 'home' | 'away' | 'in_progress' =
    homeSetsWon >= 3 ? 'home' : awaySetsWon >= 3 ? 'away' : 'in_progress';
  const resultText =
    winner === 'home'
      ? `${teamName} defeated ${opponent} ${homeSetsWon}–${awaySetsWon}`
      : winner === 'away'
      ? `${opponent} defeated ${teamName} ${awaySetsWon}–${homeSetsWon}`
      : `${teamName} vs ${opponent} — Match in progress`;
  const setScores = Array.isArray(match.setScores)
    ? (match.setScores as { set: number; home: number; away: number }[])
    : [];

  // ── Top Performer ───────────────────────────────────────────────────────
  const topPerformer = selectTopPerformer(players, events as PerformerEvent[]);

  // ── Momentum ────────────────────────────────────────────────────────────
  const momentumResult = calculateMomentum(events as MomentumEvent[]);
  const { stats: mStats } = momentumResult;
  const momentumSummary =
    mStats.totalPoints > 0
      ? {
          longestRun: mStats.longestRun,
          longestRunTeam:
            mStats.longestHomeRun >= mStats.longestAwayRun ? teamName : opponent,
          leadChanges: mStats.leadChanges,
          largestHomeLead: mStats.largestHomeLead,
          largestAwayLead: mStats.largestAwayLead,
        }
      : null;

  // ── Attack Insights ──────────────────────────────────────────────────────
  const attackEvents = events.filter((e) =>
    ['KILL', 'ATTACK_ERROR', 'ATTACK_ATTEMPT'].includes(e.eventType),
  );
  const kills = attackEvents.filter((e) => e.eventType === 'KILL').length;
  const attackErrors = attackEvents.filter((e) => e.eventType === 'ATTACK_ERROR').length;
  const killRate =
    attackEvents.length > 0
      ? Math.round((kills / attackEvents.length) * 1000) / 10
      : null;
  const hittingPct =
    attackEvents.length > 0
      ? Math.round(((kills - attackErrors) / attackEvents.length) * 1000) / 1000
      : null;

  // ── Serve Insights ───────────────────────────────────────────────────────
  const serveEvents = events.filter((e) =>
    ['ACE', 'SERVICE_ERROR', 'SERVE_IN'].includes(e.eventType),
  );
  const aces = serveEvents.filter((e) => e.eventType === 'ACE').length;
  const aceRate =
    serveEvents.length > 0
      ? Math.round((aces / serveEvents.length) * 1000) / 10
      : null;

  // ── Heat Map Highlight ───────────────────────────────────────────────────
  // Counted like the court map it links to (lib/heatmap.ts): tips and free
  // balls are attack attempts there too, so the two agree.
  const zoneAttackEvents = events.filter((e) =>
    ['KILL', 'ATTACK_ERROR', 'ATTACK_ATTEMPT', 'TIP', 'FREE_BALL'].includes(e.eventType),
  );
  const zoneCounts: Record<number, number> = {};
  for (const e of zoneAttackEvents) {
    if (e.courtZone != null && e.courtZone >= 1 && e.courtZone <= 6) {
      zoneCounts[e.courtZone] = (zoneCounts[e.courtZone] ?? 0) + 1;
    }
  }
  const zoneEntries = Object.entries(zoneCounts).map(([z, n]) => ({
    zone: Number(z),
    count: n,
  }));
  const totalZoneAttacks = zoneEntries.reduce((s, z) => s + z.count, 0);
  const topZone = zoneEntries.length
    ? zoneEntries.reduce((a, b) => (b.count > a.count ? b : a))
    : null;
  const heatMapHighlight =
    topZone && totalZoneAttacks > 0
      ? `${Math.round((topZone.count / totalZoneAttacks) * 100)}% of attacks originated from Zone ${topZone.zone}`
      : null;

  // ── Best Rotation ────────────────────────────────────────────────────────
  const rotResult = calculateRotations(events as RotationEvent[]);
  const withData = rotResult.rotations.filter((r) => r.total > 0);
  const bestRotation = withData.length
    ? withData.reduce((a, b) => (b.net > a.net ? b : a))
    : null;

  return {
    generatedAt: new Date().toISOString(),
    result: { teamName, opponent, homeSetsWon, awaySetsWon, winner, resultText, setScores },
    topPerformer,
    momentum: momentumSummary,
    attack: { killRate, hittingPct, kills, errors: attackErrors, attempts: attackEvents.length },
    serve: { aceRate, aces, attempts: serveEvents.length },
    heatMapHighlight,
    bestRotation,
  };
}
