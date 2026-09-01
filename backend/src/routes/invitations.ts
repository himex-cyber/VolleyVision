import { Router } from 'express';
import { acceptInvitationHandler, declineInvitationHandler, redeemInvitationHandler } from '../controllers/invitation';
import { lookupCodeHandler, redeemTeamJoinCodeHandler } from '../controllers/teamJoinCode';
import { requireAuth } from '../middleware/auth';
import { joinCodeRateLimit } from '../middleware/rateLimit';

const router = Router();

// Redeem by join code (email flow). requireAuth: the user must be logged in so
// we know who joins — the RedeemInvitationPage handles login/register first.
router.post('/redeem', requireAuth, redeemInvitationHandler);

// Reusable team join codes: classify a code (so the UI can show a role picker
// for staff codes before redeeming) and redeem it. Team codes are self-serve —
// no email lock, no approval step, which is why both are rate limited: they are
// the only endpoints where a guessed code alone grants team membership.
router.get('/lookup/:code', requireAuth, joinCodeRateLimit, lookupCodeHandler);
router.post('/redeem-team-code', requireAuth, joinCodeRateLimit, redeemTeamJoinCodeHandler);
router.post('/:token/accept', requireAuth, acceptInvitationHandler);
router.post('/:token/decline', requireAuth, declineInvitationHandler);

export default router;
