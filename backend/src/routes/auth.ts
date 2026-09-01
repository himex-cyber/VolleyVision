import { Router } from 'express';
import { register, login, logout, me, forgotPassword, resetPassword } from '../controllers/auth';
import { requireAuth } from '../middleware/auth';
import { forgotPasswordGlobalRateLimit, forgotPasswordRateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
// Public by design — the emailed reset token is itself the credential. Rate
// limited on IP + email: unauthenticated, and it sends mail, so it is both an
// email-bombing vector and the obvious endpoint to hammer for enumeration.
router.post('/forgot-password', forgotPasswordGlobalRateLimit, forgotPasswordRateLimit, forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', requireAuth, me);

export default router;
