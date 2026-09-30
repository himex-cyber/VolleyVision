import assert from 'node:assert/strict';
import { visiblePlayers, redactEvents, maskMembers, maskOwner, maskInviter } from './playerPrivacy';

const players = [
  { id: 'p1', firstName: 'Ann', userId: 'u1' },
  { id: 'p2', firstName: 'Ben', userId: 'u2' },
  { id: 'p3', firstName: 'Cal', userId: null },
];

// Staff see every player, with userId stripped.
const staff = visiblePlayers(players, true, 'coach');
assert.deepEqual(staff.map((p) => p.id), ['p1', 'p2', 'p3']);
assert.ok(staff.every((p) => !('userId' in p)), 'userId never leaves the server');

// A player sees only their own row; a viewer (no linked record) sees none.
assert.deepEqual(visiblePlayers(players, false, 'u2'), [{ id: 'p2', firstName: 'Ben' }]);
assert.deepEqual(visiblePlayers(players, false, 'viewer'), []);
// An unclaimed record (userId null) never matches a null caller.
assert.deepEqual(visiblePlayers(players, false, null), []);

const events = [
  { id: 'e1', eventType: 'KILL', playerId: 'p1', notes: 'great', isOpponentEvent: false, player: { firstName: 'Ann', userId: 'u1' } },
  { id: 'e2', eventType: 'ACE', playerId: 'p2', notes: 'mine', isOpponentEvent: false, player: { firstName: 'Ben', userId: 'u2' } },
  { id: 'e3', eventType: 'KILL', playerId: null, notes: 'opp', isOpponentEvent: true, player: null },
  { id: 'e4', eventType: 'DIG', playerId: 'p3', notes: null, isOpponentEvent: false, player: { firstName: 'Cal', userId: null } },
];

// Staff get everything unchanged, minus player.userId.
const s = redactEvents(events, true, 'coach');
assert.equal(s[0].playerId, 'p1');
assert.equal(s[0].notes, 'great');
assert.deepEqual(s[0].player, { firstName: 'Ann' });

// A player keeps their own events and opponent events; teammates' become anonymous.
const mine = redactEvents(events, false, 'u2');
assert.deepEqual(mine[0], { id: 'e1', eventType: 'KILL', playerId: null, notes: null, isOpponentEvent: false, player: null });
assert.deepEqual(mine[1], { id: 'e2', eventType: 'ACE', playerId: 'p2', notes: 'mine', isOpponentEvent: false, player: { firstName: 'Ben' } });
assert.deepEqual(mine[2], events[2], 'opponent events unchanged');
assert.equal(mine[3].playerId, null, 'an unclaimed player is still another player');

// A viewer gets every own-team event anonymised.
const v = redactEvents(events, false, 'viewer');
assert.ok(v.filter((e) => !e.isOpponentEvent).every((e) => e.playerId === null && e.player === null && e.notes === null));
assert.ok(!JSON.stringify(v).includes('Ann') && !JSON.stringify(v).includes('p1'));

// 6.3: the offline queue's clientKey is for staff only. Non-staff lose it on
// every event, their own and opponent events included.
const keyed = events.map((e, i) => ({ ...e, clientKey: `k${i}` }));
assert.ok(redactEvents(keyed, true, 'coach').every((e) => e.clientKey?.startsWith('k')), 'staff keep clientKey');
const keyedMine = redactEvents(keyed, false, 'u2');
assert.ok(keyedMine.every((e) => e.clientKey === null), 'non-staff never get a clientKey');
assert.equal(keyedMine[1].notes, 'mine', 'own events otherwise unchanged');
assert.equal(keyedMine[2].notes, 'opp', 'opponent events otherwise unchanged');
// Rows without the field (older selects) don't gain one.
assert.equal('clientKey' in redactEvents(events, false, 'u2')[2], false);

// 8.5.0.1: the members list. Managers get every row whole. Anyone else gets
// no emails, no global role, and only their own account id.
const memberRows = [
  { id: 'm1', role: 'HEAD_COACH', user: { id: 'u1', firstName: 'Ann', email: 'a@x.test', role: 'ADMIN', profileImage: null } },
  { id: 'm2', role: 'PLAYER', user: { id: 'u2', firstName: 'Ben', email: 'b@x.test', role: 'PLAYER', profileImage: null } },
];
assert.deepEqual(maskMembers(memberRows, true, 'u1'), memberRows, 'managers see everything');
const asBen = maskMembers(memberRows, false, 'u2');
assert.deepEqual(asBen.map((m) => m.user.id), [null, 'u2'], 'only the caller keeps an account id');
assert.ok(asBen.every((m) => !('role' in m.user) && !('email' in m.user)), 'no global role or email');
assert.deepEqual(asBen.map((m) => m.role), ['HEAD_COACH', 'PLAYER'], 'team roles stay');
assert.equal(asBen[0].user.firstName, 'Ann');
assert.ok(maskMembers(memberRows, false, null).every((m) => m.user.id === null), 'anonymous: every id masked');

// 9.0.2: the owner's email and account id, on the team rows every member reads.
const ownedTeam = { id: 't1', ownerId: 'u1', owner: { id: 'u1', firstName: 'Kim', lastName: 'Lee', email: 'kim@x.test' } };
assert.deepEqual(maskOwner(ownedTeam, true, 'u2'), ownedTeam, 'managers see the owner in full');
assert.deepEqual(maskOwner(ownedTeam, false, 'u1'), ownedTeam, 'the owner sees themself');
const asMember = maskOwner(ownedTeam, false, 'u2');
assert.equal(asMember.ownerId, null, 'no owner id for a member');
assert.deepEqual(asMember.owner, { id: null, firstName: 'Kim', lastName: 'Lee', email: null }, 'name kept, id and email null');
assert.equal(ownedTeam.owner.email, 'kim@x.test', 'input not mutated');
assert.deepEqual(maskOwner({ id: 't2', ownerId: 'u1' }, false, null), { id: 't2', ownerId: null }, 'a row without owner');
assert.deepEqual(maskOwner({ id: 't3', ownerId: 'u1', owner: null }, false, 'u2').owner, null, 'a null owner stays null');

// 9.0.4: what an invitee learns about who invited them: the name only.
const inv = { id: 'i1', invitedById: 'u1', invitedBy: { id: 'u1', firstName: 'Kim', lastName: 'Lee', email: 'kim@x.test' } };
assert.deepEqual(maskInviter(inv), { id: 'i1', invitedById: null, invitedBy: { id: null, firstName: 'Kim', lastName: 'Lee', email: null } });
assert.deepEqual(maskInviter({ id: 'i2', invitedById: 'u1' }), { id: 'i2', invitedById: null }, 'a row without invitedBy');
assert.equal(inv.invitedBy.email, 'kim@x.test', 'input not mutated');

console.log('playerPrivacy.test.ts passed');
