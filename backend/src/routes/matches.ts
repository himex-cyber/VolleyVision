import { Router } from 'express';
import {
  getMatchesByTeam,
  getMatch,
  createMatch,
  updateMatch,
  deleteMatch,
  updateScore,
  resetSetScore,
  // endSet — disabled, see the commented-out route below.
  resetMatch,
} from '../controllers/matches';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { requireMatchPermission, requireMatchAccess } from '../middleware/permissions';
import { visibleByTeamParam, visibleByMatchParam } from '../middleware/visibility';
import { Permission } from '../services/permission.service';

// For POST /matches we need teamId from the body to check the match access tier.
// We do that inline since the router doesn't have a natural param for it.
import { Request, Response, NextFunction } from 'express';
import { canActInCategory } from '../services/permission.service';
import { asyncHandler } from '../middleware/asyncHandler';

const requireCreateMatch = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
  const { teamId } = req.body;
  if (!teamId) { next(); return; } // body validation is the controller's job
  if (!(await canActInCategory(req.user.userId, teamId, 'match'))) {
    res.status(403).json({ error: 'You do not have permission to perform this action.' });
    return;
  }
  next();
});

const router = Router();

router.get('/by-team/:teamId', optionalAuth, visibleByTeamParam('teamId'), getMatchesByTeam);
router.get('/:id', optionalAuth, visibleByMatchParam('id'), getMatch);
router.post('/', requireAuth, requireCreateMatch, createMatch);
// Match create/edit/delete are tiered (Iteration 3). Score updates stay on the
// untiered, real-time TRACK_MATCH permission — live tracking is never queued.
router.patch('/:id', requireAuth, requireMatchAccess('match'), updateMatch);
router.patch('/:id/score', requireAuth, requireMatchPermission(Permission.TRACK_MATCH), updateScore);
router.post('/:id/score/reset', requireAuth, requireMatchPermission(Permission.TRACK_MATCH), resetSetScore);
// Manual set override — same untiered live-tracking permission as the score
// updates above, since it's a real-time courtside action.
//
// DISABLED: manual End Set complicated the live-tracking flow in hands-on
// testing, so the button is gone from the scoreboard and this route is not
// registered. Kept (with its `endSet` controller) for possible future use —
// automatic set completion at 25/15 win-by-2 is a separate path in
// lib/scoring.ts and is unaffected.
// router.post('/:id/score/end-set', requireAuth, requireMatchPermission(Permission.TRACK_MATCH), endSet);
router.post('/:id/score/reset-match', requireAuth, requireMatchPermission(Permission.TRACK_MATCH), resetMatch);
router.delete('/:id', requireAuth, requireMatchAccess('match'), deleteMatch);

export default router;
