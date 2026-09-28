import { Router } from 'express';
import {
  getMatchAnalytics,
  getMatchReport,
  getMatchZones,
  getPlayerAnalytics,
  getPlayerZones,
  getTeamAnalytics,
  getTeamTrends,
  getTeamZones,
} from '../controllers/analytics';
import { optionalAuth } from '../middleware/auth';
import { visibleByTeamParam, visibleByMatchParam } from '../middleware/visibility';

const router = Router();

// Every team is private: non-members (and anonymous callers) get 404 from the
// per-route visibility guard. optionalAuth populates req.user when a token is
// present so the guard can tell "no token" from "wrong user". Read-only, so no
// rate limit.
router.use(optionalAuth);

const mVis = visibleByMatchParam('matchId');
const tVis = visibleByTeamParam('teamId');

router.get('/matches/:matchId', mVis, getMatchAnalytics);
router.get('/matches/:matchId/report', mVis, getMatchReport);
router.get('/matches/:matchId/zones', mVis, getMatchZones);
router.get('/teams/:teamId', tVis, getTeamAnalytics);
router.get('/teams/:teamId/trends', tVis, getTeamTrends);
router.get('/teams/:teamId/zones', tVis, getTeamZones);
// No pVis: that checks the player's HOME team, but staff of a linked team
// can't see it. The controller checks visibility of the team in scope instead.
router.get('/players/:playerId', getPlayerAnalytics);
router.get('/players/:playerId/zones', getPlayerZones); // same: resolvePlayerScope

export default router;
