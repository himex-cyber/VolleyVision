/**
 * Staging seed: one pre-verified user per team role plus an outsider, two
 * teams, rosters, and two completed matches whose events carry the zone,
 * rotation, rally and opponent-serve fields the analytics read.
 *
 * Refuses to run unless DATABASE_URL is the staging project (lib/stagingGuard.ts):
 * it creates logins with a shared password. Idempotent: upserts everywhere,
 * and a match that already exists is skipped.
 *
 *   (staging env loaded)  npm run db:seed:staging
 *
 * Needs STAGING_PROJECT_REF, DATABASE_URL (staging) and SEED_PASSWORD.
 * Prints the team and match ids for the smoke env (SMOKE_TEAM_ID / SMOKE_MATCH_ID).
 */
import bcrypt from 'bcryptjs';
import { EventType, Position, TeamRole, UserRole } from '@prisma/client';
import { stagingGuardError } from '../src/lib/stagingGuard';

// Prisma Client loads backend/.env (prod) on its own for any variable the shell
// didn't set, so the guard inspects the resolved DATABASE_URL itself rather
// than trusting where it came from. lib/prisma is still imported only after it.
const guardError = stagingGuardError(process.env);
if (guardError) {
  console.error(`Refusing to seed: ${guardError}`);
  process.exit(1);
}
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? '';
if (SEED_PASSWORD.length < 12) {
  console.error('Refusing to seed: SEED_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const FALCONS = 'staging-falcons';
const WOLVES = 'staging-wolves';

type SeedUser = { key: string; firstName: string; role: UserRole; teamRole?: TeamRole };
// teamRole is the Falcons membership; the outsider only owns Wolves.
const USERS: SeedUser[] = [
  { key: 'owner', firstName: 'Olivia', role: UserRole.COACH, teamRole: TeamRole.HEAD_COACH },
  { key: 'manager', firstName: 'Marcus', role: UserRole.COACH, teamRole: TeamRole.MANAGER },
  { key: 'assistant', firstName: 'Ana', role: UserRole.COACH, teamRole: TeamRole.ASSISTANT_COACH },
  { key: 'statistician', firstName: 'Sione', role: UserRole.COACH, teamRole: TeamRole.STATISTICIAN },
  { key: 'player', firstName: 'Pita', role: UserRole.PLAYER, teamRole: TeamRole.PLAYER },
  { key: 'viewer', firstName: 'Vera', role: UserRole.VIEWER, teamRole: TeamRole.VIEWER },
  { key: 'outsider', firstName: 'Owen', role: UserRole.COACH },
];

// Fake adult names only: no birth dates, no phone numbers.
const FALCONS_ROSTER: [string, string, number, Position][] = [
  ['Pita', 'Staging', 1, Position.SETTER],
  ['Harper', 'Test', 3, Position.OUTSIDE_HITTER],
  ['Riley', 'Sample', 5, Position.OUTSIDE_HITTER],
  ['Morgan', 'Demo', 7, Position.OPPOSITE],
  ['Jordan', 'Example', 9, Position.MIDDLE_BLOCKER],
  ['Casey', 'Mock', 11, Position.MIDDLE_BLOCKER],
  ['Quinn', 'Placeholder', 12, Position.LIBERO],
];
const WOLVES_ROSTER: [string, string, number, Position][] = [
  ['Alex', 'Wolfe', 2, Position.SETTER],
  ['Sam', 'Grey', 4, Position.OUTSIDE_HITTER],
  ['Drew', 'Howl', 6, Position.MIDDLE_BLOCKER],
  ['Robin', 'Pack', 8, Position.LIBERO],
];

type MatchPlan = { id: string; opponent: string; matchDate: string; setScores: { set: number; home: number; away: number }[] };
const MATCHES: MatchPlan[] = [
  {
    id: 'staging-falcons-m1', opponent: 'Test Titans', matchDate: '2026-08-01T19:00:00Z',
    setScores: [{ set: 1, home: 25, away: 21 }, { set: 2, home: 22, away: 25 }, { set: 3, home: 25, away: 19 }, { set: 4, home: 25, away: 23 }],
  },
  {
    id: 'staging-falcons-m2', opponent: 'Sample Sharks', matchDate: '2026-08-08T19:00:00Z',
    setScores: [{ set: 1, home: 23, away: 25 }, { set: 2, home: 25, away: 20 }, { set: 3, home: 18, away: 25 }, { set: 4, home: 21, away: 25 }],
  },
];

// Own-team actions cycled through each rally; each rally also gets a serve.
const RALLY_ACTIONS: EventType[] = [
  EventType.PASS_3, EventType.ASSIST, EventType.KILL, EventType.DIG, EventType.PASS_2,
  EventType.ATTACK_ATTEMPT, EventType.SOLO_BLOCK, EventType.PASS_1, EventType.ATTACK_ERROR, EventType.BLOCK_ASSIST,
];
const OPPONENT_SERVES: EventType[] = [EventType.SERVE_IN, EventType.SERVE_IN, EventType.SERVICE_ERROR, EventType.SERVE_IN, EventType.ACE];

function buildEvents(plan: MatchPlan, playerIds: string[]) {
  const rows: {
    matchId: string; playerId: string | null; eventType: EventType; setNumber: number;
    rallyNumber: number; rotationNumber: number; courtZone: number;
    isOpponentEvent: boolean; opponentJerseyNumber: number | null;
  }[] = [];
  let n = 0;
  for (const { set } of plan.setScores) {
    // A dozen rallies per set is plenty for charts without bloating the table.
    for (let rally = 1; rally <= 12; rally++, n++) {
      const rotationNumber = (Math.floor(n / 2) % 6) + 1;
      const base = { matchId: plan.id, setNumber: set, rallyNumber: rally, rotationNumber };
      // Serve alternates: odd rallies we serve, even rallies the opponent does.
      if (rally % 2 === 1) {
        rows.push({ ...base, playerId: playerIds[n % playerIds.length], eventType: n % 7 === 0 ? EventType.ACE : EventType.SERVE_IN,
          courtZone: 1, isOpponentEvent: false, opponentJerseyNumber: null });
      } else {
        rows.push({ ...base, playerId: null, eventType: OPPONENT_SERVES[n % OPPONENT_SERVES.length],
          courtZone: 1, isOpponentEvent: true, opponentJerseyNumber: (n % 12) + 1 });
      }
      rows.push({ ...base, playerId: playerIds[(n + 3) % playerIds.length], eventType: RALLY_ACTIONS[n % RALLY_ACTIONS.length],
        courtZone: (n % 6) + 1, isOpponentEvent: false, opponentJerseyNumber: null });
    }
  }
  return rows;
}

async function main() {
  const { prisma } = await import('../src/lib/prisma');
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const now = new Date();

  const userIds: Record<string, string> = {};
  for (const u of USERS) {
    const email = `staging+${u.key}@volleyvision.test`;
    const data = { firstName: u.firstName, lastName: 'Staging', role: u.role, passwordHash, emailVerifiedAt: now };
    const user = await prisma.user.upsert({ where: { email }, update: data, create: { email, ...data } });
    userIds[u.key] = user.id;
  }

  await prisma.team.upsert({
    where: { id: FALCONS }, update: {},
    create: { id: FALCONS, name: 'Staging Falcons', season: '2026', ownerId: userIds.owner },
  });
  await prisma.team.upsert({
    where: { id: WOLVES }, update: {},
    create: { id: WOLVES, name: 'Staging Wolves', season: '2026', ownerId: userIds.outsider },
  });

  // Owner memberships are HEAD_COACH, as ensureOwnerMembership does for real teams.
  const { defaultAccessTiers } = await import('../src/services/permission.service');
  const memberships: [string, string, TeamRole][] = [
    ...USERS.filter((u) => u.teamRole).map((u) => [FALCONS, userIds[u.key], u.teamRole!] as [string, string, TeamRole]),
    [WOLVES, userIds.outsider, TeamRole.HEAD_COACH],
  ];
  for (const [teamId, userId, role] of memberships) {
    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { teamId, userId, role, ...defaultAccessTiers(role) },
    });
  }

  const upsertRoster = async (teamId: string, roster: typeof FALCONS_ROSTER) => {
    const ids: string[] = [];
    for (const [firstName, lastName, jerseyNumber, position] of roster) {
      const p = await prisma.player.upsert({
        where: { teamId_jerseyNumber: { teamId, jerseyNumber } },
        update: {},
        create: { teamId, firstName, lastName, jerseyNumber, position },
      });
      ids.push(p.id);
    }
    return ids;
  };
  const falconsPlayers = await upsertRoster(FALCONS, FALCONS_ROSTER);
  await upsertRoster(WOLVES, WOLVES_ROSTER);
  // The seed player's own record, so the player portal has data.
  await prisma.player.update({ where: { id: falconsPlayers[0] }, data: { userId: userIds.player } });

  for (const plan of MATCHES) {
    if (await prisma.match.findUnique({ where: { id: plan.id } })) {
      console.log(`${plan.id} already exists, skipped`);
      continue;
    }
    const homeSetsWon = plan.setScores.filter((s) => s.home > s.away).length;
    await prisma.match.create({
      data: {
        id: plan.id, teamId: FALCONS, opponent: plan.opponent, matchDate: new Date(plan.matchDate),
        status: 'COMPLETED', homeSetsWon, awaySetsWon: plan.setScores.length - homeSetsWon, setScores: plan.setScores,
      },
    });
    const events = buildEvents(plan, falconsPlayers);
    await prisma.event.createMany({ data: events });
    console.log(`${plan.id}: ${events.length} events`);
  }

  console.log('\nStaging seed complete. For backend/.env.staging:');
  console.log(`SMOKE_TEAM_ID=${FALCONS}`);
  console.log(`SMOKE_MATCH_ID=${MATCHES[0].id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
