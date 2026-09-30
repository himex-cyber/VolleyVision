import { Request, Response, NextFunction } from 'express';
import {
  getPlayerDashboard,
  getPlayerCareerStats,
  getPlayerBests,
  getLinkedPlayers,
} from '../services/playerPortal.service';
import { AppError } from '../middleware/errorHandler';
import { upcomingFrom } from '../lib/matchDate';

export async function playerDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const dashboard = await getPlayerDashboard(req.user!.userId, upcomingFrom(req.query.localNow));
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
}

export async function playerStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await getPlayerCareerStats(req.user!.userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function playerBestsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const bests = await getPlayerBests(req.user!.userId);
    res.json(bests);
  } catch (err) {
    next(err);
  }
}

export async function playerTeamsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const players = await getLinkedPlayers(req.user!.userId);
    res.json(players);
  } catch (err) {
    next(err);
  }
}

// Players no longer claim or unlink records themselves (4.0.2): staff assign
// them on the roster (POST/DELETE /teams/:id/players/:playerId/link). The
// routes stay so an older client gets a message it can show.
const ASK_YOUR_COACH = 'Ask your coach to link your player record.';

export function linkPlayerHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(403, ASK_YOUR_COACH));
}

export function unlinkPlayerHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(403, ASK_YOUR_COACH));
}
