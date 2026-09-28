import { Request, Response, NextFunction } from 'express';
import { AccessTier, TeamRole } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import {
  getTeamMembers,
  getUserTeams,
  updateMemberRole,
  updateMemberAccess,
  removeMember,
  findTeamMembership,
} from '../services/teamMembership.service';
import { linkPlayerRecord, unlinkPlayerRecord } from '../services/playerPortal.service';
import { canManageMembers } from '../services/permission.service';

// HEAD_COACH is deliberately absent: it only changes via ownership transfer.
const VALID_ROLES = new Set<string>([
  'MANAGER', 'ASSISTANT_COACH', 'STATISTICIAN', 'PLAYER', 'VIEWER',
]);

const VALID_TIERS = new Set<string>(['VIEW_ONLY', 'APPROVAL_REQUIRED', 'FULL_ACCESS']);

function parseRole(value: unknown): TeamRole {
  if (typeof value !== 'string' || !VALID_ROLES.has(value)) {
    throw new AppError(400, `role must be one of: ${[...VALID_ROLES].join(', ')}.`);
  }
  return value as TeamRole;
}

function parseTier(value: unknown): AccessTier {
  if (typeof value !== 'string' || !VALID_TIERS.has(value)) {
    throw new AppError(400, `access tier must be one of: ${[...VALID_TIERS].join(', ')}.`);
  }
  return value as AccessTier;
}

/** GET /api/v1/teams/:id/members */
export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const members = await getTeamMembers(req.params.id);
    // Emails are contact details — many players are minors — so only members
    // who can manage the roster see them. Everyone else gets names and roles.
    const canSeeEmails = req.user ? await canManageMembers(req.user.userId, req.params.id) : false;
    res.json(canSeeEmails ? members : members.map((m) => ({ ...m, user: { ...m.user, email: undefined } })));
  } catch (err) { next(err); }
}

/**
 * PATCH /api/v1/teams/:id/members/:memberId
 * Accepts `role` and/or any of `rosterAccess` / `invitationAccess` / `matchAccess`.
 * Route guard already requires MANAGE_MEMBERS; here we additionally forbid editing
 * your own access tiers so a coach can't lock themselves out of their own team.
 */
export async function updateMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, rosterAccess, invitationAccess, matchAccess } = req.body;
    const hasTierChange = rosterAccess !== undefined || invitationAccess !== undefined || matchAccess !== undefined;

    if (hasTierChange) {
      const membership = await findTeamMembership(req.params.id, req.params.memberId);
      if (membership.userId === req.user!.userId) {
        throw new AppError(403, 'You cannot change your own access tiers.');
      }
    }

    // Role change re-seeds tiers to defaults; apply explicit tier overrides after.
    let member = role !== undefined
      ? await updateMemberRole(req.params.id, req.params.memberId, parseRole(role))
      : null;

    if (hasTierChange) {
      member = await updateMemberAccess(req.params.id, req.params.memberId, {
        ...(rosterAccess !== undefined ? { rosterAccess: parseTier(rosterAccess) } : {}),
        ...(invitationAccess !== undefined ? { invitationAccess: parseTier(invitationAccess) } : {}),
        ...(matchAccess !== undefined ? { matchAccess: parseTier(matchAccess) } : {}),
      });
    }

    if (!member) throw new AppError(400, 'Nothing to update — provide a role or access tier.');
    res.json(member);
  } catch (err) { next(err); }
}

/** DELETE /api/v1/teams/:id/members/:memberId */
export async function deleteMember(req: Request, res: Response, next: NextFunction) {
  try {
    await removeMember(req.params.id, req.params.memberId);
    res.status(204).send();
  } catch (err) { next(err); }
}

/** GET /api/v1/users/me/teams */
export async function myMemberships(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const teams = await getUserTeams(req.user.userId);
    res.json(teams);
  } catch (err) { next(err); }
}

/** POST /api/v1/teams/:id/players/:playerId/link { userId } — staff only (MANAGE_MEMBERS). */
export async function linkPlayerRecordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { userId } = req.body ?? {};
    if (typeof userId !== 'string' || !userId) throw new AppError(400, 'userId is required.');
    res.json(await linkPlayerRecord(req.params.id, req.params.playerId, userId));
  } catch (err) { next(err); }
}

/** DELETE /api/v1/teams/:id/players/:playerId/link — staff only (MANAGE_MEMBERS). */
export async function unlinkPlayerRecordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await unlinkPlayerRecord(req.params.id, req.params.playerId));
  } catch (err) { next(err); }
}
