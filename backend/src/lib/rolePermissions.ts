// The static role → permission map, split out of permission.service.ts so it
// can be imported without dragging in lib/prisma — the service's DB queries
// instantiate a PrismaClient at module load, which made `npm test` (src/lib/*.test.ts)
// depend on an engine binary generated for the current platform.
// permission.service re-exports everything here, so importers are unaffected.

// ─── Permission enum ──────────────────────────────────────────────────────────

export enum Permission {
  // Team management
  MANAGE_TEAM     = 'MANAGE_TEAM',     // edit, delete, settings
  TRANSFER_OWNERSHIP = 'TRANSFER_OWNERSHIP',
  // Membership
  MANAGE_MEMBERS  = 'MANAGE_MEMBERS',
  INVITE_USERS    = 'INVITE_USERS',
  // Roster (Stabilization Pass 2) — attempt player create/update/delete.
  // Head coaches apply immediately; assistant coaches route through approval.
  MANAGE_ROSTER   = 'MANAGE_ROSTER',
  // Matches
  CREATE_MATCH    = 'CREATE_MATCH',
  EDIT_MATCH      = 'EDIT_MATCH',
  DELETE_MATCH    = 'DELETE_MATCH',
  // Live tracking
  TRACK_MATCH     = 'TRACK_MATCH',
  // Read access
  VIEW_ANALYTICS  = 'VIEW_ANALYTICS',
  VIEW_REPORTS    = 'VIEW_REPORTS',
  VIEW_TEAM       = 'VIEW_TEAM',
  // Team Chat — post to the team channel. Every role except VIEWER (read-only).
  POST_MESSAGE    = 'POST_MESSAGE',
}

// ─── Role → permission map ────────────────────────────────────────────────────

const HEAD_COACH_PERMISSIONS = [
  Permission.MANAGE_TEAM,
  Permission.TRANSFER_OWNERSHIP,
  Permission.MANAGE_MEMBERS,
  Permission.INVITE_USERS,
  Permission.MANAGE_ROSTER,
  Permission.CREATE_MATCH,
  Permission.EDIT_MATCH,
  Permission.DELETE_MATCH,
  Permission.TRACK_MATCH,
  Permission.VIEW_ANALYTICS,
  Permission.VIEW_REPORTS,
  Permission.VIEW_TEAM,
  Permission.POST_MESSAGE,
];

const ROLE_PERMISSIONS: Record<string, Set<Permission>> = {
  HEAD_COACH: new Set(HEAD_COACH_PERMISSIONS),
  // Iteration 3 — Manager: head-coach authority minus ownership transfer, which
  // stays owner-exclusive (a distinct, more sensitive action).
  MANAGER: new Set(HEAD_COACH_PERMISSIONS.filter((p) => p !== Permission.TRANSFER_OWNERSHIP)),
  ASSISTANT_COACH: new Set([
    Permission.MANAGE_ROSTER,
    Permission.CREATE_MATCH,
    Permission.EDIT_MATCH,
    Permission.TRACK_MATCH,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_REPORTS,
    Permission.VIEW_TEAM,
    Permission.POST_MESSAGE,
  ]),
  STATISTICIAN: new Set([
    Permission.TRACK_MATCH,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_REPORTS,
    Permission.VIEW_TEAM,
    Permission.POST_MESSAGE,
  ]),
  PLAYER: new Set([
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_REPORTS,
    Permission.VIEW_TEAM,
    Permission.POST_MESSAGE,
  ]),
  VIEWER: new Set([
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_TEAM,
  ]),
};

export function getPermissionsForRole(role: string): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

export function roleHasPermission(role: string, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

// ─── Role ranking (M4) ────────────────────────────────────────────────────────
// Authority order, highest first — mirrors the TeamRole enum's declaration
// order in schema.prisma, which is itself ordered this way on purpose.
const ROLE_ORDER = ['HEAD_COACH', 'MANAGER', 'ASSISTANT_COACH', 'STATISTICIAN', 'PLAYER', 'VIEWER'];

/** Lower is more authority. An unknown role ranks last (least authority). */
export function roleRank(role: string): number {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

/**
 * Can `inviterRole` invite someone as `targetRole`? HEAD_COACH is never an
 * invitable role (head coach changes only via ownership transfer), and an
 * inviter can never hand out a role that outranks their own.
 */
export function canInviteRole(inviterRole: string, targetRole: string): boolean {
  if (targetRole === 'HEAD_COACH') return false;
  return roleRank(targetRole) >= roleRank(inviterRole);
}
