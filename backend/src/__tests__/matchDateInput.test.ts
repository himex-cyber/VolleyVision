// 8.0.7: create and edit store a naive fixture time as written, and refuse an
// invalid one with a 400 before anything is written (it used to be a 500).
import assert from 'node:assert/strict';
import { db, resetDb, callsFor } from '../testing/installFakePrisma';
import { createMatch, updateMatch } from '../controllers/matches';

function world() {
  resetDb();
  db.teamMembership.findUnique = async () => null; // 'coach' owns the team: full access
  db.team.findUnique = async () => ({ ownerId: 'coach' });
  db.user.findUnique = async () => ({ role: 'COACH' });
  db.match.findUnique = async () => ({ teamId: 'T' });
  db.match.create = async (args: any) => ({ id: 'M', ...args.data });
  db.match.update = async (args: any) => ({ id: 'M', ...args.data });
  db.auditLog.create = async () => ({});
}

async function call(handler: any, req: { params?: Record<string, string>; body: any }) {
  let body: any;
  let status = 200;
  let error: any;
  const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { body = b; return res; } };
  await handler({ params: {}, query: {}, user: { userId: 'coach' }, ...req } as any, res, (err: any) => { error = err; });
  return { body, status, error };
}

async function main() {
  world();
  const created = await call(createMatch, { body: { teamId: 'T', matchDate: '2026-09-30T19:00', opponent: 'Hawks' } });
  assert.equal(created.error, undefined);
  assert.equal(callsFor('match', 'create')[0][0].data.matchDate.toISOString(), '2026-09-30T19:00:00.000Z', 'stored as written');

  world();
  await call(updateMatch, { params: { id: 'M' }, body: { matchDate: '2026-10-01T18:30', opponent: 'Hawks' } });
  assert.equal(callsFor('match', 'update')[0][0].data.matchDate.toISOString(), '2026-10-01T18:30:00.000Z');

  world();
  await call(updateMatch, { params: { id: 'M' }, body: { opponent: 'Hawks II' } });
  assert.equal(callsFor('match', 'update')[0][0].data.matchDate, undefined, 'no date sent: the date is left alone');

  for (const [handler, req] of [
    [createMatch, { body: { teamId: 'T', matchDate: 'x', opponent: 'Hawks' } }],
    [createMatch, { body: { teamId: 'T', matchDate: '2026-02-30T19:00', opponent: 'Hawks' } }],
    [updateMatch, { params: { id: 'M' }, body: { matchDate: 'soon' } }],
  ] as const) {
    world();
    const r = await call(handler, req as any);
    assert.equal(r.error?.statusCode, 400, JSON.stringify(req.body));
    assert.equal(callsFor('match', 'create').length + callsFor('match', 'update').length, 0, 'nothing written');
  }

  console.log('matchDateInput: all tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
