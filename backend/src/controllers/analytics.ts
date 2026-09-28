import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { calculatePlayerStats, calculateSetStats, calculateStats } from '../lib/analytics';
import { ownEventsOnly } from '../lib/eventFilters';
import { generateMatchReport } from '../services/report.service';
import { assertTeamVisible } from '../lib/teamVisibility';
import { hasTeamPermission, isGlobalAdmin, Permission } from '../services/permission.service';

// ─── Shared query shapes ──────────────────────────────────────────────────────

const playerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  jerseyNumber: true,
  position: true,
  teamId: true,
} as const;

const eventSelect = {
  eventType: true,
  playerId: true,
  setNumber: true,
} as const;

// ─── Controllers — data fetch → service → respond ────────────────────────────

export async function getMatchAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      include: {
        team: { include: { players: { select: playerSelect, orderBy: { jerseyNumber: 'asc' } } } },
        events: { where: ownEventsOnly, select: eventSelect },
      },
    });
    if (!match) throw new AppError(404, 'Match not found.');
    res.json({
      match: {
        id: match.id, matchDate: match.matchDate, opponent: match.opponent,
        competition: match.competition, venue: match.venue, status: match.status,
        setScores: match.setScores, teamId: match.teamId, teamName: match.team.name,
        homeScore: match.homeScore, awayScore: match.awayScore,
        homeSetsWon: match.homeSetsWon, awaySetsWon: match.awaySetsWon,
      },
      teamStats:   calculateStats(match.events),
      playerStats: calculatePlayerStats(match.team.players, match.events),
      setStats:    calculateSetStats(match.events),
    });
  } catch (err) { next(err); }
}

export async function getTeamAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.params.teamId },
      include: {
        players: { select: playerSelect, orderBy: { jerseyNumber: 'asc' } },
        matches: { select: { id: true, status: true, setScores: true } },
      },
    });
    if (!team) throw new AppError(404, 'Team not found.');
    const events = await prisma.event.findMany({ where: { match: { teamId: team.id }, ...ownEventsOnly }, select: eventSelect });
    res.json({
      team: { id: team.id, name: team.name, division: team.division, season: team.season },
      matchSummary: {
        total: team.matches.length,
        completed:  team.matches.filter((m) => m.status === 'COMPLETED').length,
        inProgress: team.matches.filter((m) => m.status === 'IN_PROGRESS').length,
        scheduled:  team.matches.filter((m) => m.status === 'SCHEDULED').length,
      },
      teamStats:   calculateStats(events),
      playerStats: calculatePlayerStats(team.players, events),
    });
  } catch (err) { next(err); }
}

export async function getTeamTrends(req: Request, res: Response, next: NextFunction) {
  try {
    const matches = await prisma.match.findMany({
      where: { teamId: req.params.teamId, status: 'COMPLETED' },
      orderBy: { matchDate: 'asc' },
      include: { events: { where: ownEventsOnly, select: eventSelect } },
    });
    res.json(matches.map((m) => {
      const s = calculateStats(m.events);
      return { matchId: m.id, opponent: m.opponent, matchDate: m.matchDate,
               kills: s.kills, aces: s.aces, blocks: s.totalBlocks, digs: s.digs,
               hittingPercentage: s.hittingPercentage };
    }));
  } catch (err) { next(err); }
}

export async function getMatchReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchId } = req.params;
    const [match, events, players] = await Promise.all([
      prisma.match.findUnique({ where: { id: matchId }, include: { team: { select: { name: true } } } }),
      prisma.event.findMany({
        where: { matchId, ...ownEventsOnly },
        select: { eventType: true, setNumber: true, courtZone: true, rotationNumber: true, playerId: true, recordedAt: true },
        orderBy: { recordedAt: 'asc' },
      }),
      prisma.player.findMany({
        where: { team: { matches: { some: { id: matchId } } } },
        select: { id: true, firstName: true, lastName: true, jerseyNumber: true, position: true },
      }),
    ]);
    if (!match) throw new AppError(404, 'Match not found.');
    res.json(generateMatchReport(
      { teamName: match.team.name, opponent: match.opponent,
        homeSetsWon: match.homeSetsWon, awaySetsWon: match.awaySetsWon,
        setScores: match.setScores },
      events,
      players,
    ));
  } catch (err) { next(err); }
}

/**
 * One player's individual stats, scoped to ONE team (?teamId, defaulting to
 * the home team): only that team's matches count, whatever other teams the
 * player is linked to. Individual stats go to that team's staff (TRACK_MATCH),
 * a global admin, or the player themself; teammates and viewers get the
 * team-level views only (Karlos, 28 Sept - players can be minors).
 */
export async function getPlayerAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId ?? null;
    const found = await prisma.player.findUnique({ where: { id: req.params.playerId }, select: { ...playerSelect, userId: true } });
    if (!found) throw new AppError(404, 'Player not found.');
    const { userId: linkedUserId, ...player } = found;

    const teamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : player.teamId;
    await assertTeamVisible(teamId, userId); // 404 for outsiders and anonymous callers

    // The player must play for the team in scope: home team or a PlayerTeamLink
    // (the same rule recordEvent uses to attribute a stat).
    const onTeam = player.teamId === teamId
      || !!(await prisma.playerTeamLink.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId } } }));
    if (!onTeam) throw new AppError(404, 'Player not found.');

    const allowed = linkedUserId === userId
      || await hasTeamPermission(userId!, teamId, Permission.TRACK_MATCH)
      || await isGlobalAdmin(userId!);
    if (!allowed) throw new AppError(403, "Only this team's coaching staff and the player can see individual stats.");

    const matchId = typeof req.query.matchId === 'string' && req.query.matchId ? req.query.matchId : undefined;
    if (matchId) {
      const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
      if (match?.teamId !== teamId) throw new AppError(404, 'Match not found.');
    }

    const events = await prisma.event.findMany({
      where: { playerId: player.id, match: { teamId }, ...(matchId ? { matchId } : {}), ...ownEventsOnly },
      select: eventSelect,
    });
    // player.teamId is the team in scope: the home team may be one this caller
    // can't see (a linked team's staff), and its id must not leak.
    res.json({ player: { ...player, teamId }, teamId, matchId: matchId ?? null, stats: calculateStats(events), setStats: calculateSetStats(events) });
  } catch (err) { next(err); }
}
