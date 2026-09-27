import { Router } from 'express';
import { myMemberships } from '../controllers/teamMembership';
import { myInvitations } from '../controllers/invitation';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/me/teams', requireAuth, myMemberships);
router.get('/me/invitations', requireAuth, myInvitations);

export default router;
