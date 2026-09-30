import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { sendPasswordResetEmail } from '../lib/mailer';
import { normalizeEmail } from '../lib/email';
import { CURRENT_TERMS_VERSION, TERMS_REQUIRED_MESSAGE, termsRequired } from '../lib/terms';
import {
  CONSUMED_RESET_FIELDS,
  RESET_TOKEN_BYTES,
  hashResetToken,
  resetTokenExpiry,
  usableResetTokenWhere,
} from '../lib/passwordReset';
import { mintVerificationToken, sendVerificationEmailBestEffort } from './emailVerification.service';

const SALT_ROUNDS = 12;

/**
 * Hashed once at module load, compared against on every login with an unknown
 * email. Without this, an unknown-email response returns as soon as the
 * findUnique misses, while a known-email/wrong-password response waits on a
 * bcrypt.compare — the response-time gap is itself an account-enumeration
 * oracle even though both branches return the same 401 body.
 */
// Precomputed (cost 12, same as SALT_ROUNDS) rather than hashSync at load:
// that would add ~250 ms to every Netlify Function cold start.
const DUMMY_PASSWORD_HASH = '$2b$12$8kEnWXiVftUN3DWYnK3NfODyDjlqvMPF2Vkoq4TLE1SY3JXHsI9tW';

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  // Token-revocation version (audit M7 part 2). Optional on the decoded side
  // only: a token minted before this shipped carries no `tv` at all, and
  // requireAuth/optionalAuth treat that as tv 0 — see lib/tokenVersion.ts.
  tv?: number;
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
    emailVerified: boolean;
    // 9.3, additive: when the Terms were accepted and which version, and
    // whether the app must ask (never accepted, or an older version).
    termsAcceptedAt: Date | null;
    termsVersion: string | null;
    termsRequired: boolean;
  };
}

type UserRow = {
  id: string; email: string; firstName: string; lastName: string; role: string; profileImage: string | null;
  signupIntent: string | null; emailVerifiedAt: Date | null; termsAcceptedAt: Date | null; termsVersion: string | null;
};

