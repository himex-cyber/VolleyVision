import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { sendVerificationEmail } from '../lib/mailer';
import {
  CONSUMED_EMAIL_VERIFICATION_FIELDS,
  EMAIL_VERIFICATION_TOKEN_BYTES,
  emailVerificationExpiry,
  hashEmailVerificationToken,
  usableEmailVerificationWhere,
} from '../lib/emailVerification';

/** Mints a fresh token and its hash+expiry, without touching the database.
 *  Split out so registerUser can persist it in the SAME `user.create` call
 *  instead of a second write after the user already exists — a create
 *  followed by a separate token write leaves a user with no token, and no way
 *  to re-register, if that second write fails. */
export function mintVerificationToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString('hex');
  return { token, tokenHash: hashEmailVerificationToken(token), expiresAt: emailVerificationExpiry() };
}

/** Sends the verification email for an already-minted token. Never throws: a
 *  failed *send* must not fail the caller's own action (register, resend). */
export async function sendVerificationEmailBestEffort(
  user: { id: string; email: string; firstName: string },
  token: string,
): Promise<void> {
  try {
    const sent = await sendVerificationEmail(user.email, user.firstName, token);
    // No address in the log — matches the mailer's existing logging discipline.
    if (!sent) console.warn(`[emailVerification] Email not sent for user ${user.id}`);
  } catch (err) {
    console.error(`[emailVerification] Unexpected error sending email for user ${user.id}:`, err);
  }
}

/**
 * Resend path: mints a token, persists it (overwriting any previous one — one
 * live token per user, same as password reset), then emails it. registerUser
 * does NOT use this — it mints+persists the token atomically with the user
 * row instead, then calls sendVerificationEmailBestEffort directly.
 */
export async function issueVerificationEmail(user: { id: string; email: string; firstName: string }): Promise<void> {
  const { token, tokenHash, expiresAt } = mintVerificationToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
  });
  await sendVerificationEmailBestEffort(user, token);
}

/** Consumes a verification token. The match-and-clear is one conditional
 *  updateMany rather than a lookup followed by an update-by-id — the
 *  previous two-step form let a concurrent verify or resend win the race
 *  between the lookup and the write, consuming the same token twice or
 *  clearing a token a resend had just replaced. `count === 0` covers
 *  not-found, already-expired, and already-consumed alike. */
export async function verifyEmail(token: string): Promise<void> {
  const result = await prisma.user.updateMany({
    where: usableEmailVerificationWhere(token),
    data: { emailVerifiedAt: new Date(), ...CONSUMED_EMAIL_VERIFICATION_FIELDS },
  });
  if (result.count === 0) {
    throw new AppError(400, 'This verification link is invalid or has expired.');
  }
}

/** Already verified → true, no email sent (idempotent for a double-click). */
export async function resendVerification(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
  });
  if (!user) throw new AppError(404, 'User not found.');
  if (user.emailVerifiedAt) return true;

  await issueVerificationEmail(user);
  return false;
}

/**
 * Gate for every self-service "join a team" action (accept invitation, redeem
 * a join code, claim a player record). Team *creation* is deliberately not
 * gated — the owner is creating, not joining, and unverified accounts still
 * need to be able to use the rest of the app while they check their inbox.
 */
export async function assertEmailVerified(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) {
    throw new AppError(403, 'Verify your email address before joining a team.', 'EMAIL_NOT_VERIFIED');
  }
}
