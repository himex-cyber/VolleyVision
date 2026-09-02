import { Router } from 'express';
import { myMemberships, userSearch } from '../controllers/teamMembership';
import { myInvitations } from '../controllers/invitation';
import { requireAuth } from '../middleware/auth';
import { userLookupRateLimit } from '../middleware/rateLimit';

const router = Router();

router.get('/me/teams', requireAuth, myMemberships);
router.get('/me/invitations', requireAuth, myInvitations);
router.get('/search', requireAuth, userLookupRateLimit, userSearch);

export default router;
