import { AccessTier, TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { normalizeEmail, isEmailAddress } from '../lib/email';
import { AppError } from '../middleware/errorHandler';
import { defaultAccessTiers } from './permission.service';
import { applyCreatePlayer } from './playerActions.service';

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
          leagueSeasonId: true,
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

  const membership = await prisma.teamMembership.create({
    data: { teamId, userId, role, ...defaultAccessTiers(role) },
    select: memberSelect,
  });
  // Added straight in as a player — put them on the roster too.
  if (role === 'PLAYER') await ensurePlayerForMember(teamId, userId);
  return membership;
}

/**
 * Update a member's role. Changing the role re-seeds the three access tiers to
 * that role's defaults — a role change is a coarse action, and this avoids a
 * demoted member silently keeping elevated access. A coach can then fine-tune.
 */
export async function updateMemberRole(membershipId: string, role: TeamRole) {
  const membership = await prisma.teamMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new AppError(404, 'Membership not found.');
  const updated = await prisma.teamMembership.update({
    where: { id: membershipId },
    data: { role, ...defaultAccessTiers(role) },
    select: memberSelect,
  });
  // Promoted to player — put them on the roster. Safe to call unconditionally
  // for PLAYER updates since ensurePlayerForMember is idempotent.
  if (role === 'PLAYER') await ensurePlayerForMember(membership.teamId, membership.userId);
  return updated;
}

/** Update one or more of a member's access tiers, leaving role untouched. */
export async function updateMemberAccess(
  membershipId: string,
  tiers: { rosterAccess?: AccessTier; invitationAccess?: AccessTier; matchAccess?: AccessTier },
) {
  const membership = await prisma.teamMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new AppError(404, 'Membership not found.');
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
export async function removeMember(membershipId: string) {
  const membership = await prisma.teamMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new AppError(404, 'Membership not found.');
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

/**
 * Look up the ONE user with this exact email — the add-member lookup.
 *
 * Deliberately not a search. It used to substring-match email, firstName and
 * lastName on any two-character string and return twenty rows to any
 * authenticated user, which is a directory walk of every person in the product.
 * Requiring the whole address means a caller must already know it — the same
 * disclosure registration gives when it rejects an address as taken.
 *
 * What this still discloses, deliberately: given a full address, that it has an
 * account and whose name it is. That is the accepted cost of an add-by-email
 * flow and it is bounded by already knowing the address — unlike the fragment
 * search, which needed no prior knowledge at all. `role` is not selected: the
 * caller never rendered it, and a stranger's platform role is not its business.
 * Narrowing further means scoping the lookup to a team the caller may add to,
 * which needs a teamId this endpoint does not currently take.
 */
export async function searchUsers(query: string) {
  const email = normalizeEmail(query);
  if (!isEmailAddress(email)) return [];
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  return user ? [user] : [];
}
