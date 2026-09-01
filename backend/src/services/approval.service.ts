import { ApprovalAction, ApprovalStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { isApprovalAuthority } from './permission.service';
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
  if (request.status !== ApprovalStatus.PENDING) {
    throw new AppError(409, `Request is already ${request.status.toLowerCase()}.`);
  }
  const allowed = await isApprovalAuthority(resolverId, request.teamId);
  if (!allowed) throw new AppError(403, 'Only an owner, head coach, or manager can resolve approval requests.');
  return request;
}

export async function approveRequest(requestId: string, resolverId: string) {
  const request = await loadResolvable(requestId, resolverId);

  // Apply the change first; if it fails (e.g. target already deleted), the
  // request stays PENDING and the error surfaces — nothing is half-applied.
  await applyApproval(request);

  const resolved = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: ApprovalStatus.APPROVED, resolvedById: resolverId, resolvedAt: new Date() },
    include: requestInclude,
  });
  await onApprovalResolved(resolved);
  return resolved;
}

export async function rejectRequest(requestId: string, resolverId: string) {
  await loadResolvable(requestId, resolverId);
  const resolved = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: ApprovalStatus.REJECTED, resolvedById: resolverId, resolvedAt: new Date() },
    include: requestInclude,
  });
  await onApprovalResolved(resolved);
  return resolved;
}
