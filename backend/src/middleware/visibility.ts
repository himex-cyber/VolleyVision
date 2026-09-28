import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { assertTeamVisible } from '../lib/teamVisibility';

/**
 * Middleware guarding team-scoped read endpoints against private-team access.
 *
 * Pair each variant with `optionalAuth` earlier in the chain so req.user is
 * populated when a valid token is present (the check needs to distinguish
 * "no token" from "wrong user"). On a hidden/absent team the underlying
 * assertTeamVisible throws AppError(404), which the error handler returns —
 * so callers can't tell a private team apart from a non-existent one.
 */

function userId(req: Request): string | null {
  return req.user?.userId ?? null;
}

/** Team id is directly in req.params[paramName] (default "teamId"). */
export function visibleByTeamParam(paramName = 'teamId') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await assertTeamVisible(req.params[paramName], userId(req));
      next();
    } catch (err) { next(err); }
  };
}

/** Team id resolved from a match id in req.params[paramName] (default "matchId"). */
export function visibleByMatchParam(paramName = 'matchId') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const match = await prisma.match.findUnique({
        where: { id: req.params[paramName] },
        select: { teamId: true },
      });
      // Missing match → 404 via a teamId that can never be visible.
      await assertTeamVisible(match?.teamId ?? '__none__', userId(req), 'Match not found.');
      next();
    } catch (err) { next(err); }
  };
}

/** Team id resolved from a player id in req.params[paramName] (default "playerId"). */
export function visibleByPlayerParam(paramName = 'playerId') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const player = await prisma.player.findUnique({
        where: { id: req.params[paramName] },
        select: { teamId: true },
      });
      await assertTeamVisible(player?.teamId ?? '__none__', userId(req), 'Player not found.');
      next();
    } catch (err) { next(err); }
  };
}
