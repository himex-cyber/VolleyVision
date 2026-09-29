/**
 * Read-only report of every player record linked to a user account (6.0.3).
 *
 *   npx ts-node scripts/audit-player-links.ts
 *
 * Before v9.8.0 any player could claim any unclaimed record on their team, a
 * teammate's included, and the holder of a link reads that record's
 * individual stats as their own. Players can be minors. Those old self-claims
 * still stand, so this lists every link with a CHECK flag where the names
 * differ or the holder isn't a PLAYER on the team. It never writes; a coach
 * fixes a wrong link with Unlink on the roster.
 *
 * Prints names and roles only, never emails.
 */
import { prisma } from '../src/lib/prisma';

const norm = (first: string, last: string) => `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const players = await prisma.player.findMany({
    where: { userId: { not: null } },
    select: {
      firstName: true, lastName: true, jerseyNumber: true, userId: true,
      team: { select: { id: true, name: true, ownerId: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ team: { name: 'asc' } }, { jerseyNumber: 'asc' }],
  });

  if (players.length === 0) {
    console.log('No player records are linked to an account. Nothing to check.');
    return;
  }

  const memberships = await prisma.teamMembership.findMany({
    where: { userId: { in: players.map((p) => p.userId!) } },
    select: { userId: true, teamId: true, role: true },
  });
  const roleOf = new Map(memberships.map((m) => [`${m.teamId}:${m.userId}`, m.role as string]));

  let flagged = 0;
  let currentTeam = '';
  for (const p of players) {
    if (p.team.id !== currentTeam) {
      currentTeam = p.team.id;
      console.log(`\n${p.team.name}`);
    }
    const role = roleOf.get(`${p.team.id}:${p.userId}`)
      ?? (p.team.ownerId === p.userId ? 'HEAD_COACH (owner)' : 'not a member');
    const user = p.user ? `${p.user.firstName} ${p.user.lastName}` : '(account deleted)';
    const namesDiffer = !p.user || norm(p.firstName, p.lastName) !== norm(p.user.firstName, p.user.lastName);
    const check = namesDiffer || role !== 'PLAYER';
    if (check) flagged++;
    console.log(`  ${check ? 'CHECK' : 'ok   '}  #${p.jerseyNumber} ${p.firstName} ${p.lastName}  ->  ${user}  [${role}]`);
  }

  console.log(`\n${players.length} linked record(s), ${flagged} marked CHECK.`);
  console.log('A coach fixes a wrong link with Unlink on the team roster. This script changed nothing.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
