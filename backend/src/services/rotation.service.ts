import { scoringTeam } from '../lib/scoringRules';
import { calculateSideOut } from '../lib/sideOut';

// Rotations (7.4): points won and lost in each of the six rotations. Fed our
// events AND the opponent's, scored with scoringTeam (an opponent kill is a
// point we lost). The old "efficiency" was the share of points won, so it's
// now called pointWinPct; real side-out % and break-point % come from the
// serving side (lib/sideOut.ts).

export interface RotationEvent {
  eventType: string;
  isOpponentEvent?: boolean;
  rotationNumber: number | null;
  servingSide?: 'US' | 'THEM' | null;
}

export interface RotationStat {
  rotation: number;
  won: number;
  lost: number;
  total: number;
  net: number;
  pointWinPct: number | null;
  sideOutPct: number | null;
  breakPointPct: number | null;
  receiveRallies: number;
  serveRallies: number;
}

export interface RotationInsights {
  best: RotationStat | null;
  worst: RotationStat | null;
  highestPointWin: RotationStat | null;
  lowestPointWin: RotationStat | null;
}

export interface RotationResult {
  rotations: RotationStat[];
  insights: RotationInsights;
  /** Points with a serving side, of all points in a rotation. */
  coverage: { withServingSide: number; totalPoints: number };
}

const inRange = (r: number | null): r is number => r != null && r >= 1 && r <= 6;

export function calculateRotations(events: RotationEvent[]): RotationResult {
  const counts: Record<number, { won: number; lost: number }> = {};
  for (let r = 1; r <= 6; r++) counts[r] = { won: 0, lost: 0 };

  const inRotation = events.filter((e) => inRange(e.rotationNumber));
  for (const e of inRotation) {
    const side = scoringTeam(e.eventType, e.isOpponentEvent ?? false);
    if (side === 'home') counts[e.rotationNumber!].won++;
    else if (side === 'away') counts[e.rotationNumber!].lost++;
  }

  const sideOut = calculateSideOut(inRotation.map((e) => ({
    eventType: e.eventType,
    isOpponentEvent: e.isOpponentEvent ?? false,
    servingSide: e.servingSide ?? null,
    rotationNumber: e.rotationNumber,
  })));

  const rotations: RotationStat[] = Object.entries(counts).map(([rot, { won, lost }]) => {
    const so = sideOut.byRotation[Number(rot) - 1];
    return {
      rotation: Number(rot),
      won,
      lost,
      total: won + lost,
      net: won - lost,
      pointWinPct: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
      sideOutPct: so.sideOutPct,
      breakPointPct: so.breakPointPct,
      receiveRallies: so.receiveRallies,
      serveRallies: so.serveRallies,
    };
  });

  const withData = rotations.filter((r) => r.total > 0);

  return {
    rotations,
    insights: {
      best: withData.length ? withData.reduce((a, b) => (b.net > a.net ? b : a)) : null,
      worst: withData.length ? withData.reduce((a, b) => (b.net < a.net ? b : a)) : null,
      highestPointWin: withData.length
        ? withData.reduce((a, b) => ((b.pointWinPct ?? -1) > (a.pointWinPct ?? -1) ? b : a))
        : null,
      lowestPointWin: withData.length
        ? withData.reduce((a, b) => ((b.pointWinPct ?? 101) < (a.pointWinPct ?? 101) ? b : a))
        : null,
    },
    coverage: sideOut.coverage,
  };
}
