import { scoringTeam } from '../lib/scoringRules';

// Momentum (7.5): the point-by-point flow of a match, set by set. Fed our events
// AND the opponent's (an opponent kill is their point, an opponent error ours),
// scored with scoringTeam. Score, lead and runs reset at each set: a run never
// crosses a set boundary.

export interface MomentumEvent {
  eventType: string;
  isOpponentEvent?: boolean;
  setNumber: number;
  recordedAt: Date;
}

export interface MomentumPoint {
  pointNumber: number;
  /** 1-based position within its set. */
  pointInSet: number;
  scorer: 'home' | 'away';
  homeScore: number;
  awayScore: number;
  lead: number;
  setNumber: number;
  runLength: number;
}

export interface MomentumStats {
  totalPoints: number;
  longestHomeRun: number;
  longestAwayRun: number;
  longestRun: number;
  leadChanges: number;
  largestHomeLead: number;
  largestAwayLead: number;
}

export interface SetMomentum extends MomentumStats {
  setNumber: number;
  homeScore: number;
  awayScore: number;
}

export interface SignificantRun {
  team: 'home' | 'away';
  length: number;
  startPoint: number;
  setNumber: number;
}

export interface MomentumResult {
  timeline: MomentumPoint[];
  /** Match-level: runs and leads are the max over the sets, lead changes the sum. */
  stats: MomentumStats;
  sets: SetMomentum[];
  significantRuns: SignificantRun[];
}

export function calculateMomentum(events: MomentumEvent[]): MomentumResult {
  // Sort here, not by the caller: by set, then the order points happened. A
  // set's taps can interleave with another's in time (the tracker jumped back
  // to fix a set), and each set must still be one run of points. Stable, so
  // equal timestamps keep their given order.
  const points = events
    .map((e) => ({ e, scorer: scoringTeam(e.eventType, e.isOpponentEvent ?? false) }))
    .filter((p): p is { e: MomentumEvent; scorer: 'home' | 'away' } => p.scorer !== null)
    .sort((a, b) => a.e.setNumber - b.e.setNumber || a.e.recordedAt.getTime() - b.e.recordedAt.getTime());

  const timeline: MomentumPoint[] = [];
  const sets: SetMomentum[] = [];
  let set: SetMomentum | null = null;
  let runTeam: 'home' | 'away' | null = null;
  let runLength = 0;
  let prevLead = 0;

  for (const { e, scorer } of points) {
    if (!set || set.setNumber !== e.setNumber) {
      set = { setNumber: e.setNumber, homeScore: 0, awayScore: 0, totalPoints: 0, longestHomeRun: 0, longestAwayRun: 0,
              longestRun: 0, leadChanges: 0, largestHomeLead: 0, largestAwayLead: 0 };
      sets.push(set);
      runTeam = null;
      runLength = 0;
      prevLead = 0;
    }

    if (scorer === 'home') set.homeScore++;
    else set.awayScore++;
    set.totalPoints++;

    runLength = scorer === runTeam ? runLength + 1 : 1;
    runTeam = scorer;
    if (scorer === 'home') set.longestHomeRun = Math.max(set.longestHomeRun, runLength);
    else set.longestAwayRun = Math.max(set.longestAwayRun, runLength);
    set.longestRun = Math.max(set.longestHomeRun, set.longestAwayRun);

    const lead = set.homeScore - set.awayScore;
    if (prevLead !== 0 && lead !== 0 && Math.sign(lead) !== Math.sign(prevLead)) set.leadChanges++;
    if (lead !== 0) prevLead = lead;
    set.largestHomeLead = Math.max(set.largestHomeLead, lead);
    set.largestAwayLead = Math.max(set.largestAwayLead, -lead);

    timeline.push({
      pointNumber: timeline.length + 1,
      pointInSet: set.totalPoints,
      scorer,
      homeScore: set.homeScore,
      awayScore: set.awayScore,
      lead,
      setNumber: e.setNumber,
      runLength,
    });
  }

  // Significant runs (3+ in a row), each within one set.
  const runs: SignificantRun[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const p = timeline[i];
    const next = timeline[i + 1];
    const runEnds = !next || next.setNumber !== p.setNumber || next.scorer !== p.scorer;
    if (runEnds && p.runLength >= 3) {
      runs.push({ team: p.scorer, length: p.runLength, startPoint: p.pointNumber - p.runLength + 1, setNumber: p.setNumber });
    }
  }

  const max = (f: (s: SetMomentum) => number) => sets.reduce((m, s) => Math.max(m, f(s)), 0);
  return {
    timeline,
    stats: {
      totalPoints: timeline.length,
      longestHomeRun: max((s) => s.longestHomeRun),
      longestAwayRun: max((s) => s.longestAwayRun),
      longestRun: max((s) => s.longestRun),
      leadChanges: sets.reduce((n, s) => n + s.leadChanges, 0),
      largestHomeLead: max((s) => s.largestHomeLead),
      largestAwayLead: max((s) => s.largestAwayLead),
    },
    sets,
    // Uncapped: at most five sets, and the chart lists each set's own runs.
    significantRuns: runs,
  };
}
