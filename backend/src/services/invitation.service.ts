import { randomUUID } from 'crypto';
import { InvitationStatus, TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateUniqueCode, normalizeCode } from '../lib/joinCode';
import { addMember, isMember } from './teamMembership.service';
import { canActInCategory } from './permission.service';
import { AppError } from '../middleware/errorHandler';
import { sendInvitationEmail } from '../lib/mailer';

const EXPIRY_DAYS = 7;

function generateUniqueJoinCode(): Promise<string> {
  return generateUniqueCode(async (code) =>
    (await prisma.invitation.findUnique({ where: { joinCode: code }, select: { id: true } })) !== null,
  );
}

export async function createInvitation(
  teamId: string,
  invitedById: string,
  email: string,
  role: TeamRole,
) {
  // Check the team exists
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw Object.assign(new Error('Team not found'), { statusCode: 404 });

  // Prevent duplicate pending invitation for the same email+team
  const existing = await prisma.invitation.findFirst({
    where: { teamId, email, status: InvitationStatus.PENDING },
  });
  if (existing) {
    throw Object.assign(
      new Error('A pending invitation already exists for this email on this team'),
      { statusCode: 409 },
    );
  }

  const token = randomUUID();
  const joinCode = await generateUniqueJoinCode();
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: { email, teamId, invitedById, role, token, joinCode, expiresAt },
    include: { team: { select: { id: true, name: true } }, invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });

  // Fire the invitation email. Never let a delivery failure fail the request —
  // the invitation still exists and the code can be shared manually. The send
  // result is surfaced to the client (emailSent) so the UI can offer the code
  // as a manual fallback when delivery didn't happen.
  let emailSent = false;
  try {
    emailSent = await sendInvitationEmail(invitation, joinCode);
    if (!emailSent) console.warn(`[invitation] Email not sent for invitation ${invitation.id} (${email}) — code ${joinCode}`);
  } catch (err) {
    console.error(`[invitation] Unexpected error sending email for invitation ${invitation.id}:`, err);
  }

  return { ...invitation, emailSent };
}

export async function acceptInvitation(token: string, userId: string) {
  const inv = await prisma.invitation.findUnique({ where: { token } });
  if (!inv) throw Object.assign(new Error('Invitation not found'), { statusCode: 404 });
  if (inv.status !== InvitationStatus.PENDING) {
    throw Object.assign(new Error(`Invitation is ${inv.status.toLowerCase()}`), { statusCode: 409 });
  }
  if (inv.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: InvitationStatus.EXPIRED } });
    throw Object.assign(new Error('Invitation has expired'), { statusCode: 410 });
  }

  // Verify the authenticated user's email matches the invitation
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw Object.assign(new Error('This invitation was sent to a different email address'), { statusCode: 403 });
  }

  const alreadyMember = await isMember(inv.teamId, userId);
  if (alreadyMember) {
    throw Object.assign(new Error('You are already a member of this team'), { statusCode: 409 });
  }

  await addMember(inv.teamId, userId, inv.role);

  return prisma.invitation.update({
    where: { id: inv.id },
    data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    include: { team: { select: { id: true, name: true } } },
  });
}

/**
 * Redeem an invitation by its human-enterable join code. Same effect as
 * acceptInvitation (creates the TeamMembership) but keyed on joinCode — used by
 * the email/redeem flow. The user must be authenticated; their email must match
 * the invited address.
 */
export async function redeemInvitationByCode(joinCode: string, userId: string) {
  const inv = await prisma.invitation.findUnique({ where: { joinCode: normalizeCode(joinCode) } });
  if (!inv) throw Object.assign(new Error('Invalid or unknown join code'), { statusCode: 404 });
  if (inv.status !== InvitationStatus.PENDING) {
    throw Object.assign(new Error(`Invitation is ${inv.status.toLowerCase()}`), { statusCode: 409 });
  }
  if (inv.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: InvitationStatus.EXPIRED } });
    throw Object.assign(new Error('Invitation has expired'), { statusCode: 410 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw Object.assign(new Error('This invitation was sent to a different email address'), { statusCode: 403 });
  }

  const alreadyMember = await isMember(inv.teamId, userId);
  if (alreadyMember) {
    throw Object.assign(new Error('You are already a member of this team'), { statusCode: 409 });
  }

  await addMember(inv.teamId, userId, inv.role);

  return prisma.invitation.update({
    where: { id: inv.id },
    data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
    include: { team: { select: { id: true, name: true } } },
  });
}

export async function declineInvitation(token: string, userId: string) {
  const inv = await prisma.invitation.findUnique({ where: { token } });
  if (!inv) throw Object.assign(new Error('Invitation not found'), { statusCode: 404 });
  if (inv.status !== InvitationStatus.PENDING) {
    throw Object.assign(new Error(`Invitation is already ${inv.status.toLowerCase()}`), { statusCode: 409 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw Object.assign(new Error('This invitation was sent to a different email address'), { statusCode: 403 });
  }

  return prisma.invitation.update({
    where: { id: inv.id },
    data: { status: InvitationStatus.DECLINED },
    include: { team: { select: { id: true, name: true } } },
  });
}

export async function expireStaleInvitations() {
  return prisma.invitation.updateMany({
    where: { status: InvitationStatus.PENDING, expiresAt: { lt: new Date() } },
    data: { status: InvitationStatus.EXPIRED },
  });
}

/**
 * Invitee emails + inviting-staff identities — team-private. The route guard
 * (requireTeamAccess('invitation')) is the primary gate; this second check is
 * defence in depth so a future caller that skips the middleware can't leak the
 * list.
 */
export async function getTeamInvitations(teamId: string, userId: string) {
  if (!(await canActInCategory(userId, teamId, 'invitation'))) {
    throw new AppError(403, 'You do not have permission to view this team’s invitations.');
  }
  await expireStaleInvitations();
  return prisma.invitation.findMany({
    where: { teamId },
    orderBy: { createdAt: 'desc' },
    include: { invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
}

export async function getUserInvitations(email: string) {
  await expireStaleInvitations();
  return prisma.invitation.findMany({
    where: { email, status: InvitationStatus.PENDING },
    orderBy: { createdAt: 'desc' },
    include: {
      team: { select: { id: true, name: true, division: true, season: true } },
      invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });
}
