import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { isEmailAddress, normalizeEmail } from '../lib/email';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  requestPasswordReset,
  resetPassword as resetPasswordService,
} from '../services/auth.service';
import { verifyEmail as verifyEmailService, resendVerification as resendVerificationService } from '../services/emailVerification.service';

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, firstName, lastName, signupIntent, acceptTerms } = req.body;
    if (!email || !password || !firstName || !lastName) {
      throw new AppError(400, 'email, password, firstName, and lastName are required.');
    }
    // 9.3: 13+ and the Terms, ticked on the form. App builds older than
    // v9.17.0 don't send it and get this 400 (none are shared).
    if (acceptTerms !== true) {
      throw new AppError(400, "Please confirm you're 13 or older and accept the Terms.");
    }
    // A JSON body can carry any type; a non-string reached .trim() and 500'd.
    if (typeof email !== 'string' || typeof password !== 'string' || !isEmailAddress(normalizeEmail(email))) {
      throw new AppError(400, 'Enter a valid email address and password.');
    }
    const result = await registerUser(email, password, firstName, lastName, signupIntent ?? null);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new AppError(400, 'email and password are required.');
    }
    const result = await loginUser(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// The response here is deliberately identical whether or not an account exists
// for that email — anything else would leak which addresses are registered.
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    if (typeof email !== 'string' || !email) throw new AppError(400, 'Email is required.');
    await requestPasswordReset(email);
    res.json({ message: "If an account exists for that email, we've sent a reset link." });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body;
    if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
      throw new AppError(400, 'Token and password are required.');
    }
    await resetPasswordService(token, password);
    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (err) {
    next(err);
  }
}

// Logout is handled client-side (discard the token).
// This endpoint exists as a clean hook for future server-side token revocation.
export function logout(_req: Request, res: Response) {
  res.json({ message: 'Logged out successfully.' });
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const user = await getCurrentUser(req.user.userId);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body;
    if (!token) throw new AppError(400, 'Token is required.');
    await verifyEmailService(token);
    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const alreadyVerified = await resendVerificationService(req.user.userId);
    if (alreadyVerified) {
      res.json({ verified: true });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
