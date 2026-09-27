import { Request, Response, NextFunction } from 'express';
import { AccessTier, TeamRole } from '@prisma/client';
import { logAudit } from '../lib/audit';
import {
  getTeamJoinCodes,
  regenerateTeamJoinCode as regenerateCode,
  redeemTeamJoinCode as redeemCode,
  lookupCode,
  TeamJoinCodeKind,
} from '../services/teamJoinCode.service';
import { getAccessTier } from '../services/permission.service';

export async function listTeamJoinCodes(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getTeamJoinCodes(req.params.id));
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function regenerateTeamJoinCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: teamId } = req.params;
    const { kind } = req.body as { kind?: TeamJoinCodeKind };
    if (kind !== 'PLAYER' && kind !== 'STAFF') {
      return res.status(400).json({ error: "kind must be 'PLAYER' or 'STAFF'" });
    }
    const userId = req.user!.userId;

    // Regeneration is immediate-only: there is no ApprovalAction for it, so
    // unlike invitation creation nothing can be queued — APPROVAL_REQUIRED
    // members are simply not allowed.
    if ((await getAccessTier(userId, teamId, 'invitation')) !== AccessTier.FULL_ACCESS) {
      return res.status(403).json({ error: 'You do not have permission to regenerate join codes.' });
    }

    const code = await regenerateCode(teamId, kind);
    logAudit(userId, 'REGENERATE_TEAM_CODE', 'team', teamId, { kind });
    res.json({ kind, code });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function lookupCodeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await lookupCode(req.params.code));
  } catch (err) {
    next(err);
  }
}

export async function redeemTeamJoinCodeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, role } = req.body as { code?: string; role?: TeamRole };
    if (!code || !code.trim()) return res.status(400).json({ error: 'A join code is required.' });
    const userId = req.user!.userId;
    const result = await redeemCode(code, userId, role);
    logAudit(userId, 'REDEEM_TEAM_CODE', 'team', result.team.id, { kind: result.kind, role: result.role });
    res.json(result);
  } catch (err: any) {
    // .code (e.g. EMAIL_NOT_VERIFIED) must survive this shortcut path exactly
    // like it does through the shared errorHandler.
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
}
