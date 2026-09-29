// Side-out % and break-point % (7.6): how often we win the rally when they
// serve (a side-out) and when we serve (a break point). Needs the serving side,
// which the tracker records from v9.12.0 (Serving: Us / Them); points without
// it (older apps, manual score taps) are left out and reported as coverage.
import { scoringTeam } from './scoringRules';

export interface PointEvent {
  eventType: string;
  isOpponentEvent: boolean;
  servingSide: 'US' | 'THEM' | null;
  rotationNumber: number | null;
}

export interface SideOutLine {
  sideOutPct: number | null;
  breakPointPct: number | null;
  receiveRallies: number;
  serveRallies: number;
  sideOuts: number;
  breakPoints: number;
}

export interface SideOutResult extends SideOutLine {
  byRotation: (SideOutLine & { rotation: number })[];
  coverage: { withServingSide: number; totalPoints: number };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function line(receiveRallies: number, sideOuts: number, serveRallies: number, breakPoints: number): SideOutLine {
  return {
    sideOutPct: pct(sideOuts, receiveRallies),
    breakPointPct: pct(breakPoints, serveRallies),
    receiveRallies, serveRallies, sideOuts, breakPoints,
  };
}

/** Events in any order: each point stands alone, given who served it. */
export function calculateSideOut(events: PointEvent[]): SideOutResult {
  const total = { receive: 0, sideOuts: 0, serve: 0, breaks: 0 };
  const rot = Array.from({ length: 7 }, () => ({ receive: 0, sideOuts: 0, serve: 0, breaks: 0 }));
  let totalPoints = 0;
  let withServingSide = 0;

  for (const e of events) {
    const winner = scoringTeam(e.eventType, e.isOpponentEvent);
    if (!winner) continue;
    totalPoints++;
    if (!e.servingSide) continue;
    withServingSide++;
    const won = winner === 'home';
    const buckets = e.rotationNumber != null && e.rotationNumber >= 1 && e.rotationNumber <= 6
      ? [total, rot[e.rotationNumber]]
      : [total];
    for (const b of buckets) {
      if (e.servingSide === 'THEM') { b.receive++; if (won) b.sideOuts++; }
      else { b.serve++; if (won) b.breaks++; }
    }
  }

  return {
    ...line(total.receive, total.sideOuts, total.serve, total.breaks),
    byRotation: [1, 2, 3, 4, 5, 6].map((n) => ({ rotation: n, ...line(rot[n].receive, rot[n].sideOuts, rot[n].serve, rot[n].breaks) })),
    coverage: { withServingSide, totalPoints },
  };
}
