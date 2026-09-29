// Pure score-replay engine shared by matchState.service and its tests.
//
// Rebuilds a match's score state from the full chronological timeline of
// scoring events AND manual score adjustments. Keeping adjustments in the
// timeline is what makes manual corrections survive undo/delete operations —
// recalculation no longer replays events alone.

import { scoringTeam } from './scoringRules';

export interface ReplayEventItem {
  kind: 'event';
  eventType: string;
  isOpponentEvent: boolean;
  at: Date;
}

export interface ReplayAdjustmentItem {
  kind: 'adjustment';
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
}

function setWinTarget(setNumber: number): number {
  return setNumber >= 5 ? 15 : 25;
}

function hasWonSet(score: number, opponentScore: number, setNumber: number): boolean {
  const target = setWinTarget(setNumber);
  return score >= target && score - opponentScore >= 2;
}

export type ReplayStart = Omit<ReplayResult, 'completed'>;

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
  let completed = homeSetsWon >= 3 || awaySetsWon >= 3;
  if (completed) return { homeScore, awayScore, homeSetsWon, awaySetsWon, setScores, completed };

  for (const item of items) {
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

    if (hasWonSet(homeScore, awayScore, currentSet)) {
      setScores.push({ set: currentSet, home: homeScore, away: awayScore });
      homeSetsWon++;
      homeScore = 0;
      awayScore = 0;
    } else if (hasWonSet(awayScore, homeScore, currentSet)) {
      setScores.push({ set: currentSet, home: homeScore, away: awayScore });
      awaySetsWon++;
      homeScore = 0;
      awayScore = 0;
    }

    if (homeSetsWon >= 3 || awaySetsWon >= 3) {
      completed = true;
      break;
    }
  }

  return { homeScore, awayScore, homeSetsWon, awaySetsWon, setScores, completed };
}

/** Merges event and adjustment streams into one chronologically sorted timeline. */
export function buildTimeline(
  events: { eventType: string; isOpponentEvent: boolean; recordedAt: Date }[],
  adjustments: { homeDelta: number; awayDelta: number; createdAt: Date }[],
): ReplayItem[] {
  const items: ReplayItem[] = [
    ...events.map((e): ReplayEventItem => ({
      kind: 'event', eventType: e.eventType, isOpponentEvent: e.isOpponentEvent, at: e.recordedAt,
    })),
    ...adjustments.map((a): ReplayAdjustmentItem => ({
      kind: 'adjustment', homeDelta: a.homeDelta, awayDelta: a.awayDelta, at: a.createdAt,
    })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}
