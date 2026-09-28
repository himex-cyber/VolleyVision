import { prisma, runSerializable } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { normalizeEmail } from '../lib/email';
import { Prisma } from '@prisma/client';
import { defaultAccessTiers, isGlobalAdmin } from './permission.service';
import { roleSlotError } from '../lib/roleSlots';

const ownerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  profileImage: true,
} as const;

/**
 * Anyone can create a team (Phase 4.5), so ownership is capped instead of
 * gated: an account owns at most 5 teams, and a global admin is exempt. Run it
 * inside the same serializable transaction as the write that adds a team, so
 * two parallel creates (or a create racing a transfer) can't both see 4.
 */
export const MAX_OWNED_TEAMS = 5;

export async function assertRoomForAnotherTeam(
  tx: Prisma.TransactionClient,
  userId: string,
  isAdmin: boolean,
  message = `You can own up to ${MAX_OWNED_TEAMS} teams. Transfer or delete one to create another.`,
) {
  if (isAdmin) return;
  if ((await tx.team.count({ where: { ownerId: userId } })) >= MAX_OWNED_TEAMS) throw new AppError(409, message);
}

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
 * should only ever land on someone who has already joined it. And it
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
  const email = normalizeEmail(newOwnerEmail);
  const membership = await prisma.teamMembership.findFirst({
    where: { teamId, user: { email } },
    select: { id: true, userId: true },
  });
  if (!membership) {
    throw new AppError(404, 'No member of this team uses that email address. Add them to the team first.');
  }
  if (membership.userId === requesterId) throw new AppError(400, 'You already own this team.');
  const receiverIsAdmin = await isGlobalAdmin(membership.userId);

  // One transaction, demote before promote: the partial unique index allows
  // only one HEAD_COACH per team, and it used to be left with two — the old
  // owner kept their HEAD_COACH row. The old owner becomes an assistant coach;
  // if both assistant slots are taken the transfer is refused rather than
  // pushing someone out (Karlos, 2026-09-27). The new owner's own slot counts
  // as free, since they are leaving it.
  return runSerializable(async (tx) => {
    await assertRoomForAnotherTeam(tx, membership.userId, receiverIsAdmin,
      `They already own ${MAX_OWNED_TEAMS} teams, the most one account can. They'd need to transfer or delete one first.`);
    const assistants = await tx.teamMembership.count({
      where: { teamId, role: 'ASSISTANT_COACH', userId: { notIn: [requesterId, membership.userId] } },
    });
    const slotError = roleSlotError('ASSISTANT_COACH', assistants);
    if (slotError) {
      throw new AppError(409, `${slotError} You become an assistant coach after the transfer, so free a slot first.`);
    }

    await tx.teamMembership.updateMany({
      where: { teamId, userId: requesterId },
      data: { role: 'ASSISTANT_COACH', ...defaultAccessTiers('ASSISTANT_COACH') },
    });
    await tx.teamMembership.update({
      where: { id: membership.id },
      data: { role: 'HEAD_COACH', ...defaultAccessTiers('HEAD_COACH') },
    });
    return tx.team.update({
      where: { id: teamId },
      data: { ownerId: membership.userId },
      include: { owner: { select: ownerSelect } },
    });
  });
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
