import { prisma } from '../lib/prisma';
import { MatchStatus } from '@prisma/client';
import { maskOwner } from '../lib/playerPrivacy';
import { Permission, roleHasPermission } from '../lib/rolePermissions';

const teamSummaryInclude = {
  _count: { select: { players: true, matches: true } },
} as const;

export async function getCoachOwnedTeams(userId: string) {
  return prisma.team.findMany({
    where: { ownerId: userId },
    include: teamSummaryInclude,
    orderBy: { name: 'asc' },
  });
}

export async function getCoachMemberTeams(userId: string) {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, team: { ownerId: { not: userId } } },
    include: {
      team: { include: teamSummaryInclude },
    },
    orderBy: { joinedAt: 'desc' },
  });
  // Owner id only for members who manage the roster (9.0.2); never the owner here.
  return memberships.map((m) => ({
    ...maskOwner(m.team, roleHasPermission(m.role, Permission.MANAGE_MEMBERS), userId),
    memberRole: m.role,
  }));
}

export async function getCoachingStats(userId: string) {
  // All team IDs the coach owns or is a member of
  const [ownedTeams, memberships] = await Promise.all([
    prisma.team.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true } }),
  ]);

  const teamIds = [
    ...new Set([...ownedTeams.map((t) => t.id), ...memberships.map((m) => m.teamId)]),
  ];

  if (!teamIds.length) {
    return { teamsOwned: 0, teamsCoached: 0, totalMatches: 0, wins: 0, losses: 0, winPercentage: null };
  }

  const matches = await prisma.match.findMany({
    where: { teamId: { in: teamIds }, status: MatchStatus.COMPLETED },
    select: { homeSetsWon: true, awaySetsWon: true },
  });

  const wins = matches.filter((m) => m.homeSetsWon > m.awaySetsWon).length;
  const losses = matches.length - wins;

  return {
    teamsOwned: ownedTeams.length,
    teamsCoached: teamIds.length,
    totalMatches: matches.length,
    wins,
    losses,
    winPercentage: matches.length > 0 ? Math.round((wins / matches.length) * 100) : null,
  };
}

export async function getCoachRecentMatches(userId: string, limit = 5) {
  const [ownedTeams, memberships] = await Promise.all([
    prisma.team.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true } }),
  ]);

  const teamIds = [
    ...new Set([...ownedTeams.map((t) => t.id), ...memberships.map((m) => m.teamId)]),
  ];

  if (!teamIds.length) return [];

  return prisma.match.findMany({
    where: { teamId: { in: teamIds } },
    orderBy: { matchDate: 'desc' },
    take: limit,
    select: {
      id: true,
      matchDate: true,
      opponent: true,
      status: true,
      homeSetsWon: true,
      awaySetsWon: true,
      competition: true,
      team: { select: { id: true, name: true } },
    },
  });
}

// The soonest scheduled match of EACH team the user owns or belongs to: the
// home page's team cards show one per team, and a global "5 soonest" list
// left a team whose next match wasn't among them showing none.
export async function getCoachUpcomingMatches(userId: string, from: Date = new Date()) {
  const [ownedTeams, memberships] = await Promise.all([
    prisma.team.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true } }),
  ]);

  const teamIds = [
    ...new Set([...ownedTeams.map((t) => t.id), ...memberships.map((m) => m.teamId)]),
  ];

  if (!teamIds.length) return [];

  return prisma.match.findMany({
    where: {
      teamId: { in: teamIds },
      status: MatchStatus.SCHEDULED,
      matchDate: { gte: from },
    },
    orderBy: { matchDate: 'asc' },
    distinct: ['teamId'],
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

/** `from`: see lib/matchDate upcomingFrom. */
export async function getCoachDashboard(userId: string, from?: Date) {
  const [ownedTeams, memberTeams, coachingStats, recentMatches, upcomingMatches] = await Promise.all([
    getCoachOwnedTeams(userId),
    getCoachMemberTeams(userId),
    getCoachingStats(userId),
    getCoachRecentMatches(userId),
    getCoachUpcomingMatches(userId, from),
  ]);

  return { ownedTeams, memberTeams, coachingStats, recentMatches, upcomingMatches };
}
