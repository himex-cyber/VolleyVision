import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { isTeamVisibleTo, assertTeamVisible } from '../lib/teamVisibility';
import { Permission, hasTeamPermission } from '../services/permission.service';

// GET /players/:playerId/teams
// Returns the player's home team plus all additional linked teams.
export async function getPlayerTeams(req: Request, res: Response, next: NextFunction) {
  try {
    const player = await prisma.player.findUnique({
      where: { id: req.params.playerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        team: { select: { id: true, name: true, division: true, season: true } },
        teamLinks: {
          select: {
            id: true,
            createdAt: true,
            team: { select: { id: true, name: true, division: true, season: true } },
          },
        },
      },
    });
    if (!player) throw new AppError(404, 'Player not found.');

    // visibleByPlayerParam upstream only clears the player's HOME team, which
    // says nothing about the teams they are *linked* to. Without this filter a
    // home-team member reads back the id and name of every private team the
    // player belongs to, holding no membership on any of them.
    // ponytail: one visibility lookup per link, sequentially fanned out. A
    // player has a handful of links; batch the membership query if that ever
    // grows into a page of teams.
    const viewerId = req.user?.userId ?? null;
    const visible = await Promise.all(player.teamLinks.map((l) => isTeamVisibleTo(l.team.id, viewerId)));

    res.json({
      homeTeam: player.team,
      linkedTeams: player.teamLinks
        .filter((_, i) => visible[i])
        .map((l) => ({ linkId: l.id, team: l.team, linkedAt: l.createdAt })),
    });
  } catch (err) { next(err); }
}

// POST /players/:playerId/team-links
// Body: { teamId }
// Requires the caller to have MANAGE_TEAM on the target team (checked upstream via middleware).
export async function addPlayerTeamLink(req: Request, res: Response, next: NextFunction) {
  try {
    const { playerId } = req.params;
    const { teamId } = req.body as { teamId?: string };
    if (!teamId) throw new AppError(400, 'teamId is required.');

    const player = await prisma.player.findUnique({ where: { id: playerId }, select: { id: true, teamId: true } });
    if (!player) throw new AppError(404, 'Player not found.');

    // M2: the route only checked MANAGE_TEAM on the *target* team (the one
    // being linked into) — the caller could link in any player id, including
    // one on a home team they have no relationship to, exposing that team's
    // roster into a team they do control. Require the same visibility +
    // manage permission on the player's home team too.
    await assertTeamVisible(player.teamId, req.user?.userId ?? null);
    const canManageHomeTeam = await hasTeamPermission(req.user!.userId, player.teamId, Permission.MANAGE_TEAM);
    if (!canManageHomeTeam) throw new AppError(403, 'You do not have permission to manage this player\'s team.');

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new AppError(404, 'Team not found.');

    const link = await prisma.playerTeamLink.create({
      data: { playerId, teamId },
      include: { team: { select: { id: true, name: true, division: true, season: true } } },
    });
    res.status(201).json(link);
  } catch (err: any) {
    // Unique constraint violation — link already exists
    if (err?.code === 'P2002') {
      next(new AppError(409, 'Player is already linked to this team.'));
    } else {
      next(err);
    }
  }
}

// DELETE /players/:playerId/team-links/:teamId
export async function removePlayerTeamLink(req: Request, res: Response, next: NextFunction) {
  try {
    const { playerId, teamId } = req.params;

    const link = await prisma.playerTeamLink.findUnique({
      where: { playerId_teamId: { playerId, teamId } },
    });
    if (!link) throw new AppError(404, 'Team link not found.');

    await prisma.playerTeamLink.delete({ where: { playerId_teamId: { playerId, teamId } } });
    res.status(204).send();
  } catch (err) { next(err); }
}
