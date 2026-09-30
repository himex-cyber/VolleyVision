import { Router } from 'express';
import { getProfileHandler, updateProfileHandler, acceptTermsHandler } from '../controllers/profile';
import { requireAuth } from '../middleware/auth';
import { termsAcceptRateLimit } from '../middleware/rateLimit';

const router = Router();

router.get('/', requireAuth, getProfileHandler);
router.patch('/', requireAuth, updateProfileHandler);
router.post('/accept-terms', requireAuth, termsAcceptRateLimit, acceptTermsHandler);

export default router;
