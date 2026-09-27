import { Router } from 'express';
import { register, login, logout, me, forgotPassword, resetPassword } from '../controllers/auth';
import { requireAuth } from '../middleware/auth';
import {
  forgotPasswordGlobalRateLimit,
  forgotPasswordRateLimit,
  loginEmailRateLimit,
  loginIpRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
} from '../middleware/rateLimit';

const router = Router();

// Unauthenticated + credential-checking, so both are credential-stuffing /
// spray targets. IP and email arms are separate limiters (see rateLimit.ts).
router.post('/register', registerRateLimit, register);
router.post('/login', loginIpRateLimit, loginEmailRateLimit, login);
router.post('/logout', logout);
// Public by design — the emailed reset token is itself the credential. Rate
// limited on IP + email: unauthenticated, and it sends mail, so it is both an
// email-bombing vector and the obvious endpoint to hammer for enumeration.
router.post('/forgot-password', forgotPasswordGlobalRateLimit, forgotPasswordRateLimit, forgotPassword);
// Brute-force defence in depth on the reset token itself (see rateLimit.ts).
router.post('/reset-password', resetPasswordRateLimit, resetPassword);
router.get('/me', requireAuth, me);

export default router;
