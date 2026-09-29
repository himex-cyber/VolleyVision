import { PrismaClient, Position } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding VolleyVision database...');

  // Create a sample team
  const team = await prisma.team.upsert({
    where: { id: 'seed-team-1' },
    update: {},
    create: {
      id: 'seed-team-1',
      name: 'Canterbury Falcons',
      division: 'National League Division 1',
      season: '2025/26',
    },
  });

  console.log(`✅ Team: ${team.name}`);

  // Create sample players
  const players = [
    { firstName: 'Mia', lastName: 'Taufa', jerseyNumber: 1, position: Position.LIBERO },
    { firstName: 'Sam', lastName: 'Whitmore', jerseyNumber: 3, position: Position.SETTER },
    { firstName: 'Jade', lastName: 'Nguyen', jerseyNumber: 5, position: Position.OUTSIDE_HITTER },
    { firstName: 'Karlos', lastName: 'Hennings', jerseyNumber: 7, position: Position.OPPOSITE },
    { firstName: 'Priya', lastName: 'Sharma', jerseyNumber: 9, position: Position.MIDDLE_BLOCKER },
    { firstName: 'Luke', lastName: 'Barrera', jerseyNumber: 11, position: Position.OUTSIDE_HITTER },
    { firstName: 'Aaliya', lastName: 'Osei', jerseyNumber: 12, position: Position.DEFENSIVE_SPECIALIST },
    { firstName: 'Tom', lastName: 'Eriksen', jerseyNumber: 14, position: Position.MIDDLE_BLOCKER },
  ];

  for (const p of players) {
    const player = await prisma.player.upsert({
      where: { teamId_jerseyNumber: { teamId: team.id, jerseyNumber: p.jerseyNumber } },
      update: {},
      create: { ...p, teamId: team.id },
    });
    console.log(`  👤 #${player.jerseyNumber} ${player.firstName} ${player.lastName}`);
  }

  // Create a sample match
  const match = await prisma.match.upsert({
    where: { id: 'seed-match-1' },
    update: {},
    create: {
      id: 'seed-match-1',
      teamId: team.id,
      // Wall-clock fixture time, kept as UTC like the app stores it (8.0.7).
      matchDate: new Date('2026-06-20T19:00:00Z'),
      opponent: 'Wellington Wolves',
      competition: 'National League',
      venue: 'Cowles Stadium, Christchurch',
      status: 'SCHEDULED',
    },
  });

  console.log(`✅ Match: ${team.name} vs ${match.opponent}`);
  console.log('\n✨ Seed complete. Ready to track!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
