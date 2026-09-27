import { Router, Request, Response, NextFunction } from 'express';
import { createSession, listSessions } from '../controllers/trainingSessions';
import { requireAuth } from '../middleware/auth';
import { requireTeamPermission } from '../middleware/permissions';
import { Permission, hasTeamPermission } from '../services/permission.service';
import { asyncHandler } from '../middleware/asyncHandler';

// Iteration 3 — Training sessions are staff-only, reusing the TRACK_MATCH
// permission (the same coach/staff-vs-player line as live match tracking).
// Players never hold TRACK_MATCH, so they can neither create nor list sessions.

// For POST the teamId comes from the body, so the check is inline (mirrors the
// match-create guard).
const requireTrackForBodyTeam = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  const { teamId } = req.body;
  if (!teamId) { res.status(400).json({ error: 'teamId is required.' }); return; }
  const allowed = await hasTeamPermission(req.user.userId, teamId, Permission.TRACK_MATCH);
  if (!allowed) { res.status(403).json({ error: 'You do not have permission to record training for this team.' }); return; }
  next();
});

const router = Router();

router.post('/', requireAuth, requireTrackForBodyTeam, createSession);
router.get('/by-team/:teamId', requireAuth, requireTeamPermission(Permission.TRACK_MATCH, 'teamId'), listSessions);

export default router;
