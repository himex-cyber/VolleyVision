import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { syncOwnerMembership } from './teamMembership.service';

const ownerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  profileImage: true,
} as const;

/** All teams owned by a given user. */
export async function getOwnedTeams(userId: string) {
  return prisma.team.findMany({
    where: { ownerId: userId },
    include: { _count: { select: { players: true, matches: true } } },
    orderBy: { name: 'asc' },
  });
}

/**
 * Transfer ownership from the current owner to another user, identified by
 * email. Only the current owner may call.
 *
 * Takes an email rather than a user id because nobody knows another user's
 * cuid — the id-based signature made this feature unreachable from the UI.
 *
 * The target must already hold a TeamMembership on this team. That constraint
 * is doing two jobs. Ownership carries every permission on the team, so it
 * should only ever land on someone who has already joined it (syncOwnerMembership
 * below would happily fabricate a membership for a stranger otherwise). And it
 * keeps this endpoint from becoming an account-enumeration oracle: the single
 * lookup asks only "does a member of *this* team use this address?", which the
 * caller can already answer from GET /teams/:id/members. An address with no
 * account and a real account that simply isn't on the team are indistinguishable
 * — same 404, same query, same work — so probing here reveals nothing the
 * caller was not already entitled to see. Same reasoning as the forgot-password
 * flow in auth.service.ts, which likewise refuses to confirm an address exists.
 */
export async function transferOwnership(teamId: string, requesterId: string, newOwnerEmail: string) {
  const existing = await prisma.team.findUnique({ where: { id: teamId } });
  if (!existing) throw new AppError(404, 'Team not found.');
  if (existing.ownerId !== requesterId) throw new AppError(403, 'Only the current owner can transfer ownership.');

  // Emails are stored lowercased (registerUser); trim matches how the
  // login rate limiter keys the same field off a request body.
  const email = newOwnerEmail.trim().toLowerCase();
  const membership = await prisma.teamMembership.findFirst({
    where: { teamId, user: { email } },
    select: { userId: true },
  });
  if (!membership) {
    throw new AppError(404, 'No member of this team uses that email address. Add them to the team first.');
  }

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: { ownerId: membership.userId },
    include: { owner: { select: ownerSelect } },
  });
  // Still required: the new owner may have been a PLAYER/VIEWER member, and the
  // owner is always a HEAD_COACH.
  await syncOwnerMembership(teamId, membership.userId);
  return updated;
}

/** Throws 403 if the requesting user does not own the team. */
export async function verifyOwnership(teamId: string, userId: string): Promise<void> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { ownerId: true } });
  if (!team) throw new AppError(404, 'Team not found.');
  if (team.ownerId !== userId) throw new AppError(403, 'You do not own this team.');
}

/** Returns the owner of a team. */
export async function getTeamOwner(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { owner: { select: ownerSelect } },
  });
  if (!team) throw new AppError(404, 'Team not found.');
  return team.owner;
}
