import { AccessTier, Prisma, TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { defaultAccessTiers } from './permission.service';
import { applyCreatePlayer } from './playerActions.service';
import { roleSlotError } from '../lib/roleSlots';

const memberSelect = {
  id: true,
  role: true,
  joinedAt: true,
  // Iteration 3 — per-member access tiers, so the members UI can render/edit them.
  rosterAccess: true,
  invitationAccess: true,
  matchAccess: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      profileImage: true,
    },
  },
} as const;

/** Return all memberships for a team. */
export async function getTeamMembers(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) throw new AppError(404, 'Team not found.');
  return prisma.teamMembership.findMany({
    where: { teamId },
    select: memberSelect,
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });
}

/** Return all team memberships for a given user. */
export async function getUserTeams(userId: string) {
  return prisma.teamMembership.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      joinedAt: true,
      team: {
        select: {
          id: true,
          name: true,
          division: true,
          season: true,
          ownerId: true,
          _count: { select: { players: true, matches: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
}

/**
 * Give a team member a roster row, so promoting someone to PLAYER actually puts
 * them on the Roster instead of only changing their membership role.
 *
 * Idempotent: a member promoted → demoted → promoted again keeps the single
 * original Player row (demotion deliberately never deletes it — the row owns
 * their Event history; the Roster's Delete-player flow is the way off).
 *
 * Writes directly rather than queueing an approval request: the caller has
 * already passed the MANAGE_MEMBERS check on the membership route, and this row
 * is a side effect of that authorized action rather than a user-submitted "add
 * player" — the same reasoning syncOwnerMembership() below applies.
 */
export async function ensurePlayerForMember(teamId: string, userId: string) {
  const existing = await prisma.player.findFirst({ where: { teamId, userId } });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  if (!user) throw new AppError(404, 'User not found.');

  // Smallest unused number, matching the Add Player form's own 0–99 range.
  const taken = await prisma.player.findMany({ where: { teamId }, select: { jerseyNumber: true } });
  const used = new Set(taken.map((p) => p.jerseyNumber));
  const jerseyNumber = Array.from({ length: 100 }, (_, n) => n).find((n) => !used.has(n));
  if (jerseyNumber === undefined) {
    throw new AppError(409, 'Every jersey number from 0 to 99 is taken on this team. Free one up first.');
  }

  // Position is a placeholder — the coach sets the real one straight after via
  // the Roster's edit panel. SETTER matches the Add Player form's own default.
  return applyCreatePlayer({
    firstName: user.firstName,
    lastName: user.lastName,
    jerseyNumber,
    position: 'SETTER',
    teamId,
    userId,
  });
}

/**
 * Check the role's slot is free (lib/roleSlots.ts), then write — both inside
 * one SERIALIZABLE transaction, so two people joining at the same moment can't
 * each see one assistant and both take the last slot. Every path that sets a
 * role (invitations, staff join codes, member edits) comes through addMember or
 * updateMemberRole, so this is the single place the limits are enforced.
 */
async function withRoleSlot<T>(
  teamId: string,
  role: TeamRole,
  excludeMembershipId: string | null,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      const assistants = role === 'ASSISTANT_COACH'
        ? await tx.teamMembership.count({
            where: { teamId, role: 'ASSISTANT_COACH', ...(excludeMembershipId ? { NOT: { id: excludeMembershipId } } : {}) },
          })
        : 0;
      const error = roleSlotError(role, assistants);
      if (error) throw new AppError(409, error);
      return write(tx);
    }, { isolationLevel: 'Serializable' });
  } catch (err) {
    // P2034: Postgres aborted the loser of two racing transactions.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      throw new AppError(409, "Someone else just changed this team's roles. Try again.");
    }
    throw err;
  }
}

/** Add a user to a team with a given role. */
export async function addMember(teamId: string, userId: string, role: TeamRole) {
  const [team, user] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
  ]);
  if (!team) throw new AppError(404, 'Team not found.');
  if (!user) throw new AppError(404, 'User not found.');

  const existing = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  if (existing) throw new AppError(409, 'User is already a member of this team.');

  const membership = await withRoleSlot(teamId, role, null, (tx) =>
    tx.teamMembership.create({
      data: { teamId, userId, role, ...defaultAccessTiers(role) },
      select: memberSelect,
    }),
  );
  // Added straight in as a player — put them on the roster too.
  if (role === 'PLAYER') await ensurePlayerForMember(teamId, userId);
  return membership;
}

