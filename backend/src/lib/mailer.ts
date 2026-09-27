import nodemailer, { Transporter } from 'nodemailer';
import { escapeHtml } from './escapeHtml';

/**
 * Email delivery over SMTP (Gmail by default). Configured via env:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 *
 * SMTP_PASS must be a Gmail App Password (requires 2FA). When it's unset, the
 * mailer degrades gracefully: it logs a warning and reports failure instead of
 * throwing, so invitation creation still succeeds in environments without email
 * configured (the join code is surfaced in the UI as a manual fallback).
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null; // not configured — caller handles the null/failure path
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: (process.env.SMTP_SECURE ?? 'true') !== 'false',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends an email. Returns true on success, false on failure (including "not
 * configured"). Never throws — callers decide how to surface a failed send.
 */
export async function sendMail({ to, subject, html, text }: MailInput): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    console.warn(`[mailer] SMTP not configured (SMTP_PASS missing) — skipped email: "${subject}"`);
    return false;
  }
  try {
    await tx.sendMail({
      // Display name only — this is the SMTP "From" header nodemailer sends
      // for this app's own emails specifically. It doesn't touch the Gmail
      // account's own settings or anything sent from that inbox any other way.
      from: `"VolleyVision" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: text ?? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      html,
    });
    return true;
  } catch (err) {
    console.error(`[mailer] Failed to send email ("${subject}"):`, err);
    return false;
  }
}

// ── Invitation email ──────────────────────────────────────────────────────────

interface InvitationEmailData {
  email: string;
  role: string;
  team: { name: string };
  invitedBy: { firstName: string; lastName: string };
}

/**
 * Sends the branded team-invitation email carrying the human-enterable join
 * code and a redeem link. Returns true on success, false otherwise.
 */
export async function sendInvitationEmail(inv: InvitationEmailData, joinCode: string): Promise<boolean> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const redeemUrl = `${clientUrl}/invitations/redeem?code=${encodeURIComponent(joinCode)}`;
  // roleLabel is derived from the TeamRole enum, not user input, so it's the
  // one interpolated value below that doesn't need escaping.
  const inviter = escapeHtml(`${inv.invitedBy.firstName} ${inv.invitedBy.lastName}`.trim());
  const teamName = escapeHtml(inv.team.name);
  const roleLabel = inv.role.replace(/_/g, ' ').toLowerCase();

  const html = `
  <div style="font-family:'Inter',system-ui,sans-serif;background:#111C36;color:#E4E9F4;padding:32px;border-radius:12px;max-width:520px;margin:0 auto;">
    <h1 style="font-family:'Barlow Semi Condensed',sans-serif;color:#FFB81C;font-size:24px;margin:0 0 4px;">VolleyVision</h1>
    <p style="color:#8FA0C4;font-size:13px;margin:0 0 24px;">See the game. Raise your game.</p>
    <p style="font-size:15px;line-height:1.5;">
      <strong>${inviter}</strong> invited you to join
      <strong>${teamName}</strong> as <strong>${roleLabel}</strong> on VolleyVision.
    </p>
    <div style="background:#1A2745;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
      <p style="color:#8FA0C4;font-size:12px;margin:0 0 6px;">Your join code</p>
      <p style="font-family:monospace;font-size:28px;letter-spacing:4px;color:#FFFFFF;margin:0;font-weight:700;">${joinCode}</p>
    </div>
    <a href="${redeemUrl}" style="display:inline-block;background:#FFB81C;color:#111C36;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;">Accept invitation</a>
    <p style="color:#8FA0C4;font-size:12px;line-height:1.5;margin:20px 0 0;">
      Or go to ${clientUrl}/invitations/redeem and enter the code above. New to VolleyVision?
      You can create your account on the same screen. This invitation expires in 7 days.
    </p>
  </div>`;

  return sendMail({
    to: inv.email,
    subject: `You're invited to join ${inv.team.name} on VolleyVision`,
    html,
  });
}

// ── Password reset email ──────────────────────────────────────────────────────

interface PasswordResetEmailData {
  email: string;
  firstName: string;
}

/**
 * Sends the branded password-reset email. Unlike the invitation email there is
 * deliberately no manual/UI fallback for the raw token — surfacing it anywhere
 * other than the recipient's inbox would defeat the point of emailing it. If
 * SMTP isn't configured this no-ops and returns false, exactly like invitations.
 */
export async function sendPasswordResetEmail(user: PasswordResetEmailData, token: string): Promise<boolean> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const html = `
  <div style="font-family:'Inter',system-ui,sans-serif;background:#111C36;color:#E4E9F4;padding:32px;border-radius:12px;max-width:520px;margin:0 auto;">
    <h1 style="font-family:'Barlow Semi Condensed',sans-serif;color:#FFB81C;font-size:24px;margin:0 0 4px;">VolleyVision</h1>
    <p style="color:#8FA0C4;font-size:13px;margin:0 0 24px;">See the game. Raise your game.</p>
    <p style="font-size:15px;line-height:1.5;">
      Hi ${escapeHtml(user.firstName)}, we received a request to reset your VolleyVision password.
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:#FFB81C;color:#111C36;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;margin:16px 0;">Reset password</a>
    <p style="color:#8FA0C4;font-size:12px;line-height:1.5;margin:20px 0 0;">
      This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
  </div>`;

  return sendMail({ to: user.email, subject: 'Reset your VolleyVision password', html });
}

// ── Email verification ────────────────────────────────────────────────────────

/**
 * Sends the branded email-verification email. Same shape as the password-reset
 * email, just pointed at /verify-email and with the 24h TTL in the copy.
 * Failure to send must not fail registration — callers swallow the result the
 * same way requestPasswordReset does.
 */
export async function sendVerificationEmail(to: string, firstName: string, token: string): Promise<boolean> {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const verifyUrl = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
  <div style="font-family:'Inter',system-ui,sans-serif;background:#111C36;color:#E4E9F4;padding:32px;border-radius:12px;max-width:520px;margin:0 auto;">
    <h1 style="font-family:'Barlow Semi Condensed',sans-serif;color:#FFB81C;font-size:24px;margin:0 0 4px;">VolleyVision</h1>
    <p style="color:#8FA0C4;font-size:13px;margin:0 0 24px;">See the game. Raise your game.</p>
    <p style="font-size:15px;line-height:1.5;">
      Hi ${escapeHtml(firstName)}, please verify your email address to join teams on VolleyVision.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;background:#FFB81C;color:#111C36;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;margin:16px 0;">Verify email</a>
    <p style="color:#8FA0C4;font-size:12px;line-height:1.5;margin:20px 0 0;">
      This link expires in 24 hours. If you didn't create a VolleyVision account, you can safely ignore this email.
    </p>
  </div>`;

  return sendMail({ to, subject: 'Verify your VolleyVision email address', html });
}
