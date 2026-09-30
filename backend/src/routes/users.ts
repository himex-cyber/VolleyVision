import { Router } from 'express';
import { myMemberships } from '../controllers/teamMembership';
import { myInvitations } from '../controllers/invitation';
import { requireAuth } from '../middleware/auth';
import { blockRateLimit } from '../middleware/rateLimit';
import { listBlocksHandler, unblockHandler } from '../controllers/messages';

const router = Router();

router.get('/me/teams', requireAuth, myMemberships);
router.get('/me/invitations', requireAuth, myInvitations);
router.get('/me/blocks', requireAuth, listBlocksHandler);
router.delete('/me/blocks/:blockId', requireAuth, blockRateLimit, unblockHandler);

export default router;
