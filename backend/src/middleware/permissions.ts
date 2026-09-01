import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { Permission, hasTeamPermission, canActInCategory, AccessCategory } from '../services/permission.service';

const FORBIDDEN = { error: 'You do not have permission to perform this action.' };

// ─── Global-role guard ────────────────────────────────────────────────────────

/**
 * Requires the authenticated user to have UserRole.ADMIN.
 * Use for system-level operations (creating leagues, seasons) that are not
 * scoped to a specific team. All team-level permissions continue to use
 * hasTeamPermission — this is purely a global-role check.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  if (req.user.role !== 'ADMIN') { res.status(403).json(FORBIDDEN); return; }
  next();
}

/**
 * Guard for league creation.
 *
 * INTERIM (2026-07): coaches can create leagues alongside admins. Planned to
 * revert to admin-only once real/social leagues ship — see Karlos.
 *
 * Kept as a single isolated check (not scattered inline conditionals) so the
 * revert is one edit: allow ADMIN, or any user who owns a team or holds a
 * HEAD_COACH / MANAGER membership on one.
 */
export async function requireLeagueCreator(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  if (req.user.role === 'ADMIN') { next(); return; }
  const [owned, staffed] = await Promise.all([
    prisma.team.count({ where: { ownerId: req.user.userId } }),
    prisma.teamMembership.count({ where: { userId: req.user.userId, role: { in: ['HEAD_COACH', 'MANAGER'] } } }),
  ]);
  if (owned > 0 || staffed > 0) { next(); return; }
  res.status(403).json(FORBIDDEN);
}

// ─── Team-context middleware ──────────────────────────────────────────────────

/**
 * Checks the authenticated user has `permission` on the team whose id comes
 * from `req.params[paramName]` (default: "id").
 */
export function requireTeamPermission(permission: Permission, paramName = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const teamId = req.params[paramName];
    if (!teamId) { res.status(400).json({ error: 'Team ID missing from request.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, teamId, permission);
    if (!allowed) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

// ─── Access-tier middleware (Iteration 3) ─────────────────────────────────────
// Gate a tiered mutation on the member's access tier for its category. Blocks
// VIEW_ONLY / non-members with a 403; APPROVAL_REQUIRED and FULL_ACCESS both
// pass through, and the controller decides queue-vs-immediate from the tier.

/** teamId comes from `req.params[paramName]` (default "id"). */
export function requireTeamAccess(category: AccessCategory, paramName = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const teamId = req.params[paramName];
    if (!teamId) { res.status(400).json({ error: 'Team ID missing from request.' }); return; }
    if (!(await canActInCategory(req.user.userId, teamId, category))) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

/** teamId resolved from the match at `req.params.id`. */
export function requireMatchAccess(category: AccessCategory) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const match = await prisma.match.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!match) { res.status(404).json({ error: 'Match not found.' }); return; }
    if (!(await canActInCategory(req.user.userId, match.teamId, category))) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

// ─── Channel-context middleware (Team Chat) ───────────────────────────────────

/**
 * Looks up the channel by `req.params.channelId`, resolves its teamId, then
 * checks the team permission. TEAM-channel membership is implicit (= the
 * caller's TeamMembership) — no ChannelMember row is required.
 */
export function requireChannelPermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const channel = await prisma.channel.findUnique({
      where: { id: req.params.channelId },
      select: { teamId: true },
    });
    if (!channel) { res.status(404).json({ error: 'Channel not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, channel.teamId, permission);
    if (!allowed) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

// ─── Match-context middleware ─────────────────────────────────────────────────

/**
 * Looks up the match by `req.params[paramName]` (default "id"), resolves teamId,
 * then checks permission. The param name is configurable for the same reason
 * requireTeamPermission's is — nested routes carry the id as `:matchId`.
 */
export function requireMatchPermission(permission: Permission, paramName = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const matchId = req.params[paramName];
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
    if (!match) { res.status(404).json({ error: 'Match not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, match.teamId, permission);
    if (!allowed) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

/**
 * For POST /events — teamId resolved via req.body.matchId.
 */
export function requireEventPermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const matchId = req.body.matchId ?? req.params.matchId;
    if (!matchId) { res.status(400).json({ error: 'matchId is required.' }); return; }
    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
    if (!match) { res.status(404).json({ error: 'Match not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, match.teamId, permission);
    if (!allowed) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}

/**
 * For DELETE /events/:id and DELETE /events/undo/:matchId.
 * Resolves teamId from event or undo-match param.
 */
export function requireEventDeletePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }

    let teamId: string | null = null;

    if (req.params.matchId) {
      // Undo route: /events/undo/:matchId
      const match = await prisma.match.findUnique({
        where: { id: req.params.matchId },
        select: { teamId: true },
      });
      teamId = match?.teamId ?? null;
    } else if (req.params.id) {
      // Delete specific event
      const event = await prisma.event.findUnique({
        where: { id: req.params.id },
        include: { match: { select: { teamId: true } } },
      });
      // match is nullable now (training events have no match) — guard it.
      teamId = event?.match?.teamId ?? null;
    }

    if (!teamId) { res.status(404).json({ error: 'Resource not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, teamId, permission);
    if (!allowed) { res.status(403).json(FORBIDDEN); return; }
    next();
  };
}
