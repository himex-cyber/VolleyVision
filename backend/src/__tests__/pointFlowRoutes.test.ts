// Rotations, momentum and advanced metrics (7.8). Team-level, read-only, for
// every member (the visibility guard runs first, in the router). Point flow
// (who won each point) reads the opponent's events too; our players' actions
// never do. No query ever selects a player (players can be minors).
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import {
  getMatchRotations, getMatchMomentum, getMatchAdvanced, getTeamRotations, getTeamAdvanced,
} from '../controllers/analytics';

const at = (s: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, s));

function world() {
  resetDb();
  db.event.findMany = async (args: any) =>
    args.where.isOpponentEvent === false
      ? [{ eventType: 'KILL', setNumber: 1 }, { eventType: 'PASS_3', setNumber: 1 }]
      : [
          { eventType: 'KILL', isOpponentEvent: false, setNumber: 1, rotationNumber: 1, servingSide: 'THEM', recordedAt: at(1) },
          { eventType: 'KILL', isOpponentEvent: true, setNumber: 1, rotationNumber: 1, servingSide: 'US', recordedAt: at(2) },
        ];
}

async function call(handler: any, params: Record<string, string>) {
  let body: any;
  let error: any;
  const res: any = { status: () => res, json: (b: any) => { body = b; return res; } };
  await handler({ params, query: {}, user: { userId: 'mate' } } as any, res, (err: any) => { error = err; });
  return { status: error ? error.statusCode ?? 500 : 200, body };
}

const queries = () => callsFor('event', 'findMany').map((c) => c[0]);
const noPlayer = () => {
  for (const q of queries()) {
    assert.ok(!('playerId' in q.select) && !('player' in q.select), 'no player in any select');
    assert.equal(q.include, undefined);
  }
};

async function main() {
  // Rotations: point flow, the opponent included.
  world();
  let r = await call(getMatchRotations, { matchId: 'M' });
  assert.equal(r.status, 200);
  const rot1 = r.body.rotations.find((x: any) => x.rotation === 1);
  assert.deepEqual([rot1.won, rot1.lost, rot1.sideOutPct, rot1.breakPointPct], [1, 1, 100, 0]);
  let q = queries()[0];
  assert.equal(q.where.matchId, 'M');
  assert.equal(q.where.isOpponentEvent, undefined, "the opponent's points count");
  assert.equal(q.where.trainingSessionId, null);
  noPlayer();

  // Momentum: per set, the opponent included.
  world();
  r = await call(getMatchMomentum, { matchId: 'M' });
  assert.deepEqual(r.body.timeline.map((p: any) => p.scorer), ['home', 'away']);
  assert.equal(r.body.sets.length, 1);
  assert.equal(queries()[0].where.isOpponentEvent, undefined);
  noPlayer();

  // Advanced: our actions from ownEventsOnly; side-out from the point list.
  world();
  r = await call(getMatchAdvanced, { matchId: 'M' });
  assert.equal(r.body.attack.kills, 1, "an opponent's kill is never ours");
  assert.equal(r.body.receptionQuality.pass3, 1);
  assert.deepEqual([r.body.sideOut.sideOutPct, r.body.sideOut.breakPointPct], [100, 0]);
  const [own, pts] = queries();
  assert.equal(own.where.isOpponentEvent, false);
  assert.equal(pts.where.isOpponentEvent, undefined);
  noPlayer();

  // Team versions: across the team's matches.
  world();
  r = await call(getTeamRotations, { teamId: 'T' });
  assert.equal(r.status, 200);
  assert.deepEqual(queries()[0].where.match, { teamId: 'T' });
  world();
  r = await call(getTeamAdvanced, { teamId: 'T' });
  assert.equal(r.status, 200);
  assert.ok(queries().every((x) => x.where.match?.teamId === 'T'));
  noPlayer();

  console.log('pointFlowRoutes.test.ts passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
