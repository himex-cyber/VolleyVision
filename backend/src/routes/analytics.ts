import { Router } from 'express';
import {
  getMatchAnalytics,
  getMatchReport,
  getPlayerAnalytics,
  getTeamAnalytics,
  getTeamTrends,
} from '../controllers/analytics';
import { optionalAuth } from '../middleware/auth';
import { visibleByTeamParam, visibleByMatchParam } from '../middleware/visibility';

const router = Router();

// Analytics reads are public for public teams; private teams are hidden from
// non-members. optionalAuth populates req.user when a token is present so the
// per-route visibility guard can tell "no token" from "wrong user".
router.use(optionalAuth);

const mVis = visibleByMatchParam('matchId');
const tVis = visibleByTeamParam('teamId');

router.get('/matches/:matchId', mVis, getMatchAnalytics);
router.get('/matches/:matchId/report', mVis, getMatchReport);
router.get('/teams/:teamId', tVis, getTeamAnalytics);
router.get('/teams/:teamId/trends', tVis, getTeamTrends);
// No pVis: that checks the player's HOME team, but staff of a linked team
// can't see it. The controller checks visibility of the team in scope instead.
router.get('/players/:playerId', getPlayerAnalytics);

export default router;
