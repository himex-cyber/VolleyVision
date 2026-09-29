import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { calculatePlayerStats, calculateSetStats, calculateStats } from '../lib/analytics';
import { ownEventsOnly, teamEventsWithOpponent } from '../lib/eventFilters';
import { generateMatchReport } from '../services/report.service';
import { assertTeamVisible } from '../lib/teamVisibility';
import { seesEveryPlayer } from '../services/permission.service';
import { visiblePlayers } from '../lib/playerPrivacy';
import { buildDetailedHeatmap } from '../lib/heatmap';
import { buildAdvancedMetrics } from '../lib/advancedMetrics';
import { calculateRotations } from '../services/rotation.service';
import { calculateMomentum } from '../services/momentum.service';

// ─── Shared query shapes ──────────────────────────────────────────────────────

const playerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  jerseyNumber: true,
  position: true,
  teamId: true,
} as const;

// userId is read only to apply the per-player rule; visiblePlayers strips it.
const playerWithUser = { ...playerSelect, userId: true } as const;

// No zone filter: buildDetailedHeatmap counts the untagged rows for coverage.
const zoneSelect = { courtZone: true, eventType: true } as const;

const eventSelect = {
  eventType: true,
  playerId: true,
  setNumber: true,
} as const;

// ─── Controllers — data fetch → service → respond ────────────────────────────

export async function getMatchAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId ?? null;
    const [match, isStaff] = await Promise.all([
      prisma.match.findUnique({
        where: { id: req.params.matchId },
        include: {
          team: { include: { players: { select: playerWithUser, orderBy: { jerseyNumber: 'asc' } } } },
          events: { where: ownEventsOnly, select: eventSelect },
        },
      }),
      seesEveryPlayer(userId, res.locals.visibleTeamId), // set by visibleByMatchParam
    ]);
    if (!match) throw new AppError(404, 'Match not found.');
    const players = visiblePlayers(match.team.players, isStaff, userId);
    res.json({
      match: {
        id: match.id, matchDate: match.matchDate, opponent: match.opponent,
        competition: match.competition, venue: match.venue, status: match.status,
        setScores: match.setScores, teamId: match.teamId, teamName: match.team.name,
        homeScore: match.homeScore, awayScore: match.awayScore,
        homeSetsWon: match.homeSetsWon, awaySetsWon: match.awaySetsWon,
      },
      teamStats:   calculateStats(match.events),
      playerStats: calculatePlayerStats(players, match.events),
      setStats:    calculateSetStats(match.events),
    });
  } catch (err) { next(err); }
}

export async function getTeamAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId ?? null;
    const { teamId } = req.params;
    const [team, events, isStaff] = await Promise.all([
      prisma.team.findUnique({
        where: { id: teamId },
        include: {
          players: { select: playerWithUser, orderBy: { jerseyNumber: 'asc' } },
          matches: { select: { id: true, status: true, setScores: true } },
        },
      }),
      prisma.event.findMany({ where: { match: { teamId }, ...ownEventsOnly }, select: eventSelect }),
      seesEveryPlayer(userId, teamId),
    ]);
    if (!team) throw new AppError(404, 'Team not found.');
    const players = visiblePlayers(team.players, isStaff, userId);
    res.json({
      team: { id: team.id, name: team.name, division: team.division, season: team.season },
      matchSummary: {
        total: team.matches.length,
        completed:  team.matches.filter((m) => m.status === 'COMPLETED').length,
        inProgress: team.matches.filter((m) => m.status === 'IN_PROGRESS').length,
        scheduled:  team.matches.filter((m) => m.status === 'SCHEDULED').length,
      },
      teamStats:   calculateStats(events),
      playerStats: calculatePlayerStats(players, events),
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

// Point-flow analytics (momentum, rotations, side-out) need the opponent's
// events too, and never a player: team-level for every member.
const pointEventSelect = {
  eventType: true, isOpponentEvent: true, setNumber: true, rotationNumber: true, servingSide: true, recordedAt: true,
} as const;

export async function getMatchReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchId } = req.params;
    const [match, events, pointEvents, players, isStaff] = await Promise.all([
      prisma.match.findUnique({ where: { id: matchId }, include: { team: { select: { name: true } } } }),
      prisma.event.findMany({
        where: { matchId, ...ownEventsOnly },
        select: { eventType: true, setNumber: true, courtZone: true, rotationNumber: true, playerId: true, recordedAt: true },
        orderBy: { recordedAt: 'asc' },
      }),
      // Momentum and best rotation only (7.10): the opponent's points count there.
      prisma.event.findMany({ where: { matchId, ...teamEventsWithOpponent }, select: pointEventSelect }),
      prisma.player.findMany({
        where: { team: { matches: { some: { id: matchId } } } },
        select: { id: true, firstName: true, lastName: true, jerseyNumber: true, position: true },
      }),
      seesEveryPlayer(req.user?.userId ?? null, res.locals.visibleTeamId), // set by visibleByMatchParam
    ]);
    if (!match) throw new AppError(404, 'Match not found.');
    const report = generateMatchReport(
      { teamName: match.team.name, opponent: match.opponent,
        homeSetsWon: match.homeSetsWon, awaySetsWon: match.awaySetsWon,
        setScores: match.setScores },
      events,
      players,
      pointEvents,
    );
    // The top performer names one player; the rest of the report is team-level.
    if (!isStaff) report.topPerformer = null;
    res.json(report);
  } catch (err) { next(err); }
}