/**
 * Every member mutation arrives as /teams/:id/members/:memberId, and the route
 * guard only checks the caller's permission on :id. Scoping the lookup to that
 * same team is what stops the owner of any team (and anyone can create one)
 * editing or removing a membership that belongs to a different team.
 */
export async function findTeamMembership(teamId: string, membershipId: string) {
  const membership = await prisma.teamMembership.findFirst({ where: { id: membershipId, teamId } });
  if (!membership) throw new AppError(404, 'Membership not found.');
  return membership;
}

/**
 * Update a member's role. Changing the role re-seeds the three access tiers to
 * that role's defaults — a role change is a coarse action, and this avoids a
 * demoted member silently keeping elevated access. A coach can then fine-tune.
 */
export async function updateMemberRole(teamId: string, membershipId: string, role: TeamRole) {
  const membership = await findTeamMembership(teamId, membershipId);
  // Re-saving the same role is a no-op. It used to re-seed the tiers, which
  // silently wiped a coach's custom access settings on an unchanged "Save".
  if (membership.role === role) {
    return prisma.teamMembership.findUniqueOrThrow({ where: { id: membershipId }, select: memberSelect });
  }
  if (membership.role === 'HEAD_COACH') {
    throw new AppError(409, 'The head coach is the team owner. Transfer ownership to change them.');
  }
  const updated = await withRoleSlot(teamId, role, membershipId, (tx) =>
    tx.teamMembership.update({
      where: { id: membershipId },
      data: { role, ...defaultAccessTiers(role) },
      select: memberSelect,
    }),
  );
  // Promoted to player — put them on the roster. Safe to call unconditionally
  // for PLAYER updates since ensurePlayerForMember is idempotent.
  if (role === 'PLAYER') await ensurePlayerForMember(membership.teamId, membership.userId);
  return updated;
}

/** Update one or more of a member's access tiers, leaving role untouched. */
export async function updateMemberAccess(
  teamId: string,
  membershipId: string,
  tiers: { rosterAccess?: AccessTier; invitationAccess?: AccessTier; matchAccess?: AccessTier },
) {
  await findTeamMembership(teamId, membershipId);
  return prisma.teamMembership.update({
    where: { id: membershipId },
    data: {
      ...(tiers.rosterAccess ? { rosterAccess: tiers.rosterAccess } : {}),
      ...(tiers.invitationAccess ? { invitationAccess: tiers.invitationAccess } : {}),
      ...(tiers.matchAccess ? { matchAccess: tiers.matchAccess } : {}),
    },
    select: memberSelect,
  });
}

/** Remove a member from a team. */
export async function removeMember(teamId: string, membershipId: string) {
  const membership = await findTeamMembership(teamId, membershipId);
  if (membership.role === 'HEAD_COACH') {
    throw new AppError(409, 'Transfer ownership before removing the head coach.');
  }
  await prisma.teamMembership.delete({ where: { id: membershipId } });
}

/** Returns true if the user is a member of the team. */
export async function isMember(teamId: string, userId: string): Promise<boolean> {
  const m = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { id: true },
  });
  return m !== null;
}

/**
 * Ensures the team owner has a HEAD_COACH membership record.
 * Called after claim or transfer so ownership and membership stay in sync.
 */
export async function syncOwnerMembership(teamId: string, ownerId: string) {
  const existing = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId: ownerId, teamId } },
  });
  if (existing) {
    // Upgrade to HEAD_COACH if they were previously a lower role
    if (existing.role !== 'HEAD_COACH') {
      await prisma.teamMembership.update({
        where: { id: existing.id },
        data: { role: 'HEAD_COACH' },
      });
    }
  } else {
    await prisma.teamMembership.create({
      data: { teamId, userId: ownerId, role: 'HEAD_COACH' },
    });
  }
}
