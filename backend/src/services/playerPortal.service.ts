import { prisma, runSerializable } from '../lib/prisma';
import { EventType } from '@prisma/client';
import { ownEventsOnly } from '../lib/eventFilters';
import { AppError } from '../middleware/errorHandler';

// Reuses the same stat derivation logic as the existing analytics engine
function deriveStats(events: { eventType: EventType }[]) {
  let kills = 0, attackAttempts = 0, attackErrors = 0, tips = 0, freeBalls = 0;
  let aces = 0, serviceErrors = 0, serveIn = 0;
  let passAttempts = 0, passSum = 0;
  let soloBlocks = 0, blockAssists = 0, blockErrors = 0;
  let digs = 0, digErrors = 0;
  let assists = 0, settingErrors = 0;

  for (const e of events) {
    switch (e.eventType) {
      case EventType.KILL:           kills++;          attackAttempts++; break;
      case EventType.ATTACK_ERROR:   attackErrors++;   attackAttempts++; break;
      case EventType.ATTACK_ATTEMPT: attackAttempts++; break;
      case EventType.TIP:            tips++;           attackAttempts++; break;
      case EventType.FREE_BALL:      freeBalls++;      attackAttempts++; break;
      case EventType.ACE:            aces++;           serveIn++;        break;
      case EventType.SERVICE_ERROR:  serviceErrors++;  break;
      case EventType.SERVE_IN:       serveIn++;        break;
      case EventType.PASS_3:         passAttempts++;   passSum += 3;     break;
      case EventType.PASS_2:         passAttempts++;   passSum += 2;     break;
      case EventType.PASS_1:         passAttempts++;   passSum += 1;     break;
      case EventType.PASS_0:         passAttempts++;                     break;
      case EventType.SOLO_BLOCK:     soloBlocks++;                       break;
      case EventType.BLOCK_ASSIST:   blockAssists++;                     break;
      case EventType.BLOCK_ERROR:    blockErrors++;                      break;
      case EventType.DIG:            digs++;                             break;
      case EventType.DIG_ERROR:      digErrors++;                        break;
      case EventType.ASSIST:         assists++;                          break;
      case EventType.SETTING_ERROR:  settingErrors++;                    break;
    }
  }

  const hittingPercentage =
    attackAttempts > 0 ? (kills - attackErrors) / attackAttempts : null;
  const passingRating = passAttempts > 0 ? passSum / passAttempts : null;
  const totalBlocks = soloBlocks + blockAssists * 0.5;
  const serveAttempts = aces + serviceErrors + serveIn;
  const serveInPercentage = serveAttempts > 0 ? serveIn / serveAttempts : null;

  return {
    kills, attackAttempts, attackErrors, hittingPercentage, tips, freeBalls,
    aces, serviceErrors, serveAttempts, serveInPercentage,
    passAttempts, passingRating,
    soloBlocks, blockAssists, blockErrors, totalBlocks,
    digs, digErrors,
    assists, settingErrors,
    totalEvents: events.length,
  };
}

