import { Router } from 'express';
import { getProfileHandler, updateProfileHandler, acceptTermsHandler, deleteAccountHandler } from '../controllers/profile';
import { requireAuth } from '../middleware/auth';
import { termsAcceptRateLimit, accountDeleteRateLimit } from '../middleware/rateLimit';

const router = Router();

router.get('/', requireAuth, getProfileHandler);
router.patch('/', requireAuth, updateProfileHandler);
router.post('/accept-terms', requireAuth, termsAcceptRateLimit, acceptTermsHandler);
router.delete('/', requireAuth, accountDeleteRateLimit, deleteAccountHandler);

export default router;
