// 8.0.1: every writer of a match's score state waits on the match row lock
// before it reads the score it is about to change, so two devices can't each
// compute from a copy the other is overwriting. Manual score changes can be
// sent as deltas, computed from the locked read. fakePrisma runs transactions
// on the same fake client, so only __integration__/scoreConcurrency.test.ts
// proves the lock itself.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { rawCallsMade } from '../testing/fakePrisma';
import { updateScore, resetSetScore, resetMatch } from '../controllers/matches';
import { deleteLastEvent, deleteEvent } from '../controllers/events';
import { applyUpdateMatch } from '../services/teamActions.service';
import { recalculateMatchState } from '../services/matchState.service';

const LOCK = /FROM "matches" WHERE "id" = \? FOR UPDATE/;

function assertLocked(what: string) {
  assert.equal(rawCallsMade().length, 1, `${what}: the match lock comes before this read`);
  assert.match(rawCallsMade()[0][0].join('?'), LOCK);
  assert.equal(rawCallsMade()[0][1], 'M');
}

/** A read that must only happen once the lock is held. */
const locked = <T>(what: string, fn: (...a: any[]) => T) => async (...a: any[]) => { assertLocked(what); return fn(...a); };

function world(score: Partial<{ homeScore: number; awayScore: number; manualScoreOverride: boolean }> = {}) {
  resetDb();
  const match: any = {
    id: 'M', teamId: 'T', homeScore: 0, awayScore: 0, homeSetsWon: 0, awaySetsWon: 0,
    setScores: [], status: 'IN_PROGRESS', manualScoreOverride: false, ...score,
  };
  db.match.findUnique = locked('match.findUnique', () => ({ ...match }));
  db.match.findUniqueOrThrow = locked('match.findUniqueOrThrow', () => ({ ...match }));
  db.match.update = async (args: any) => {
    for (const [k, v] of Object.entries(args.data)) if (v !== undefined) match[k] = v;
    return { ...match };
  };
  db.scoreAdjustment.create = async (args: any) => ({ id: 'adj', ...args.data });
  db.scoreAdjustment.update = async () => ({});
  db.scoreAdjustment.deleteMany = async () => ({ count: 0 });
  db.scoreAdjustment.delete = async () => ({});
  db.event.count = async () => 0;
  db.auditLog.create = async () => ({});
  db.event.delete = async () => ({});
  db.event.findMany = async () => [];
  db.scoreAdjustment.findMany = async () => [];
  db.event.updateMany = async () => ({ count: 0 });
  db.scoreAdjustment.updateMany = async () => ({ count: 0 });
  return match;
}

async function call(handler: any, req: { params: Record<string, string>; body?: any }) {
  let body: any;
  let status = 200;
  let error: any;
  const res: any = {
    status: (s: number) => { status = s; return res; },
    json: (b: any) => { body = b; return res; },
    send: () => res,
  };
  await handler({ query: {}, body: {}, user: { userId: 'coach' }, ...req } as any, res, (err: any) => { error = err; });
  return { body, status, error };
}

