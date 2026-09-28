import { prisma } from './prisma';
import { AppError } from '../middleware/errorHandler';

/**
 * Team visibility model
 * ─────────────────────
 * Teams are always private to the people who belong to them. A team is visible
 * only to its owner, a user with an accepted TeamMembership on it, or a global
 * ADMIN. Everyone else is treated as if the team does not exist (404, not 403)
 * so a team's id is never leaked.
 *
 * There is no public-team concept — the previous `isPublic` flag was removed
 * along with public browsing.
 *
 * This helper is the single source of truth for that rule. It is enforced in
 * middleware (see middleware/visibility.ts) in front of every team-scoped read
 * endpoint, and reused by the team-list controller to filter results.
 */
export async function isTeamVisibleTo(teamId: string, userId: string | null): Promise<boolean> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });
  if (!team) return false;   // non-existent team → not visible
  if (!userId) return false; // anonymous → nothing is visible

  if (team.ownerId === userId) return true;

  // Global admins bypass visibility entirely.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === 'ADMIN') return true;

  // Accepted membership on this team.
  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { id: true },
  });
  return !!membership;
}

/**
 * Throws AppError(404) when the caller may not see the team. Use this in
 * controllers/middleware so hidden teams are indistinguishable from teams that
 * do not exist. When the team was resolved from another id (a match, message,
 * ...), pass that resource's own not-found message, so a real id on a hidden
 * team gets the same answer as an id that doesn't exist.
 */
export async function assertTeamVisible(teamId: string, userId: string | null, notFound = 'Team not found.'): Promise<void> {
  const visible = await isTeamVisibleTo(teamId, userId);
  if (!visible) throw new AppError(404, notFound);
}
