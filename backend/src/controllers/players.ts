import { Request, Response, NextFunction } from 'express';
import { AccessTier, ApprovalAction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { getAccessTier } from '../services/permission.service';
import { createApprovalRequest } from '../services/approval.service';
import { applyCreatePlayer, applyUpdatePlayer, applyDeletePlayer } from '../services/playerActions.service';
import { logAudit } from '../lib/audit';

// Response body when a non-head-coach action is queued for approval.
const pending = (requestId: string) => ({ status: 'pending_approval' as const, requestId });

export async function getPlayersByTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const players = await prisma.player.findMany({
      where: { teamId: req.params.teamId },
      orderBy: { jerseyNumber: 'asc' },
    });
    res.json(players);
  } catch (err) {
    next(err);
  }
}

export async function getPlayer(req: Request, res: Response, next: NextFunction) {
  try {
    const player = await prisma.player.findUnique({
      where: { id: req.params.id },
      include: { team: true },
    });
    if (!player) throw new AppError(404, 'Player not found.');
    res.json(player);
  } catch (err) {
    next(err);
  }
}

export async function createPlayer(req: Request, res: Response, next: NextFunction) {
  try {
    const { firstName, lastName, jerseyNumber, position, teamId } = req.body;
    if (!firstName || !lastName || !jerseyNumber || !position || !teamId) {
      throw new AppError(400, 'All player fields are required.');
    }
    const userId = req.user!.userId;

    // Roster access tier decides immediate vs queued. VIEW_ONLY/non-member is
    // already 403'd by requireRosterAccess, so here it's FULL vs APPROVAL.
    if ((await getAccessTier(userId, teamId, 'roster')) === AccessTier.FULL_ACCESS) {
      const player = await applyCreatePlayer({ firstName, lastName, jerseyNumber, position, teamId });
      logAudit(userId, 'CREATE_PLAYER', 'player', player.id);
      return res.status(201).json(player);
    }

    const request = await createApprovalRequest({
      teamId, requestedById: userId, action: ApprovalAction.PLAYER_CREATE,
      payload: { firstName, lastName, jerseyNumber: Number(jerseyNumber), position, teamId },
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}

export async function updatePlayer(req: Request, res: Response, next: NextFunction) {
  try {
    const { firstName, lastName, jerseyNumber, position } = req.body;
    const player = await prisma.player.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!player) throw new AppError(404, 'Player not found.');
    const userId = req.user!.userId;

    if ((await getAccessTier(userId, player.teamId, 'roster')) === AccessTier.FULL_ACCESS) {
      const updated = await applyUpdatePlayer(req.params.id, { firstName, lastName, jerseyNumber, position });
      logAudit(userId, 'UPDATE_PLAYER', 'player', req.params.id);
      return res.json(updated);
    }

    const request = await createApprovalRequest({
      teamId: player.teamId, requestedById: userId, action: ApprovalAction.PLAYER_UPDATE,
      targetId: req.params.id,
      payload: { firstName, lastName, jerseyNumber, position },
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}

export async function deletePlayer(req: Request, res: Response, next: NextFunction) {
  try {
    const player = await prisma.player.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!player) throw new AppError(404, 'Player not found.');
    const userId = req.user!.userId;

    if ((await getAccessTier(userId, player.teamId, 'roster')) === AccessTier.FULL_ACCESS) {
      await applyDeletePlayer(req.params.id);
      logAudit(userId, 'DELETE_PLAYER', 'player', req.params.id);
      return res.status(204).send();
    }

    const request = await createApprovalRequest({
      teamId: player.teamId, requestedById: userId, action: ApprovalAction.PLAYER_DELETE,
      targetId: req.params.id, payload: {},
    });
    res.status(202).json(pending(request.id));
  } catch (err) {
    next(err);
  }
}
