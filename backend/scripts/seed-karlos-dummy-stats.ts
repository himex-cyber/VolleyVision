/**
 * One-off dummy-data seed: gives Karlos's player record (#7, Canterbury
 * Falcons) six completed matches with recorded events, so the player portal
 * charts (kill-efficiency trend, radar, development trends) and the coach
 * dashboard's match-performance chart have real data to render during dev/testing.
 *
 * Idempotent — matches are created with fixed ids (dummy-karlos-m1..m6); if
 * they already exist this is a no-op.
 *
 *   npx ts-node scripts/seed-karlos-dummy-stats.ts
 */
import { prisma } from '../src/lib/prisma';
import { EventType } from '@prisma/client';

const TEAM_ID = 'seed-team-1';
const JERSEY_NUMBER = 7;

// Oldest → newest. Hitting % and every counting stat trend upward across the
// six matches on purpose, so the "kill efficiency" trend line and the
// StatsCards trend badges have something meaningful to show.
type MatchPlan = {
  id: string;
  opponent: string;
  matchDate: string;
  homeSetsWon: number;
  awaySetsWon: number;
  setScores: { set: number; home: number; away: number }[];
  stats: {
    kills: number; attackErrors: number; attackAttemptsExtra: number; // neutral ATTACK_ATTEMPT rows
    aces: number; serviceErrors: number; serveInExtra: number;
    digs: number; digErrors: number;
    soloBlocks: number; blockAssists: number;
    assists: number;
    passAttempts: number; // split across PASS_3/2/1 for a believable passingRating
  };
};

const PLAN: MatchPlan[] = [
  {
    id: 'dummy-karlos-m1', opponent: 'Otago Thunder', matchDate: '2026-06-06T19:00:00',
    homeSetsWon: 1, awaySetsWon: 3,
    setScores: [{ set: 1, home: 25, away: 20 }, { set: 2, home: 18, away: 25 }, { set: 3, home: 20, away: 25 }, { set: 4, home: 22, away: 25 }],
    stats: { kills: 6, attackErrors: 3, attackAttemptsExtra: 5, aces: 1, serviceErrors: 2, serveInExtra: 3, digs: 4, digErrors: 1, soloBlocks: 1, blockAssists: 1, assists: 0, passAttempts: 4 },
  },
  {
    id: 'dummy-karlos-m2', opponent: 'Hamilton Hurricanes', matchDate: '2026-06-13T19:00:00',
    homeSetsWon: 3, awaySetsWon: 1,
    setScores: [{ set: 1, home: 25, away: 22 }, { set: 2, home: 22, away: 25 }, { set: 3, home: 25, away: 20 }, { set: 4, home: 25, away: 18 }],
    stats: { kills: 7, attackErrors: 3, attackAttemptsExtra: 5, aces: 1, serviceErrors: 1, serveInExtra: 4, digs: 5, digErrors: 1, soloBlocks: 1, blockAssists: 2, assists: 1, passAttempts: 5 },
  },
  {
    id: 'dummy-karlos-m3', opponent: 'Dunedin Dolphins', matchDate: '2026-06-27T19:00:00',
    homeSetsWon: 3, awaySetsWon: 1,
    setScores: [{ set: 1, home: 25, away: 18 }, { set: 2, home: 21, away: 25 }, { set: 3, home: 25, away: 19 }, { set: 4, home: 25, away: 21 }],
    stats: { kills: 9, attackErrors: 2, attackAttemptsExtra: 5, aces: 2, serviceErrors: 1, serveInExtra: 5, digs: 5, digErrors: 0, soloBlocks: 2, blockAssists: 1, assists: 1, passAttempts: 5 },
  },
  {
    id: 'dummy-karlos-m4', opponent: 'Auckland Aces', matchDate: '2026-07-04T19:00:00',
    homeSetsWon: 2, awaySetsWon: 3,
    setScores: [{ set: 1, home: 25, away: 21 }, { set: 2, home: 22, away: 25 }, { set: 3, home: 25, away: 23 }, { set: 4, home: 20, away: 25 }, { set: 5, home: 12, away: 15 }],
    stats: { kills: 8, attackErrors: 3, attackAttemptsExtra: 4, aces: 1, serviceErrors: 2, serveInExtra: 4, digs: 6, digErrors: 1, soloBlocks: 1, blockAssists: 2, assists: 0, passAttempts: 6 },
  },
  {
    id: 'dummy-karlos-m5', opponent: 'Nelson Nighthawks', matchDate: '2026-07-11T19:00:00',
    homeSetsWon: 3, awaySetsWon: 2,
    setScores: [{ set: 1, home: 25, away: 20 }, { set: 2, home: 23, away: 25 }, { set: 3, home: 25, away: 22 }, { set: 4, home: 22, away: 25 }, { set: 5, home: 15, away: 11 }],
    stats: { kills: 10, attackErrors: 2, attackAttemptsExtra: 5, aces: 2, serviceErrors: 1, serveInExtra: 5, digs: 7, digErrors: 1, soloBlocks: 2, blockAssists: 2, assists: 1, passAttempts: 6 },
  },
  {
    id: 'dummy-karlos-m6', opponent: 'Palmerston Pumas', matchDate: '2026-07-18T19:00:00',
    homeSetsWon: 3, awaySetsWon: 0,
    setScores: [{ set: 1, home: 25, away: 19 }, { set: 2, home: 25, away: 21 }, { set: 3, home: 25, away: 17 }],
    stats: { kills: 11, attackErrors: 1, attackAttemptsExtra: 4, aces: 3, serviceErrors: 0, serveInExtra: 6, digs: 6, digErrors: 0, soloBlocks: 3, blockAssists: 1, assists: 2, passAttempts: 5 },
  },
];

