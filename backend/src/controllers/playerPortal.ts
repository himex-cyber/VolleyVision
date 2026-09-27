import { Request, Response, NextFunction } from 'express';
import {
  getPlayerDashboard,
  getPlayerCareerStats,
  getPlayerBests,
  getLinkedPlayers,
  linkPlayerToUser,
  unlinkPlayer,
} from '../services/playerPortal.service';

export async function playerDashboardHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const dashboard = await getPlayerDashboard(req.user!.userId);
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

export async function linkPlayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { playerId } = req.body as { playerId: string };
    if (!playerId) return res.status(400).json({ error: 'playerId is required' });
    const player = await linkPlayerToUser(playerId, req.user!.userId);
    res.json(player);
  } catch (err) {
    next(err);
  }
}

export async function unlinkPlayerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const player = await unlinkPlayer(req.params.playerId, req.user!.userId);
    res.json(player);
  } catch (err) {
    next(err);
  }
}
