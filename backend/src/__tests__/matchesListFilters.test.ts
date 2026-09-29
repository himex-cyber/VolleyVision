// 8.2: GET /matches/by-team/:teamId?from=&to=&status=. `to` used to cut the
// end day off at midnight, and a bad date or status reached Prisma as a 500.
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { getMatchesByTeam } from '../controllers/matches';

async function call(query: Record<string, unknown>) {
  resetDb();
  db.match.findMany = async () => [];
  let error: any;
  const res: any = { json: () => res, status: () => res };
  await getMatchesByTeam({ params: { teamId: 'T' }, query } as any, res, (err: any) => { error = err; });
  return { error, where: callsFor('match', 'findMany')[0]?.[0].where };
}

async function main() {
  // No filters: unchanged.
  const none = await call({});
  assert.equal(none.error, undefined);
  assert.deepEqual(none.where, { teamId: 'T' });

  // The whole end day is included.
  const range = await call({ from: '2026-09-01', to: '2026-09-30' });
  assert.equal(range.error, undefined);
  assert.deepEqual(range.where.matchDate, { gte: new Date('2026-09-01T00:00:00.000Z'), lt: new Date('2026-10-01T00:00:00.000Z') });

  // Status still filters; a real one passes.
  assert.equal((await call({ status: 'COMPLETED' })).where.status, 'COMPLETED');

  // Bad input is a 400, never a Prisma error.
  for (const query of [{ from: 'x' }, { to: '2026-02-30' }, { from: '2026-09-30', to: '2026-09-01' }, { status: 'NOPE' }, { status: ['COMPLETED', 'SCHEDULED'] }]) {
    const r = await call(query);
    assert.equal(r.error?.statusCode, 400, JSON.stringify(query));
    assert.equal(r.where, undefined, 'nothing reached the database');
  }

  console.log('matchesListFilters: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