/** Builds a flat list of events for one match, cycling through its played sets. */
function buildEvents(plan: MatchPlan, matchId: string, playerId: string) {
  const numSets = plan.homeSetsWon + plan.awaySetsWon;
  let setCursor = 0;
  const nextSet = () => { setCursor = (setCursor % numSets) + 1; return setCursor; };

  const rows: { matchId: string; playerId: string; eventType: EventType; setNumber: number }[] = [];
  const push = (eventType: EventType, count: number) => {
    for (let i = 0; i < count; i++) rows.push({ matchId, playerId, eventType, setNumber: nextSet() });
  };

  const s = plan.stats;
  push(EventType.KILL, s.kills);
  push(EventType.ATTACK_ERROR, s.attackErrors);
  push(EventType.ATTACK_ATTEMPT, s.attackAttemptsExtra);
  push(EventType.ACE, s.aces);
  push(EventType.SERVICE_ERROR, s.serviceErrors);
  push(EventType.SERVE_IN, s.serveInExtra);
  push(EventType.DIG, s.digs);
  push(EventType.DIG_ERROR, s.digErrors);
  push(EventType.SOLO_BLOCK, s.soloBlocks);
  push(EventType.BLOCK_ASSIST, s.blockAssists);
  push(EventType.ASSIST, s.assists);

  // Split passAttempts across PASS_3/PASS_2/PASS_1 roughly 40/40/20 so
  // passingRating lands in a believable ~1.8–2.3 range rather than a flat 3 or 0.
  const p3 = Math.round(s.passAttempts * 0.4);
  const p2 = Math.round(s.passAttempts * 0.4);
  const p1 = s.passAttempts - p3 - p2;
  push(EventType.PASS_3, p3);
  push(EventType.PASS_2, p2);
  push(EventType.PASS_1, p1);

  return rows;
}

async function main() {
  const team = await prisma.team.findUnique({ where: { id: TEAM_ID } });
  if (!team) {
    console.error(`No team with id "${TEAM_ID}" — run "npm run db:seed" first.`);
    process.exit(1);
  }

  const player = await prisma.player.findUnique({
    where: { teamId_jerseyNumber: { teamId: TEAM_ID, jerseyNumber: JERSEY_NUMBER } },
  });
  if (!player) {
    console.error(`No player #${JERSEY_NUMBER} on team "${team.name}" — run "npm run db:seed" first.`);
    process.exit(1);
  }

  if (!player.userId) {
    const karlosUser = await prisma.user.findUnique({ where: { email: 'karlos.hennings@gmail.com' } });
    if (karlosUser) {
      await prisma.player.update({ where: { id: player.id }, data: { userId: karlosUser.id } });
      console.log(`🔗 Linked player #${JERSEY_NUMBER} to karlos.hennings@gmail.com`);
    } else {
      console.warn(
        `⚠️  Player #${JERSEY_NUMBER} isn't linked to a user account, and no user with email ` +
        `"karlos.hennings@gmail.com" was found to auto-link. The dummy matches/events will still be ` +
        `created, but the player portal only shows stats for the LOGGED-IN user's linked player record — ` +
        `link this record from the Player Portal's "link a player record" flow to see them.`,
      );
    }
  }

  for (const plan of PLAN) {
    const existing = await prisma.match.findUnique({ where: { id: plan.id } });
    if (existing) {
      console.log(`⏭  ${plan.id} (vs ${plan.opponent}) already exists — skipping`);
      continue;
    }

    const match = await prisma.match.create({
      data: {
        id: plan.id,
        teamId: TEAM_ID,
        opponent: plan.opponent,
        matchDate: new Date(plan.matchDate),
        competition: 'National League',
        status: 'COMPLETED',
        homeSetsWon: plan.homeSetsWon,
        awaySetsWon: plan.awaySetsWon,
        setScores: plan.setScores,
      },
    });

    const events = buildEvents(plan, match.id, player.id);
    await prisma.event.createMany({ data: events });

    console.log(`✅ ${plan.id} — vs ${plan.opponent} (${plan.homeSetsWon}-${plan.awaySetsWon}), ${events.length} events`);
  }

  console.log('\n✨ Dummy stats seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