function toAuthUser(user: UserRow): AuthResponse['user'] {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    profileImage: user.profileImage,
    signupIntent: user.signupIntent ?? null,
    emailVerified: user.emailVerifiedAt != null,
    termsAcceptedAt: user.termsAcceptedAt,
    termsVersion: user.termsVersion,
    termsRequired: termsRequired(user),
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

  // Accepted risk: this 409 is an account-enumeration oracle, but
  // registerUser logs the caller in on success (see the token below) — the
  // response has to shape-diverge from "you're now logged in" somehow, so
  // hiding existence here would require redesigning signup into a confirm-only
  // flow. Out of scope for this fix; rate-limited via registerRateLimit.
  const existing = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (existing) throw new AppError(409, 'An account with that email already exists.');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const intent = signupIntent && VALID_SIGNUP_INTENTS.has(signupIntent)
    ? (signupIntent as 'COACH' | 'PLAYER' | 'UNSURE')
    : null;

  // Mint the verification token BEFORE the
  // create and persist its hash/expiry in the same `user.create` call. The
  // previous create-then-write-token-separately sequence could leave a user
  // row with no token if the second write failed — the account would then
  // exist with no way to verify, and re-registering that email 409s forever.
  const { token: verificationToken, tokenHash, expiresAt } = mintVerificationToken();

  const user = await prisma.user.create({
    data: {
      email: normalizeEmail(email),
      passwordHash,
      firstName,
      lastName,
      ...(intent ? { signupIntent: intent } : {}),
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
      // The controller refused the signup unless the 13+ / Terms box was ticked.
      termsAcceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    },
  });

  const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role, tv: user.tokenVersion };
  const token = generateToken(payload);

  // The token is already persisted above; only the send is best-effort and
  // must not fail registration (sendVerificationEmailBestEffort swallows it).
  await sendVerificationEmailBestEffort(user, verificationToken);

  return {
    token,
    user: toAuthUser(user),
  };
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH); // pad timing, see DUMMY_PASSWORD_HASH
    throw new AppError(401, 'Invalid email or password.');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new AppError(401, 'Invalid email or password.');

  const payload: AuthPayload = { userId: user.id, email: user.email, role: user.role, tv: user.tokenVersion };
  const token = generateToken(payload);

  return {
    token,
    user: toAuthUser(user),
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
 * ponytail: a fixed floor, not constant-time crypto — a pathologically slow DB or SMTP server
 * could still overshoot it. The rate limit on this route (5 per 15 min per IP
 * and per email) is what makes exploiting any residual difference across a
 * meaningful number of addresses impractical.
 */
// 4s, not the original 1.2s: the reset email is now sent inside this window
// (a Netlify Function can be frozen once it responds, so it must be awaited),
// and a Gmail SMTP round trip from the function takes ~1-2.5s. The floor has
// to outlast the send or a real address answers measurably slower.
const FORGOT_PASSWORD_FLOOR_MS = 4000;

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
  let sendEmail: (() => Promise<void>) | undefined;
  try {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

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

    // Deferred to after the floor, but AWAITED rather than fired
    // and forgotten. A Netlify Function can be frozen the instant the HTTP
    // response goes out, so the previous fire-and-forget send was silently
    // dropped in production before it ever reached SMTP. A failed send must
    // still not throw (swallowed below, same as before) — only the sending
    // is awaited, not its success.
    sendEmail = () =>
      sendPasswordResetEmail({ email: user.email, firstName: user.firstName }, token)
        .then(() => undefined)
        .catch((err) => console.error('Password reset email failed to send:', err));
  } finally {
    const remaining = FORGOT_PASSWORD_FLOOR_MS - (Date.now() - startedAt);
    // Both the floor padding and the send (when there is one) are awaited
    // together: the unknown-address branch still only waits out the floor
    // (no sendEmail is set), so the enumeration protection above is intact.
    await Promise.all([remaining > 0 ? sleep(remaining) : Promise.resolve(), sendEmail?.() ?? Promise.resolve()]);
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

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Match-and-clear in one conditional updateMany rather than a lookup
  // followed by an update-by-id. The previous two-step form let a concurrent
  // reset or resend win the race between the lookup and the write — either
  // consuming the same token twice, or clearing a token a fresh request had
  // just replaced. `count === 0` covers not-found, expired, and already-used.
  const result = await prisma.user.updateMany({
    where: usableResetTokenWhere(token),
    data: {
      passwordHash,
      ...CONSUMED_RESET_FIELDS,
      // Revoke every other outstanding session (M7 part 2) — a password reset
      // is exactly the moment a stolen token should stop working.
      tokenVersion: { increment: 1 },
    },
  });
  if (result.count === 0) {
    throw new AppError(400, 'This reset link is invalid or has expired. Request a new one.');
  }
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
      emailVerifiedAt: true,
      termsAcceptedAt: true,
      termsVersion: true,
    },
  });
  if (!user) throw new AppError(404, 'User not found.');
  const { emailVerifiedAt, ...rest } = user;
  return { ...rest, emailVerified: emailVerifiedAt != null, termsRequired: termsRequired(user) };
}

/** POST /profile/accept-terms (9.3): the current Terms, accepted now. */
export async function acceptTerms(userId: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION },
    select: { termsAcceptedAt: true, termsVersion: true },
  });
  return { ...user, termsRequired: false };
}

/** Posting in team chat needs the current Terms (9.3); 403 TERMS_REQUIRED otherwise. */
export async function assertTermsAccepted(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { termsAcceptedAt: true, termsVersion: true } });
  if (!user || termsRequired(user)) throw new AppError(403, TERMS_REQUIRED_MESSAGE, 'TERMS_REQUIRED');
}
