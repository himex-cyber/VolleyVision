// Advanced team metrics (7.7), ported from buildAdvancedMetrics at tag
// pre-feature-removal. Two inputs, because they measure different things:
//   - ownEvents (ownEventsOnly): our players' actions (serve, attack, pass,
//     block). An opponent's kill must never count as ours.
//   - pointEvents (teamEventsWithOpponent): every point, for side-out and
//     break-point.
// The old "sideOut" block was really pass quality, so it's receptionQuality.
import { calculateSideOut } from './sideOut';
import type { PointEvent } from './sideOut';

const pct1 = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function buildAdvancedMetrics(
  ownEvents: { eventType: string; setNumber: number; matchId?: string | null }[],
  pointEvents: PointEvent[],
) {
  const counts: Record<string, number> = {};
  for (const e of ownEvents) counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
  const c = (key: string) => counts[key] ?? 0;

  const passAttempts = c('PASS_3') + c('PASS_2') + c('PASS_1') + c('PASS_0');
  const qualityPasses = c('PASS_3') + c('PASS_2');

  const serveAttempts = c('ACE') + c('SERVICE_ERROR') + c('SERVE_IN');

  const attackAttempts = c('KILL') + c('ATTACK_ERROR') + c('ATTACK_ATTEMPT') + c('TIP') + c('FREE_BALL');
  const hittingPct = attackAttempts > 0
    ? Math.round(((c('KILL') - c('ATTACK_ERROR')) / attackAttempts) * 1000) / 1000 : null;

  const soloBlocks = c('SOLO_BLOCK');
  const blockAssists = c('BLOCK_ASSIST');
  const totalBlocks = soloBlocks + blockAssists * 0.5;
  // A set is a set of one match: across a team's matches, set 1 of each counts.
  const setsPlayed = new Set(ownEvents.map((e) => `${e.matchId ?? ''}:${e.setNumber}`)).size;

  const so = calculateSideOut(pointEvents);

  return {
    /** Serve receive quality: passes graded 2 or 3. */
    receptionQuality: {
      attempts: passAttempts, qualityPasses, qualityPct: pct1(qualityPasses, passAttempts),
      perfectPassRate: pct1(c('PASS_3'), passAttempts),
      pass3: c('PASS_3'), pass2: c('PASS_2'), pass1: c('PASS_1'), pass0: c('PASS_0'),
    },
    serve: {
      attempts: serveAttempts, aces: c('ACE'), errors: c('SERVICE_ERROR'),
      aceRate: pct1(c('ACE'), serveAttempts), errorRate: pct1(c('SERVICE_ERROR'), serveAttempts),
      positiveRate: pct1(c('ACE') + c('SERVE_IN'), serveAttempts),
    },
    attack: { attempts: attackAttempts, kills: c('KILL'), errors: c('ATTACK_ERROR'), killRate: pct1(c('KILL'), attackAttempts), hittingPct },
    blocking: {
      soloBlocks, blockAssists, totalBlocks,
      blocksPerSet: setsPlayed > 0 ? Math.round((totalBlocks / setsPlayed) * 100) / 100 : null,
    },
    setsPlayed,
    sideOut: {
      sideOutPct: so.sideOutPct, breakPointPct: so.breakPointPct,
      receiveRallies: so.receiveRallies, serveRallies: so.serveRallies, coverage: so.coverage,
    },
  };
}

export type AdvancedMetrics = ReturnType<typeof buildAdvancedMetrics>;
