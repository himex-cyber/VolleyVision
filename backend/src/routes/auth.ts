import { Router } from 'express';
import { register, login, logout, me, forgotPassword, resetPassword, verifyEmail, resendVerification } from '../controllers/auth';
import { requireAuth } from '../middleware/auth';
import {
  forgotPasswordGlobalRateLimit,
  forgotPasswordRateLimit,
  loginEmailRateLimit,
  loginIpRateLimit,
  registerRateLimit,
  resetPasswordRateLimit,
  verifyEmailRateLimit,
  resendVerificationRateLimit,
  resendVerificationIpRateLimit,
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
// Per-IP/email first: the global cap must only be spent by requests that pass
// it, or one IP could drain it and block everyone's resets.
router.post('/forgot-password', forgotPasswordRateLimit, forgotPasswordGlobalRateLimit, forgotPassword);
// Brute-force defence in depth on the reset token itself (see rateLimit.ts).
router.post('/reset-password', resetPasswordRateLimit, resetPassword);
router.get('/me', requireAuth, me);
// Public by design — the emailed verification token is itself the credential.
// Rate limited on IP only (defence in depth, see rateLimit.ts).
router.post('/verify-email', verifyEmailRateLimit, verifyEmail);
router.post('/resend-verification', requireAuth, resendVerificationRateLimit, resendVerificationIpRateLimit, resendVerification);

export default router;
