import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { sendPasswordResetEmail } from '../lib/mailer';
import {
  CONSUMED_RESET_FIELDS,
  RESET_TOKEN_BYTES,
  hashResetToken,
  resetTokenExpiry,
  usableResetTokenWhere,
} from '../lib/passwordReset';

const SALT_ROUNDS = 12;

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    profileImage: string | null;
    signupIntent: string | null;
  };
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured.');
  return secret;
}

function jwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? '7d';
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: jwtExpiresIn() } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthPayload {
  try {
    return jwt.verify(token, jwtSecret()) as AuthPayload;
  } catch {
    throw new AppError(401, 'Invalid or expired token.');
  }
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

const VALID_SIGNUP_INTENTS = new Set(['COACH', 'PLAYER', 'UNSURE']);

export async function registerUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  signupIntent: string | null = null,
): Promise<AuthResponse> {
  if (password.length < 8) {
    throw new AppError(400, 'Password must be at least 8 characters.');
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new AppError(409, 'An account with that email already exists.');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const intent = signupIntent && VALID_SIGNUP_INTENTS.has(signupIntent)
    ? (signupIntent as 'COACH' | 'PLAYER' | 'UNSURE')
    : null;

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      firstName,
      lastName,
      ...(intent ? { signupIntent: intent } : {}),
    },
  });

  const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role };
  const token = generateToken(payload);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      profileImage: user.profileImage,
      signupIntent: user.signupIntent ?? null,
    },
  };
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError(401, 'Invalid email or password.');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'Invalid email or password.');

  const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role };
  const token = generateToken(payload);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      profileImage: user.profileImage,
      signupIntent: user.signupIntent ?? null,
    },
  };
}

// ── Forgot password ───────────────────────────────────────────────────────────

/**
 * Floor on how long requestPasswordReset takes, whichever branch it runs.
 *
 * The identical success message is pointless if the response *time* still says
 * whether the address is registered. Only work that fits inside the floor can
 * be padded away, and an SMTP send does not: a real TLS handshake + AUTH + DATA
 * routinely runs past a second, so awaiting it made the registered branch
 * overshoot while the unknown branch landed on the floor — the oracle, restored.
 * The send is therefore dispatched *after* the floor and never awaited; only
 * the DB work each branch does is inside the budget.
 *
 * ponytail: a fixed floor, not constant-time crypto — a pathologically slow DB
 * could still overshoot it. The rate limit on this route (5 per 15 min per IP
 * and per email) is what makes exploiting any residual difference across a
 * meaningful number of addresses impractical.
 */
const FORGOT_PASSWORD_FLOOR_MS = 1200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Issues a single-use reset link. Silent no-op for an unknown email: the
 * controller returns the same generic message either way, so this endpoint
 * can't be used to enumerate which addresses have accounts.
 *
 * Requesting a new link overwrites the stored hash, invalidating any previous
 * one — there is at most one live reset token per user.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const startedAt = Date.now();
  let dispatchEmail: (() => void) | undefined;
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');

    if (!user) {
      // Not shape-matched to the known branch — that one does a DB update and no
      // bcrypt at all. This is only a CPU-time pad so an unknown address isn't
      // near-instant should the floor below ever be removed; the floor, not this,
      // is what actually equalises the two branches. No email is sent for an
      // address that has no account.
      await bcrypt.hash(token, SALT_ROUNDS);
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: hashResetToken(token),
        passwordResetExpiresAt: resetTokenExpiry(),
      },
    });

    // Deferred to after the floor and deliberately not awaited: an SMTP round
    // trip inside the measured response is exactly the timing signal the floor
    // exists to remove, and a delivery failure must not change the response the
    // caller sees. sendPasswordResetEmail swallows send errors today and returns
    // false, but nothing awaits this promise any more — the .catch is what keeps
    // a rejection it ever grows from becoming an unhandled one.
    dispatchEmail = () => {
      void sendPasswordResetEmail({ email: user.email, firstName: user.firstName }, token).catch(
        (err) => console.error('Password reset email failed to send:', err),
      );
    };
  } finally {
    const remaining = FORGOT_PASSWORD_FLOOR_MS - (Date.now() - startedAt);
    if (remaining > 0) await sleep(remaining);
    dispatchEmail?.();
  }
}

/**
 * Consumes a reset token and sets the new password. The token is single-use —
 * both reset columns are cleared on success, so the same link can't be replayed.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) {
    throw new AppError(400, 'Password must be at least 8 characters.');
  }

  const user = await prisma.user.findFirst({ where: usableResetTokenWhere(token) });
  if (!user) {
    throw new AppError(400, 'This reset link is invalid or has expired. Request a new one.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
      ...CONSUMED_RESET_FIELDS,
    },
  });
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      profileImage: true,
      signupIntent: true,
      createdAt: true,
    },
  });
  if (!user) throw new AppError(404, 'User not found.');
  return user;
}