/**
 * Which player, on which team, and optionally which match, a per-player read is
 * about, or the same AppErrors as before. Individual numbers are scoped to ONE
 * team (?teamId, defaulting to the home team): only that team's matches count,
 * whatever other teams the player is linked to. They go to that team's staff
 * (TRACK_MATCH), a global admin, or the player themself; teammates and viewers
 * get the team-level views only (Karlos, 28 Sept - players can be minors).
 * Shared by the player's stats and zone map.
 */
async function resolvePlayerScope(req: Request) {
  const userId = req.user?.userId ?? null;
  const found = await prisma.player.findUnique({ where: { id: req.params.playerId }, select: playerWithUser });
  if (!found) throw new AppError(404, 'Player not found.');
  const { userId: linkedUserId, ...player } = found;

  const teamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : player.teamId;
  await assertTeamVisible(teamId, userId, 'Player not found.'); // 404 for outsiders and anonymous callers

  // The player must play for the team in scope: home team or a PlayerTeamLink
  // (the same rule recordEvent uses to attribute a stat).
  const onTeam = player.teamId === teamId
    || !!(await prisma.playerTeamLink.findUnique({ where: { playerId_teamId: { playerId: player.id, teamId } } }));
  if (!onTeam) throw new AppError(404, 'Player not found.');

  const allowed = linkedUserId === userId || await seesEveryPlayer(userId, teamId);
  if (!allowed) throw new AppError(403, "Only this team's coaching staff and the player can see individual stats.");

  const matchId = typeof req.query.matchId === 'string' && req.query.matchId ? req.query.matchId : undefined;
  if (matchId) {
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
    if (match?.teamId !== teamId) throw new AppError(404, 'Match not found.');
  }
  return { player, teamId, matchId };
}

/** One player's individual stats for the team in scope (see resolvePlayerScope). */
export async function getPlayerAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    const { player, teamId, matchId } = await resolvePlayerScope(req);
    const events = await prisma.event.findMany({
      where: { playerId: player.id, match: { teamId }, ...(matchId ? { matchId } : {}), ...ownEventsOnly },
      select: eventSelect,
    });
    // player.teamId is the team in scope: the home team may be one this caller
    // can't see (a linked team's staff), and its id must not leak.
    res.json({ player: { ...player, teamId }, teamId, matchId: matchId ?? null, stats: calculateStats(events), setStats: calculateSetStats(events) });
  } catch (err) { next(err); }
}

// ─── Court-zone maps ──────────────────────────────────────────────────────────

/** Team-level: every member of the match's team (mVis runs first). */
export async function getMatchZones(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await prisma.event.findMany({ where: { matchId: req.params.matchId, ...ownEventsOnly }, select: zoneSelect });
    res.json(buildDetailedHeatmap(events));
  } catch (err) { next(err); }
}

/** Team-level, across the team's matches: every member (tVis runs first). */
export async function getTeamZones(req: Request, res: Response, next: NextFunction) {
  try {
    const events = await prisma.event.findMany({ where: { match: { teamId: req.params.teamId }, ...ownEventsOnly }, select: zoneSelect });
    res.json(buildDetailedHeatmap(events));
  } catch (err) { next(err); }
}

/** One player's map on the team in scope: staff, admin or the player (resolvePlayerScope). */
export async function getPlayerZones(req: Request, res: Response, next: NextFunction) {
  try {
    const { player, teamId, matchId } = await resolvePlayerScope(req);
    const events = await prisma.event.findMany({
      where: { playerId: player.id, match: { teamId }, ...(matchId ? { matchId } : {}), ...ownEventsOnly },
      select: zoneSelect,
    });
    res.json(buildDetailedHeatmap(events));
  } catch (err) { next(err); }
}

// ─── Point flow: rotations, momentum, advanced metrics (7.8) ─────────────────
// Team-level, no per-player rows, for every member (the visibility guard runs
// first, in the router). Point flow reads the opponent's events too.

type EventWhere = { matchId: string } | { match: { teamId: string } };

async function pointEvents(where: EventWhere) {
  return prisma.event.findMany({ where: { ...where, ...teamEventsWithOpponent }, select: pointEventSelect });
}

async function advancedFor(where: EventWhere) {
  const [own, points] = await Promise.all([
    prisma.event.findMany({ where: { ...where, ...ownEventsOnly }, select: { eventType: true, setNumber: true } }),
    pointEvents(where),
  ]);
  return buildAdvancedMetrics(own, points);
}

export async function getMatchRotations(req: Request, res: Response, next: NextFunction) {
  try { res.json(calculateRotations(await pointEvents({ matchId: req.params.matchId }))); } catch (err) { next(err); }
}

export async function getTeamRotations(req: Request, res: Response, next: NextFunction) {
  try { res.json(calculateRotations(await pointEvents({ match: { teamId: req.params.teamId } }))); } catch (err) { next(err); }
}

export async function getMatchMomentum(req: Request, res: Response, next: NextFunction) {
  try { res.json(calculateMomentum(await pointEvents({ matchId: req.params.matchId }))); } catch (err) { next(err); }
}

export async function getMatchAdvanced(req: Request, res: Response, next: NextFunction) {
  try { res.json(await advancedFor({ matchId: req.params.matchId })); } catch (err) { next(err); }
}

export async function getTeamAdvanced(req: Request, res: Response, next: NextFunction) {
  try { res.json(await advancedFor({ match: { teamId: req.params.teamId } })); } catch (err) { next(err); }
}
