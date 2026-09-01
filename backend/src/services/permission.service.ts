import { AccessTier, TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Permission, getPermissionsForRole, roleHasPermission } from '../lib/rolePermissions';

// The static role map lives in lib/rolePermissions so pure-logic tests can reach
// it without loading the Prisma client. Re-exported here because this module has
// always been its public address.
export { Permission, getPermissionsForRole, roleHasPermission };

// ─── Team-context permission check ───────────────────────────────────────────

export async function getUserTeamRole(
  userId: string,
  teamId: string,
): Promise<{ role: string | null; isOwner: boolean }> {
  const [team, membership] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { ownerId: true } }),
    prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    }),
  ]);

  const isOwner = team?.ownerId === userId;
  const role = isOwner ? 'HEAD_COACH' : (membership?.role ?? null);
  return { role, isOwner };
}

export async function hasTeamPermission(
  userId: string,
  teamId: string,
  permission: Permission,
): Promise<boolean> {
  const { role } = await getUserTeamRole(userId, teamId);
  if (!role) return false;
  return roleHasPermission(role, permission);
}

/**
 * Approval authority — who may approve/reject other members' pending
 * ApprovalRequests and is themselves exempt from the queue. The team owner,
 * any HEAD_COACH, and (Iteration 3) any MANAGER.
 * (getUserTeamRole already maps the owner to role 'HEAD_COACH'.)
 */
export async function isApprovalAuthority(userId: string, teamId: string): Promise<boolean> {
  const { role, isOwner } = await getUserTeamRole(userId, teamId);
  return isOwner || role === 'HEAD_COACH' || role === 'MANAGER';
}

/**
 * Chat moderation — who may soft-delete ANY message in a team channel (authors
 * can always delete their own). Approval authorities (owner / HEAD_COACH /
 * MANAGER) plus global ADMIN.
 */
export async function canModerateChannel(userId: string, teamId: string): Promise<boolean> {
  if (await isApprovalAuthority(userId, teamId)) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === 'ADMIN';
}

// ─── Per-member access tiers (Iteration 3) ────────────────────────────────────

/** The three mutation categories a member's access can be dialled per team. */
export type AccessCategory = 'roster' | 'invitation' | 'match';

const CATEGORY_PERMISSIONS: Record<AccessCategory, Permission[]> = {
  roster: [Permission.MANAGE_ROSTER],
  invitation: [Permission.INVITE_USERS],
  match: [Permission.CREATE_MATCH, Permission.EDIT_MATCH, Permission.DELETE_MATCH],
};

/**
 * Role-derived default tiers, applied when a membership is created. A coach can
 * override any of these per member afterwards; the override is authoritative.
 */
export function defaultAccessTiers(role: TeamRole): {
  rosterAccess: AccessTier;
  invitationAccess: AccessTier;
  matchAccess: AccessTier;
} {
  const all = (tier: AccessTier) => ({ rosterAccess: tier, invitationAccess: tier, matchAccess: tier });
  switch (role) {
    case 'HEAD_COACH':
    case 'MANAGER':
      return all(AccessTier.FULL_ACCESS);
    case 'ASSISTANT_COACH':
    case 'STATISTICIAN':
      return all(AccessTier.APPROVAL_REQUIRED);
    default: // PLAYER, VIEWER
      return all(AccessTier.VIEW_ONLY);
  }
}

/**
 * Effective access tier for a member in one category. Null means "not a member"
 * (treated as no access). The owner always has FULL_ACCESS and cannot be locked
 * out of their own team.
 */
export async function getAccessTier(
  userId: string,
  teamId: string,
  category: AccessCategory,
): Promise<AccessTier | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { ownerId: true } });
  if (team?.ownerId === userId) return AccessTier.FULL_ACCESS;

  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { rosterAccess: true, invitationAccess: true, matchAccess: true },
  });
  if (!membership) return null;

  return category === 'roster'
    ? membership.rosterAccess
    : category === 'invitation'
      ? membership.invitationAccess
      : membership.matchAccess;
}

/** True when the member may perform the category's action at all (queued or immediate). */
export async function canActInCategory(userId: string, teamId: string, category: AccessCategory): Promise<boolean> {
  const tier = await getAccessTier(userId, teamId, category);
  return tier === AccessTier.APPROVAL_REQUIRED || tier === AccessTier.FULL_ACCESS;
}

/**
 * Permissions the user effectively holds on a team, folding per-member access
 * tiers over the static role map for the three tiered categories. This is what
 * the frontend reads (via /:id/my-role) so its gating matches backend enforcement
 * — e.g. a Statistician granted FULL_ACCESS on invitations gains INVITE_USERS.
 */
export async function getEffectivePermissions(userId: string, teamId: string): Promise<Permission[]> {
  const { role, isOwner } = await getUserTeamRole(userId, teamId);
  if (!role) return [];
  const set = new Set(getPermissionsForRole(role));
  if (isOwner) return [...set]; // owner keeps everything

  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { rosterAccess: true, invitationAccess: true, matchAccess: true },
  });
  if (!membership) return [...set];

  const apply = (tier: AccessTier, category: AccessCategory) => {
    for (const perm of CATEGORY_PERMISSIONS[category]) {
      if (tier === AccessTier.VIEW_ONLY) set.delete(perm);
      else set.add(perm);
    }
  };
  apply(membership.rosterAccess, 'roster');
  apply(membership.invitationAccess, 'invitation');
  apply(membership.matchAccess, 'match');
  return [...set];
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

export async function canManageTeam(userId: string, teamId: string) {
  return hasTeamPermission(userId, teamId, Permission.MANAGE_TEAM);
}

export async function canTrackMatch(userId: string, teamId: string) {
  return hasTeamPermission(userId, teamId, Permission.TRACK_MATCH);
}

export async function canManageMembers(userId: string, teamId: string) {
  return hasTeamPermission(userId, teamId, Permission.MANAGE_MEMBERS);
}

export async function canViewAnalytics(userId: string, teamId: string) {
  return hasTeamPermission(userId, teamId, Permission.VIEW_ANALYTICS);
}

export async function canInviteUsers(userId: string, teamId: string) {
  return hasTeamPermission(userId, teamId, Permission.INVITE_USERS);
}
