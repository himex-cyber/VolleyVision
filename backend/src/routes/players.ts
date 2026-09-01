import { Router, Request, Response, NextFunction } from 'express';
import {
  getPlayersByTeam,
  getPlayer,
  createPlayer,
  updatePlayer,
  deletePlayer,
} from '../controllers/players';
import {
  getPlayerTeams,
  addPlayerTeamLink,
  removePlayerTeamLink,
} from '../controllers/playerTeamLinks';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { visibleByTeamParam, visibleByPlayerParam } from '../middleware/visibility';
import { hasTeamPermission, canActInCategory, Permission } from '../services/permission.service';
import { prisma } from '../lib/prisma';

// Guard for link mutations: requester must have MANAGE_TEAM on the team being linked/unlinked.
// For POST the teamId comes from req.body; for DELETE from req.params.teamId.
async function requireManageLinkedTeam(req: Request, res: Response, next: NextFunction) {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  const teamId = req.body.teamId ?? req.params.teamId;
  if (!teamId) { res.status(400).json({ error: 'teamId is required.' }); return; }
  const allowed = await hasTeamPermission(req.user.userId, teamId, Permission.MANAGE_TEAM);
  if (!allowed) { res.status(403).json({ error: 'You do not have permission to manage this team.' }); return; }
  next();
}

// Roster access (Iteration 3): gated on the member's roster access tier, not the
// static role permission — a VIEW_ONLY member is blocked here even if their role
// would otherwise allow it, and a member granted access can proceed regardless of
// role. Create → teamId from body; update/delete → resolved from the player.
// The controller then decides immediate vs queued from FULL_ACCESS vs APPROVAL_REQUIRED.
async function requireRosterAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  let teamId: string | undefined = req.body?.teamId;
  if (!teamId && req.params.id) {
    const player = await prisma.player.findUnique({ where: { id: req.params.id }, select: { teamId: true } });
    if (!player) { res.status(404).json({ error: 'Player not found.' }); return; }
    teamId = player.teamId;
  }
  if (!teamId) { res.status(400).json({ error: 'teamId is required.' }); return; }
  if (!(await canActInCategory(req.user.userId, teamId, 'roster'))) {
    res.status(403).json({ error: 'You do not have permission to manage this roster.' });
    return;
  }
  next();
}

const router = Router();

// Players are always scoped to a team for roster management.
// Reads honour team visibility (private teams hidden from non-members).
// Mutations are gated in Fix 3 (approval queue) — see the requireRosterAccess
// middleware added there; left here as-is until that layer is applied.
router.get('/by-team/:teamId', optionalAuth, visibleByTeamParam('teamId'), getPlayersByTeam);
router.get('/:id', optionalAuth, visibleByPlayerParam('id'), getPlayer);
router.post('/', requireAuth, requireRosterAccess, createPlayer);
router.patch('/:id', requireAuth, requireRosterAccess, updatePlayer);
router.delete('/:id', requireAuth, requireRosterAccess, deletePlayer);

// Phase 7 — multi-team player links
// Same visibility contract as the player reads above — the link list carries the
// player's name and every team they belong to, so a private home team hides it.
router.get('/:playerId/teams', optionalAuth, visibleByPlayerParam('playerId'), getPlayerTeams);
router.post('/:playerId/team-links', requireAuth, requireManageLinkedTeam, addPlayerTeamLink);
router.delete('/:playerId/team-links/:teamId', requireAuth, requireManageLinkedTeam, removePlayerTeamLink);

export default router;
