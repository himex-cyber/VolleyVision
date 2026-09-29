// 6.3 recordOneEvent over a stateful fake: idempotency, order-aware scoring and
// the manual-override rule. fakePrisma runs the transaction on the same fake
// client, so the tx wiring itself is proven only by
// __integration__/offlineReplay.test.ts.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { rawCallsMade } from '../testing/fakePrisma';
import { recordOneEvent } from '../services/eventRecording.service';
import { parseEventInput } from '../lib/eventInput';

const CREATED = new Date(Date.now() - 60 * 60_000); // an hour ago, so every at(n) is in the past
const at = (min: number) => new Date(CREATED.getTime() + min * 60_000).toISOString();

function world(opts: { manualScoreOverride?: boolean; latestAdjustmentAt?: string; status?: string } = {}) {
  resetDb();
  const rows: any[] = [];
  const match = { homeScore: 0, awayScore: 0 };
  db.match.findUnique = async () => ({
    teamId: 'T', createdAt: CREATED, manualScoreOverride: !!opts.manualScoreOverride,
    status: opts.status ?? 'IN_PROGRESS', homeScore: match.homeScore, awayScore: match.awayScore,
    homeSetsWon: 0, awaySetsWon: 0, setScores: [],
  });
  db.player.findFirst = async () => ({ id: 'p1' });
  db.event.findUnique = async (args: any) =>
    rows.find((r) => r.matchId === args.where.matchId_clientKey.matchId && r.clientKey === args.where.matchId_clientKey.clientKey) ?? null;
  db.event.findFirst = async () =>
    rows.length ? { recordedAt: rows.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a)).recordedAt } : null;
  db.scoreAdjustment.findFirst = async () => (opts.latestAdjustmentAt ? { createdAt: new Date(opts.latestAdjustmentAt) } : null);
  db.event.create = async (args: any) => {
    if (args.data.clientKey && rows.some((r) => r.clientKey === args.data.clientKey)) {
      throw Object.assign(new Error('Unique'), { code: 'P2002' });
    }
    const row = { id: `e${rows.length + 1}`, completedSet: false, player: null, ...args.data };
    rows.push(row);
    return row;
  };
  db.match.update = async (args: any) => {
    if (args.data.homeScore?.increment) match.homeScore += 1;
    if (args.data.awayScore?.increment) match.awayScore += 1;
    return {};
  };
  // recalculateMatchState reads these.
  db.event.findMany = async () => rows.map((r) => ({ eventType: r.eventType, isOpponentEvent: r.isOpponentEvent, recordedAt: r.recordedAt }));
  db.scoreAdjustment.findMany = async () => [];
  db.event.updateMany = async () => ({ count: 0 });
  db.scoreAdjustment.updateMany = async () => ({ count: 0 });
  return { rows, match };
}

const kill = (key: string | null, recordedAt?: string) =>
  recordOneEvent(parseEventInput({ matchId: 'm1', playerId: 'p1', eventType: 'KILL', setNumber: 1, recordedAt }), key);
const increments = () => callsFor('match', 'update').filter((c) => c[0].data.homeScore?.increment || c[0].data.awayScore?.increment).length;

async function main() {
  // Same key twice: one row, one point; the second is a duplicate.
  {
    const w = world();
    const first = await kill('k1', at(1));
    const second = await kill('k1', at(1));
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.event.id, first.event.id);
    assert.equal(w.rows.length, 1);
    assert.equal(increments(), 1, 'a resend never scores twice');
    assert.equal(w.rows[0].clientKey, 'k1');
    assert.equal(w.rows[0].recordedAt.toISOString(), at(1), 'the accepted client time is stored');
  }

  // A concurrent resend that loses on the unique index is re-read as a duplicate.
  {
    const w = world();
    await kill('k1', at(1));
    let lookups = 0;
    // The race: the first lookup doesn't see the other request's row yet.
    db.event.findUnique = async (args: any) =>
      (lookups++ === 0 ? null : w.rows.find((r) => r.clientKey === args.where.matchId_clientKey.clientKey) ?? null);
    const again = await kill('k1', at(1));
    assert.equal(again.duplicate, true);
    assert.equal(w.rows.length, 1);
    assert.equal(increments(), 1);
  }

  // In order: increment. Out of order: replay instead of increment.
  {
    const w = world();
    await kill('a', at(5));
    assert.equal(increments(), 1);
    assert.equal(callsFor('event', 'findMany').length, 0, 'in order never replays');
    await kill('b', at(3)); // made earlier, synced later
    assert.equal(increments(), 1, 'an out-of-order point is not simply added');
    assert.equal(callsFor('event', 'findMany').length, 1, 'the match was replayed');
    assert.equal(w.rows.length, 2);
  }

  // A tie with the latest adjustment is out of order (events sort first).
  {
    world({ latestAdjustmentAt: at(4) });
    await kill('a', at(4));
    assert.equal(increments(), 0);
    assert.equal(callsFor('event', 'findMany').length, 1);
  }

  // Manual override: out-of-order points only increment (no replay can
  // reproduce authored set boundaries).
  {
    world({ manualScoreOverride: true });
    await kill('a', at(5));
    await kill('b', at(3));
    assert.equal(increments(), 2);
    assert.equal(callsFor('event', 'findMany').length, 0, 'never replays under override');
  }

  // Every write takes the match row lock first (writers on a match wait their
  // turn instead of aborting each other).
  {
    world();
    await kill('a', at(1));
    assert.equal(rawCallsMade().length, 1);
    assert.match(rawCallsMade()[0][0].join('?'), /FROM "matches" WHERE "id" = \? FOR UPDATE/);
    assert.equal(rawCallsMade()[0][1], 'm1');
  }

  // Under manual override the client's time is ignored: points apply in
  // arrival order, so undo's "last" must be the last one applied.
  {
    const w = world({ manualScoreOverride: true });
    await kill('a', at(3));
    assert.ok(Math.abs(w.rows[0].recordedAt.getTime() - Date.now()) < 5000);
  }

  // A resend of a saved tap stays a duplicate even if the player has been
  // unlinked since (the key is checked before the player).
  {
    const w = world();
    await kill('k1', at(1));
    db.player.findFirst = async () => null;
    const again = await kill('k1', at(1));
    assert.equal(again.duplicate, true);
    assert.equal(w.rows.length, 1);
    await assert.rejects(kill('k2', at(2)), /does not belong/, 'a new tap for an unlinked player is refused');
  }

  // A finished match keeps a late tap but not its point.
  {
    const w = world({ status: 'COMPLETED' });
    await kill('late', at(1));
    assert.equal(w.rows.length, 1, 'the stat is kept');
    assert.equal(increments(), 0, 'no point after match point');
    assert.equal(callsFor('event', 'findMany').length, 0, 'no replay either');
    assert.ok(Math.abs(w.rows[0].recordedAt.getTime() - Date.now()) < 5000, 'stamped after match point, so a replay ignores it');
  }

  // Old apps: no key, no time. Server time, in order, as before.
  {
    const w = world();
    const r = await kill(null);
    assert.equal(r.duplicate, false);
    assert.equal(w.rows[0].clientKey, null);
    assert.ok(Math.abs(w.rows[0].recordedAt.getTime() - Date.now()) < 5000, 'server time');
    assert.equal(callsFor('event', 'findUnique').length, 0, 'no key, no lookup');
  }

  // A wrong phone clock never fails the tap: server time is used.
  {
    const w = world();
    await kill('k', '2030-01-01T00:00:00Z');
    assert.ok(Math.abs(w.rows[0].recordedAt.getTime() - Date.now()) < 5000);
  }

  console.log('eventRecording.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
