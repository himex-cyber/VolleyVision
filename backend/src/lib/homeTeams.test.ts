import assert from 'node:assert/strict';
import { buildHomeTeams } from './homeTeams';

const t = (id: string, name = id) => ({ id, name });

// One card per team, whatever the source: an owned team also has the owner's
// HEAD_COACH membership, and an owner whose membership row is missing (older
// data) still gets a Coach card.
const cards = buildHomeTeams(
  [t('A', 'Aces'), t('Z', 'Zebras')],
  [
    { role: 'HEAD_COACH', team: t('A', 'Aces') },
    { role: 'PLAYER', team: t('B', 'Bees') },
    { role: 'STATISTICIAN', team: t('C', 'Crows') },
    { role: 'VIEWER', team: t('D', 'Doves') },
    { role: 'MANAGER', team: t('E', 'Eagles') },
  ],
  [
    { id: 'm2', matchDate: '2026-10-09', opponent: 'Later', team: { id: 'A' } },
    { id: 'm1', matchDate: '2026-10-02', opponent: 'Sooner', team: { id: 'A' } },
    { id: 'm3', matchDate: '2026-10-05', opponent: 'Hornets', team: { id: 'B' } },
  ],
);

// Ordered by what you can do there (coach, staff, player, viewer), then name.
assert.deepEqual(cards.map((c) => [c.teamId, c.badge]), [
  ['A', 'Coach'], ['Z', 'Coach'], ['C', 'Staff'], ['E', 'Staff'], ['B', 'Player'], ['D', 'Viewer'],
]);
assert.equal(cards.find((c) => c.teamId === 'Z')!.role, 'HEAD_COACH', 'owning a team makes you its coach');
assert.equal(cards.find((c) => c.teamId === 'E')!.role, 'MANAGER', 'the exact role is kept for the badge colour');

// The next match is the earliest upcoming one for that team.
assert.equal(cards.find((c) => c.teamId === 'A')!.nextMatch?.id, 'm1');
assert.equal(cards.find((c) => c.teamId === 'B')!.nextMatch?.opponent, 'Hornets');
assert.equal(cards.find((c) => c.teamId === 'C')!.nextMatch, null);

assert.deepEqual(buildHomeTeams([], [], []), []);

console.log('homeTeams.test.ts passed');
