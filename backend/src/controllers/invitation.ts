import { Request, Response, NextFunction } from 'express';
import { AccessTier, ApprovalAction, TeamRole } from '@prisma/client';
import { logAudit } from '../lib/audit';
import {
  acceptInvitation,
  declineInvitation,
  redeemInvitationByCode,
  getTeamInvitations,
  getUserInvitations,
} from '../services/invitation.service';
import { getAccessTier } from '../services/permission.service';
import { createApprovalRequest } from '../services/approval.service';
import { applyCreateInvitation } from '../services/teamActions.service';

export async function createTeamInvitation(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: teamId } = req.params;
    const { email, role } = req.body as { email: string; role: TeamRole };
    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }
    const userId = req.user!.userId;

    // Invitation access tier decides immediate vs queued (VIEW_ONLY/non-member
    // already 403'd by the route guard).
    if ((await getAccessTier(userId, teamId, 'invitation')) === AccessTier.FULL_ACCESS) {
      const inv = await applyCreateInvitation({ teamId, invitedById: userId, email, role });
      logAudit(userId, 'CREATE_INVITATION', 'invitation', inv.id, { teamId, email, role });
      return res.status(201).json(inv);
    }

    const request = await createApprovalRequest({
      teamId, requestedById: userId, action: ApprovalAction.INVITATION_CREATE,
      payload: { teamId, invitedById: userId, email, role },
    });
    res.status(202).json({ status: 'pending_approval', requestId: request.id });
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function listTeamInvitations(req: Request, res: Response, next: NextFunction) {
  try {
    const invitations = await getTeamInvitations(req.params.id, req.user!.userId);
    res.json(invitations);
  } catch (err) {
    next(err);
  }
}

export async function acceptInvitationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await acceptInvitation(req.params.token, req.user!.userId);
    logAudit(req.user!.userId, 'ACCEPT_INVITATION', 'invitation', result.id);
    res.json(result);
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function redeemInvitationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = req.body as { code?: string };
    if (!code || !code.trim()) return res.status(400).json({ error: 'A join code is required.' });
    const result = await redeemInvitationByCode(code, req.user!.userId);
    logAudit(req.user!.userId, 'REDEEM_INVITATION', 'invitation', result.id);
    res.json(result);
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function declineInvitationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await declineInvitation(req.params.token, req.user!.userId);
    res.json(result);
  } catch (err: any) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
}

export async function myInvitations(req: Request, res: Response, next: NextFunction) {
  try {
    const { prisma } = await import('../lib/prisma');
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const invitations = await getUserInvitations(user.email);
    res.json(invitations);
  } catch (err) {
    next(err);
  }
}