export async function getLinkedPlayers(userId: string) {
  return prisma.player.findMany({
    where: { userId },
    include: {
      team: { select: { id: true, name: true, division: true, season: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Staff link a team member to a roster record (4.0.2, v9.8.0). Players used to
 * claim records themselves, and any PLAYER-role member could claim ANY
 * unclaimed record on their team, a teammate's included, which then showed
 * them that teammate's full stats in the player portal. There's no data-model
 * link from a join code or invitation to a specific record, so only staff can
 * say which record is whose. Code-joined players still get their own record
 * automatically (ensurePlayerForMember).
 *
 * The caller has passed visibility + MANAGE_MEMBERS on teamId. The record must
 * be this team's own (its home team), unclaimed, and the target a member of
 * the team with no other record here.
 */
export async function linkPlayerRecord(teamId: string, playerId: string, userId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.teamId !== teamId) throw new AppError(404, 'Player not found.');
  const membership = await prisma.teamMembership.findUnique({ where: { userId_teamId: { userId, teamId } }, select: { id: true } });
  if (!membership) throw new AppError(400, 'Only a member of this team can be linked to one of its player records.');

  // Player.userId has no DB-level unique constraint, so the checks and the
  // write run as one serializable transaction: two staff linking at once can't
  // both claim the record or give one member two records.
  return runSerializable(async (tx) => {
    const current = await tx.player.findUniqueOrThrow({ where: { id: playerId }, select: { userId: true } });
    if (current.userId) throw new AppError(409, 'This player record is already linked to someone. Unlink it first.');
    const existing = await tx.player.findFirst({ where: { userId, teamId, NOT: { id: playerId } }, select: { id: true } });
    if (existing) throw new AppError(409, 'That member already has a player record on this team.');
    return tx.player.update({ where: { id: playerId }, data: { userId } });
  });
}

/** Staff unlink a roster record from whoever it's linked to. The record and its events stay. */
export async function unlinkPlayerRecord(teamId: string, playerId: string) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.teamId !== teamId) throw new AppError(404, 'Player not found.');
  if (!player.userId) throw new AppError(409, "This player record isn't linked to anyone.");
  return prisma.player.update({ where: { id: playerId }, data: { userId: null } });
}

export async function getPlayerCareerStats(userId: string) {
  const players = await prisma.player.findMany({ where: { userId }, select: { id: true } });
  if (!players.length) return null;

  const playerIds = players.map((p) => p.id);
  const events = await prisma.event.findMany({
    where: { playerId: { in: playerIds }, ...ownEventsOnly },
    select: { eventType: true },
  });

  return deriveStats(events);
}

export async function getPlayerRecentMatches(userId: string, limit = 5) {
  const players = await prisma.player.findMany({ where: { userId }, select: { id: true } });
  if (!players.length) return [];

  const playerIds = players.map((p) => p.id);

  // Get distinct match IDs from events for these players
  const matchEvents = await prisma.event.findMany({
    // ownEventsOnly excludes training events (matchId null), so every returned
    // matchId is a real match; the filter below narrows the type accordingly.
    where: { playerId: { in: playerIds }, ...ownEventsOnly },
    select: { matchId: true },
    distinct: ['matchId'],
  });

  const matchIds = matchEvents.map((e) => e.matchId).filter((id): id is string => id !== null);
  if (!matchIds.length) return [];

  return prisma.match.findMany({
    where: { id: { in: matchIds } },
    orderBy: { matchDate: 'desc' },
    take: limit,
    select: {
      id: true,
      matchDate: true,
      opponent: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeSetsWon: true,
      awaySetsWon: true,
      competition: true,
      team: { select: { id: true, name: true } },
    },
  });
}

export async function getDevelopmentMetrics(userId: string, matchCount = 5) {
  const players = await prisma.player.findMany({ where: { userId }, select: { id: true } });
  if (!players.length) return [];

  const playerIds = players.map((p) => p.id);

  // Get the most recent matches for these players
  const matchEvents = await prisma.event.findMany({
    // ownEventsOnly excludes training events (matchId null), so every returned
    // matchId is a real match; the filter below narrows the type accordingly.
    where: { playerId: { in: playerIds }, ...ownEventsOnly },
    select: { matchId: true },
    distinct: ['matchId'],
  });

  const matchIds = matchEvents.map((e) => e.matchId).filter((id): id is string => id !== null);
  if (!matchIds.length) return [];

  const recentMatches = await prisma.match.findMany({
    where: { id: { in: matchIds } },
    orderBy: { matchDate: 'desc' },
    take: matchCount,
    select: { id: true, opponent: true, matchDate: true },
  });

  // For each match, derive stats for these players
  const results = await Promise.all(
    recentMatches.map(async (match) => {
      const events = await prisma.event.findMany({
        where: { matchId: match.id, playerId: { in: playerIds }, ...ownEventsOnly },
        select: { eventType: true },
      });
      return {
        matchId: match.id,
        opponent: match.opponent,
        matchDate: match.matchDate,
        ...deriveStats(events),
      };
    }),
  );

  return results.reverse(); // chronological order
}

// Career-best single-match performances across all linked player records.
// null when the user has no linked players or no recorded matches.
export async function getPlayerBests(userId: string) {
  const players = await prisma.player.findMany({ where: { userId }, select: { id: true } });
  if (!players.length) return null;

  const playerIds = players.map((p) => p.id);

  const matchEvents = await prisma.event.findMany({
    // ownEventsOnly excludes training events (matchId null), so every returned
    // matchId is a real match; the filter below narrows the type accordingly.
    where: { playerId: { in: playerIds }, ...ownEventsOnly },
    select: { matchId: true },
    distinct: ['matchId'],
  });
  const matchIds = matchEvents.map((e) => e.matchId).filter((id): id is string => id !== null);
  if (!matchIds.length) return null;

  const matches = await prisma.match.findMany({
    where: { id: { in: matchIds } },
    select: { id: true, opponent: true, matchDate: true },
  });
  const matchInfo = new Map(matches.map((m) => [m.id, m]));

  // Derive per-match stat lines using the same derivation as the rest of the portal.
  const perMatch = await Promise.all(
    matchIds.map(async (matchId) => {
      const events = await prisma.event.findMany({
        where: { matchId, playerId: { in: playerIds }, ...ownEventsOnly },
        select: { eventType: true },
      });
      return { matchId, stats: deriveStats(events) };
    }),
  );

  type Best = { value: number; matchId: string; opponent: string; matchDate: Date } | null;

  function best(metric: (s: ReturnType<typeof deriveStats>) => number | null, minGuard?: (s: ReturnType<typeof deriveStats>) => boolean): Best {
    let top: Best = null;
    for (const { matchId, stats } of perMatch) {
      const value = metric(stats);
      if (value == null) continue;
      if (minGuard && !minGuard(stats)) continue;
      if (top === null || value > top.value) {
        const info = matchInfo.get(matchId);
        top = { value, matchId, opponent: info?.opponent ?? '', matchDate: info?.matchDate ?? new Date(0) };
      }
    }
    // A best of 0 is not a meaningful "best" — only report categories the player has actually scored in.
    return top && top.value > 0 ? top : null;
  }

  return {
    kills:  best((s) => s.kills),
    aces:   best((s) => s.aces),
    blocks: best((s) => s.totalBlocks),
    digs:   best((s) => s.digs),
    // Hitting percentage needs a minimum sample (5 attempts) to avoid 1-for-1 outliers.
    hittingPercentage: (() => {
      let top: Best = null;
      for (const { matchId, stats } of perMatch) {
        if (stats.hittingPercentage == null || stats.attackAttempts < 5) continue;
        if (top === null || stats.hittingPercentage > top.value) {
          const info = matchInfo.get(matchId);
          top = { value: stats.hittingPercentage, matchId, opponent: info?.opponent ?? '', matchDate: info?.matchDate ?? new Date(0) };
        }
      }
      return top;
    })(),
  };
}

// Per-team stat breakdown: one StatLine per linked player record, derived from
// that record's events only. A player on multiple teams has one entry per team.
export async function getPlayerStatsByTeam(userId: string) {
  const players = await prisma.player.findMany({
    where: { userId },
    select: {
      id: true,
      team: { select: { id: true, name: true, season: true } },
    },
  });
  if (!players.length) return [];

  return Promise.all(
    players.map(async (p) => {
      const events = await prisma.event.findMany({
        where: { playerId: p.id, ...ownEventsOnly },
        select: { eventType: true },
      });
      return {
        playerId: p.id,
        team: p.team,
        stats: deriveStats(events),
      };
    }),
  );
}

export async function getPlayerUpcomingMatches(userId: string, limit = 5) {
  const players = await prisma.player.findMany({
    where: { userId },
    select: { id: true, teamId: true },
  });
  if (!players.length) return [];

  // Teams from primary player records plus any explicit PlayerTeamLink teams.
  const links = await prisma.playerTeamLink.findMany({
    where: { playerId: { in: players.map((p) => p.id) } },
    select: { teamId: true },
  });
  const teamIds = [...new Set([...players.map((p) => p.teamId), ...links.map((l) => l.teamId)])];

  return prisma.match.findMany({
    where: {
      teamId: { in: teamIds },
      status: 'SCHEDULED',
      matchDate: { gte: new Date() },
    },
    orderBy: { matchDate: 'asc' },
    take: limit,
    select: {
      id: true,
      matchDate: true,
      opponent: true,
      competition: true,
      venue: true,
      team: { select: { id: true, name: true } },
    },
  });
}

export async function getPlayerDashboard(userId: string) {
  const [players, careerStats, recentMatches, developmentMetrics, upcomingMatches, statsByTeam] = await Promise.all([
    getLinkedPlayers(userId),
    getPlayerCareerStats(userId),
    getPlayerRecentMatches(userId),
    getDevelopmentMetrics(userId),
    getPlayerUpcomingMatches(userId),
    getPlayerStatsByTeam(userId),
  ]);

  return { players, careerStats, recentMatches, developmentMetrics, upcomingMatches, statsByTeam };
}
