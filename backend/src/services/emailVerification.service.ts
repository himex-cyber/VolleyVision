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

/**
 * Mints a fresh token, stores its hash (overwriting any previous one — one
 * live token per user, same as password reset) and emails it. Never throws on
 * a failed send: the caller's own action (register, resend) must still
 * succeed, matching how invitations and password resets already degrade.
 */
export async function issueVerificationEmail(user: { id: string; email: string; firstName: string }): Promise<void> {
  const token = crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_BYTES).toString('hex');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationTokenHash: hashEmailVerificationToken(token),
      emailVerificationExpiresAt: emailVerificationExpiry(),
    },
  });

  try {
    const sent = await sendVerificationEmail(user.email, user.firstName, token);
    // No address in the log — matches the mailer's existing logging discipline.
    if (!sent) console.warn(`[emailVerification] Email not sent for user ${user.id}`);
  } catch (err) {
    console.error(`[emailVerification] Unexpected error sending email for user ${user.id}:`, err);
  }
}

/** Consumes a verification token. Invalid/expired → generic 400, no detail leaked. */
export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: usableEmailVerificationWhere(token) });
  if (!user) {
    throw new AppError(400, 'This verification link is invalid or has expired.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), ...CONSUMED_EMAIL_VERIFICATION_FIELDS },
  });
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
