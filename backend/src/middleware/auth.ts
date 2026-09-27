import { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthPayload } from '../services/auth.service';
import { prisma } from '../lib/prisma';
import { isTokenCurrent } from '../lib/tokenVersion';
import { AppError } from './errorHandler';

// Extend Express Request to carry the decoded token payload
declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/**
 * True when the token's tv claim still matches the user's live tokenVersion
 * (M7 part 2) — the DB read is what makes a password reset able to revoke a
 * stateless JWT that's already been handed out. A deleted user has no
 * tokenVersion to match, so it fails closed the same way a stale one does.
 */
async function tokenIsCurrent(payload: AuthPayload): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
  if (!user) return false;
  return isTokenCurrent(payload.tv, user.tokenVersion);
}

/** Verifies the Bearer token and attaches the decoded payload to req.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    if (!(await tokenIsCurrent(payload))) {
      res.status(401).json({ error: 'Session expired. Sign in again.' });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      res.status(401).json({ error: 'Invalid or expired token.' });
      return;
    }
    // A DB failure while checking tokenVersion is a 500, not a silent hang or
    // a misleading 401 — let the shared error handler classify it.
    next(err);
  }
}

/** Like requireAuth but only attaches the user if a valid token is present.
 *  Non-authenticated requests pass through without error. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    if (await tokenIsCurrent(payload)) {
      req.user = payload;
    }
    // An invalid/stale/revoked token is silently ignored here too — optionalAuth
    // never rejects a request, it just proceeds unauthenticated.
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next();
      return;
    }
    next(err);
  }
}
