// Copy of backend/src/lib/scoreReplay.ts, tested there (scoreReplay.test.ts
// fails if this drifts from the marker line down). The tracker continues the
// server's score with the taps still queued on the device (6.8).

import { scoringTeam } from './scoringRules';

export interface ReplayEventItem {
  kind: 'event';
  id?: string; // absent on taps still queued on the device
  eventType: string;
  isOpponentEvent: boolean;
  at: Date;
}

export interface ReplayAdjustmentItem {
  kind: 'adjustment';
  id?: string;
  homeDelta: number;
  awayDelta: number;
  at: Date;
}

export type ReplayItem = ReplayEventItem | ReplayAdjustmentItem;

export interface ReplayResult {
  homeScore: number;
  awayScore: number;
  homeSetsWon: number;
  awaySetsWon: number;
  setScores: { set: number; home: number; away: number }[];
  completed: boolean;
  /** Ids of the items whose point closed a set (8.0.3): the completedSet marks. */
  closers: { events: string[]; adjustments: string[] };
  /** The set each item with an id was played in (9.0.5); items after the end keep the final set. */
  sets: { events: Map<string, number>; adjustments: Map<string, number> };
}

function setWinTarget(setNumber: number): number {
  return setNumber >= 5 ? 15 : 25;
}

function hasWonSet(score: number, opponentScore: number, setNumber: number): boolean {
  const target = setWinTarget(setNumber);
  return score >= target && score - opponentScore >= 2;
}

export type ReplayStart = Omit<ReplayResult, 'completed' | 'closers' | 'sets'>;

const ZERO: ReplayStart = { homeScore: 0, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0, setScores: [] };

/**
 * Replays a chronologically sorted timeline into the derived score state.
 * `start` continues from a known state instead of 0–0: the tracker's
 * provisional score is the server's state plus the taps still queued on the
 * device (6.8).
 */
export function replayTimeline(items: ReplayItem[], start: ReplayStart = ZERO): ReplayResult {
  let { homeScore, awayScore, homeSetsWon, awaySetsWon } = start;
  const setScores = [...start.setScores];
  const closers: ReplayResult['closers'] = { events: [], adjustments: [] };
  const sets: ReplayResult['sets'] = { events: new Map(), adjustments: new Map() };
  const setOf = (item: ReplayItem, set: number) => {
    if (item.id) (item.kind === 'event' ? sets.events : sets.adjustments).set(item.id, set);
  };
  let completed = homeSetsWon >= 3 || awaySetsWon >= 3;
  let i = 0;

  for (; !completed && i < items.length; i++) {
    const item = items[i];
    // Before the skips below, so non-scoring taps are numbered too.
    setOf(item, homeSetsWon + awaySetsWon + 1);
    if (item.kind === 'event') {
      const team = scoringTeam(item.eventType, item.isOpponentEvent);
      if (team === 'home') homeScore++;
      else if (team === 'away') awayScore++;
      else continue;
    } else {
      homeScore = Math.max(0, homeScore + item.homeDelta);
      awayScore = Math.max(0, awayScore + item.awayDelta);
      // A pure-zero adjustment changes nothing; skip set-completion checks.
      if (item.homeDelta === 0 && item.awayDelta === 0) continue;
    }

    const currentSet = homeSetsWon + awaySetsWon + 1;
    const homeWon = hasWonSet(homeScore, awayScore, currentSet);

    if (homeWon || hasWonSet(awayScore, homeScore, currentSet)) {
      setScores.push({ set: currentSet, home: homeScore, away: awayScore });
      if (homeWon) homeSetsWon++;
      else awaySetsWon++;
      homeScore = 0;
      awayScore = 0;
      if (item.id) (item.kind === 'event' ? closers.events : closers.adjustments).push(item.id);
    }

    if (homeSetsWon >= 3 || awaySetsWon >= 3) completed = true;
  }
  // Taps after the match ended score nothing; they belong to its last set.
  for (; i < items.length; i++) setOf(items[i], homeSetsWon + awaySetsWon);

  return { homeScore, awayScore, homeSetsWon, awaySetsWon, setScores, completed, closers, sets };
}

/** Merges event and adjustment streams into one chronologically sorted timeline. */
export function buildTimeline(
  events: { id?: string; eventType: string; isOpponentEvent: boolean; recordedAt: Date }[],
  adjustments: { id?: string; homeDelta: number; awayDelta: number; createdAt: Date }[],
): ReplayItem[] {
  const items: ReplayItem[] = [
    ...events.map((e): ReplayEventItem => ({
      kind: 'event', id: e.id, eventType: e.eventType, isOpponentEvent: e.isOpponentEvent, at: e.recordedAt,
    })),
    ...adjustments.map((a): ReplayAdjustmentItem => ({
      kind: 'adjustment', id: a.id, homeDelta: a.homeDelta, awayDelta: a.awayDelta, at: a.createdAt,
    })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}
