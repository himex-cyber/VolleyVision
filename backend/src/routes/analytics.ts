import { Router } from 'express';
import {
  getMatchAnalytics,
  getMatchReport,
  getPlayerAnalytics,
  getTeamAnalytics,
  getTeamTrends,
} from '../controllers/analytics';
import { optionalAuth } from '../middleware/auth';
import { visibleByTeamParam, visibleByMatchParam, visibleByPlayerParam } from '../middleware/visibility';

const router = Router();

// Analytics reads are public for public teams; private teams are hidden from
// non-members. optionalAuth populates req.user when a token is present so the
// per-route visibility guard can tell "no token" from "wrong user".
router.use(optionalAuth);

const mVis = visibleByMatchParam('matchId');
const tVis = visibleByTeamParam('teamId');
const pVis = visibleByPlayerParam('playerId');

router.get('/matches/:matchId', mVis, getMatchAnalytics);
router.get('/matches/:matchId/report', mVis, getMatchReport);
router.get('/teams/:teamId', tVis, getTeamAnalytics);
router.get('/teams/:teamId/trends', tVis, getTeamTrends);
router.get('/players/:playerId', pVis, getPlayerAnalytics);

export default router;
