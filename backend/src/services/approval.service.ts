import { ApprovalAction, ApprovalStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { isApprovalAuthority, getUserTeamRole } from './permission.service';
import { assertTeamVisible } from '../lib/teamVisibility';
import { onApprovalRequestCreated, onApprovalResolved } from './approvalNotifications';
import { applyCreatePlayer, applyUpdatePlayer, applyDeletePlayer } from './playerActions.service';
import {
  applyCreateMatch, applyUpdateMatch, applyDeleteMatch,
  applyCreateInvitation,
} from './teamActions.service';

const requestInclude = {
  requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.ApprovalRequestInclude;

/** Records a PENDING approval request and fires the (no-op) notification hook. */
export async function createApprovalRequest(input: {
  teamId: string;
  requestedById: string;
  action: ApprovalAction;
  payload: Prisma.InputJsonValue;
  targetId?: string | null;
}) {
  const request = await prisma.approvalRequest.create({
    data: {
      teamId: input.teamId,
      requestedById: input.requestedById,
      action: input.action,
      payload: input.payload,
      targetId: input.targetId ?? null,
    },
    include: requestInclude,
  });
  await onApprovalRequestCreated(request);
  return request;
}

export async function listApprovalRequests(teamId: string, status?: ApprovalStatus) {
  return prisma.approvalRequest.findMany({
    where: { teamId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    include: requestInclude,
  });
}

/** Applies a queued change once approved. Central dispatch — keeps the actual
 *  create/update/delete logic in teamActions.service (never duplicated). */
async function applyApproval(request: { action: ApprovalAction; payload: unknown; targetId: string | null }) {
  const payload = request.payload as any;
  switch (request.action) {
    case ApprovalAction.PLAYER_CREATE:     return applyCreatePlayer(payload);
    case ApprovalAction.PLAYER_UPDATE:     return applyUpdatePlayer(request.targetId!, payload);
    case ApprovalAction.PLAYER_DELETE:     return applyDeletePlayer(request.targetId!);
    case ApprovalAction.MATCH_CREATE:      return applyCreateMatch(payload);
    case ApprovalAction.MATCH_UPDATE:      return applyUpdateMatch(request.targetId!, payload);
    case ApprovalAction.MATCH_DELETE:      return applyDeleteMatch(request.targetId!);
    case ApprovalAction.INVITATION_CREATE: return applyCreateInvitation(payload);
    default:
      throw new AppError(400, `Unknown approval action: ${request.action}`);
  }
}

/** Loads a PENDING request and asserts the resolver may act on it (head coach/owner). */
async function loadResolvable(requestId: string, resolverId: string) {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new AppError(404, 'Approval request not found.');
  // Visibility and permission before the status, so an outsider learns neither
  // that the request exists nor whether it was resolved.
  await assertTeamVisible(request.teamId, resolverId);
  const allowed = await isApprovalAuthority(resolverId, request.teamId);
  if (!allowed) throw new AppError(403, 'Only an owner, head coach, or manager can resolve approval requests.');

  // L3: an approver could resolve their own request — self-approval. Block it
  // unless the resolver is the team owner. This can't deadlock a team: the
  // owner always has FULL_ACCESS (see getAccessTier), so a request is only
  // ever queued for a non-owner approval authority, and the owner can always
  // step in to resolve it.
  if (request.requestedById === resolverId) {
    const { isOwner } = await getUserTeamRole(resolverId, request.teamId);
    if (!isOwner) throw new AppError(403, 'You cannot resolve your own approval request.');
  }
  if (request.status !== ApprovalStatus.PENDING) {
    throw new AppError(409, `Request is already ${request.status.toLowerCase()}.`);
  }
  return request;
}

/**
 * Atomically moves a PENDING request to `status`. Exactly one of two racing
 * resolvers wins: Postgres serialises the two conditional updates on the row,
 * and the loser matches zero rows. Everything a resolver does happens after
 * its claim, so nothing is ever applied twice.
 */
async function claim(requestId: string, status: ApprovalStatus, resolverId: string) {
  const { count } = await prisma.approvalRequest.updateMany({
    where: { id: requestId, status: ApprovalStatus.PENDING },
    data: { status, resolvedById: resolverId, resolvedAt: new Date() },
  });
  if (count === 0) throw new AppError(409, 'Someone else resolved this request first. Refresh to see its status.');
}

export async function approveRequest(requestId: string, resolverId: string) {
  const request = await loadResolvable(requestId, resolverId);

  // Claim before applying: applies aren't idempotent (PLAYER_CREATE makes a
  // new player each time), so a double approve must never reach applyApproval.
  await claim(requestId, ApprovalStatus.APPROVED, resolverId);
  try {
    await applyApproval(request);
  } catch (err) {
    // ponytail: compensating revert, not one transaction; thread a tx through
    // applyApproval if an apply can partially succeed. If the apply fails (e.g.
    // target already deleted), the request goes back to PENDING and the error
    // surfaces.
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: ApprovalStatus.PENDING, resolvedById: null, resolvedAt: null },
    });
    throw err;
  }

  return resolved(requestId);
}

export async function rejectRequest(requestId: string, resolverId: string) {
  await loadResolvable(requestId, resolverId);
  await claim(requestId, ApprovalStatus.REJECTED, resolverId);
  return resolved(requestId);
}

/** updateMany can't `include`, so re-read the resolved row for the response and hook. */
async function resolved(requestId: string) {
  const request = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude });
  await onApprovalResolved(request);
  return request;
}