async function main() {
  // updateScore, absolute (installed apps): unchanged semantics, under the lock.
  {
    const m = world({ homeScore: 3 });
    const r = await call(updateScore, { params: { id: 'M' }, body: { homeScore: 5 } });
    assert.equal(r.error, undefined);
    assert.equal(m.homeScore, 5);
    assert.equal(callsFor('scoreAdjustment', 'create')[0][0].data.homeDelta, 2);
  }

  // updateScore, delta: computed from the locked read, never below 0.
  {
    const m = world({ homeScore: 7, awayScore: 4 });
    const r = await call(updateScore, { params: { id: 'M' }, body: { homeDelta: 1 } });
    assert.equal(r.error, undefined);
    assert.equal(m.homeScore, 8, 'a +1 lands as +1 on the current score, not on a stale copy');
    assert.equal(m.awayScore, 4, 'the other side is untouched');
    assert.equal(callsFor('scoreAdjustment', 'create')[0][0].data.homeDelta, 1);
    assert.equal(callsFor('scoreAdjustment', 'create')[0][0].data.awayDelta, 0);
  }
  {
    const m = world({ awayScore: 0 });
    const r = await call(updateScore, { params: { id: 'M' }, body: { awayDelta: -1 } });
    assert.equal(r.error, undefined);
    assert.equal(m.awayScore, 0, 'a -1 at 0 stays 0');
    assert.equal(callsFor('scoreAdjustment', 'create').length, 0, 'nothing changed, so nothing to record');
  }
  for (const body of [{ homeDelta: 1.5 }, { homeDelta: '1' }, { awayDelta: 101 }, { homeScore: 3, homeDelta: 1 }]) {
    world();
    const r = await call(updateScore, { params: { id: 'M' }, body });
    assert.equal(r.error?.statusCode, 400, `400 for ${JSON.stringify(body)}`);
  }

  // A set closed by a delta marks that adjustment, still under the lock.
  {
    const m = world({ homeScore: 24, awayScore: 10 });
    const r = await call(updateScore, { params: { id: 'M' }, body: { homeDelta: 1 } });
    assert.equal(m.homeSetsWon, 1);
    assert.deepEqual([r.body.homeScore, r.body.homeSetsWon], [0, 1], 'the response is the stored, completed state');
    assert.deepEqual(callsFor('scoreAdjustment', 'update')[0][0].data, { completedSet: true });
  }

  // Reset Set and Reset Match.
  {
    const m = world({ homeScore: 9, awayScore: 3 });
    const r = await call(resetSetScore, { params: { id: 'M' } });
    assert.equal(r.error, undefined);
    assert.equal(m.homeScore, 0);
    assert.equal(m.manualScoreOverride, true);
  }
  {
    const m = world({ homeScore: 9, awayScore: 3 });
    const r = await call(resetMatch, { params: { id: 'M' } });
    assert.equal(r.error, undefined);
    assert.equal(m.homeScore, 0);
    assert.equal(m.manualScoreOverride, true);
  }

  // Undo, adjustment branch: picks its target under the lock (was chosen
  // before any lock, in an array transaction).
  {
    const m = world({ homeScore: 6 });
    db.event.findFirst = locked('event.findFirst', () => null);
    db.scoreAdjustment.findFirst = locked('scoreAdjustment.findFirst', () =>
      ({ id: 'adj', homeDelta: 1, awayDelta: 0, createdAt: new Date(5), completedSet: false }));
    const r = await call(deleteLastEvent, { params: { matchId: 'M' } });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.body, { deleted: 'adj', kind: 'adjustment' });
    assert.equal(m.homeScore, 5);
  }

  // Undo, event branch: the event is re-read under the lock.
  {
    const m = world({ homeScore: 6 });
    db.event.findFirst = locked('event.findFirst', () =>
      ({ id: 'e1', matchId: 'M', eventType: 'KILL', isOpponentEvent: false, recordedAt: new Date(5), completedSet: false }));
    db.scoreAdjustment.findFirst = locked('scoreAdjustment.findFirst', () => null);
    db.event.findUnique = locked('event.findUnique', () =>
      ({ id: 'e1', matchId: 'M', eventType: 'KILL', isOpponentEvent: false, completedSet: false }));
    const r = await call(deleteLastEvent, { params: { matchId: 'M' } });
    assert.equal(r.error, undefined);
    assert.deepEqual(r.body, { deleted: 'e1', kind: 'event' });
    assert.equal(callsFor('event', 'delete')[0][0].where.id, 'e1');
    assert.equal(m.homeScore, 0, 'replayed from the (now empty) timeline');
  }

  // Delete by id: the match id is read first (it never changes), then the
  // event is re-read under the lock; its completedSet comes from that read.
  {
    const m = world({ manualScoreOverride: true, homeScore: 0, homeSetsWon: 1, setScores: [{ set: 1, home: 25, away: 20 }] } as any);
    let reads = 0;
    db.event.findUnique = async () => {
      if (reads++ === 0) return { matchId: 'M' };
      assertLocked('event re-read');
      return { id: 'e1', matchId: 'M', eventType: 'KILL', isOpponentEvent: false, completedSet: true };
    };
    const r = await call(deleteEvent, { params: { id: 'e1' } });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 204);
    assert.equal(reads, 2);
    assert.equal(m.homeSetsWon, 0, 'the locked read said this event closed the set');
    assert.equal(m.homeScore, 24);
  }
  {
    world();
    let reads = 0;
    db.event.findUnique = async () => (reads++ === 0 ? { matchId: 'M' } : null); // deleted meanwhile
    const r = await call(deleteEvent, { params: { id: 'e1' } });
    assert.equal(r.error?.statusCode, 404);
    assert.equal(callsFor('event', 'delete').length, 0);
  }

  // PATCH /matches/:id: status and setScores race the replay's writes of them.
  {
    world();
    db.match.update = async () => { assertLocked('status write'); return {}; };
    await applyUpdateMatch('M', { status: 'COMPLETED' });
    assert.equal(rawCallsMade().length, 1);
  }
  {
    world();
    db.match.update = async () => ({});
    await applyUpdateMatch('M', { opponent: 'Hawks' });
    assert.equal(rawCallsMade().length, 0, 'a name change needs no lock');
  }

  // 8.0.3: a replay moves the completedSet marks to the items that close
  // each set now, on events and adjustments, and clears the rest.
  {
    world();
    db.match.findUnique = async () => ({ status: 'IN_PROGRESS' }); // called directly here, not under a writer's lock
    const kills = Array.from({ length: 25 }, (_, i) => ({ id: `e${i + 1}`, eventType: 'KILL', isOpponentEvent: false, recordedAt: new Date(i * 1000) }));
    db.event.findMany = async () => kills;
    db.scoreAdjustment.findMany = async () => [{ id: 'a1', homeDelta: -1, awayDelta: 0, createdAt: new Date(30_000) }];
    await recalculateMatchState('M', db);
    const [clearEvents, setEvents] = callsFor('event', 'updateMany').map((c) => c[0]);
    assert.deepEqual(clearEvents, { where: { matchId: 'M', completedSet: true, id: { notIn: ['e25'] } }, data: { completedSet: false } });
    assert.deepEqual(setEvents, { where: { matchId: 'M', completedSet: false, id: { in: ['e25'] } }, data: { completedSet: true } });
    const [clearAdj, setAdj] = callsFor('scoreAdjustment', 'updateMany').map((c) => c[0]);
    assert.deepEqual(clearAdj.where.id, { notIn: [] }, 'an adjustment that closed nothing loses any old mark');
    assert.deepEqual(setAdj.where.id, { in: [] });
  }

  console.log('scoreWriterLocks: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
