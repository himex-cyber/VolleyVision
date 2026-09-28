import { TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { generateUniqueCode, normalizeCode } from '../lib/joinCode';
import { addMember, isMember } from './teamMembership.service';
import { assertEmailVerified } from './emailVerification.service';

export type TeamJoinCodeKind = 'PLAYER' | 'STAFF';

// Roles a staff code may grant. HEAD_COACH is deliberately excluded — head
// coaches come from ownership or an explicit per-email invitation. So is
// MANAGER: it carries head-coach authority (approvals, member management,
// team delete), so it comes only from an email invite, which goes through
// canInviteRole and the approval queue — never from a code anyone can forward.
const STAFF_ROLES: TeamRole[] = [TeamRole.ASSISTANT_COACH, TeamRole.STATISTICIAN];

/** Generate a code unique within the given team-code column. */
export function generateTeamJoinCode(kind: TeamJoinCodeKind): Promise<string> {
  return generateUniqueCode(async (code) => {
    const clash = await prisma.team.findUnique({
      where: kind === 'PLAYER' ? { playerJoinCode: code } : { staffJoinCode: code },
      select: { id: true },
    });
    return clash !== null;
  });
}

/**
 * The team's codes. The staff code is left out unless `includeStaff` — callers
 * pass it only for members with FULL_ACCESS on invitations (see the controller).
 */
export async function getTeamJoinCodes(teamId: string, includeStaff: boolean) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: includeStaff ? { playerJoinCode: true, staffJoinCode: true } : { playerJoinCode: true },
  });
  if (!team) throw Object.assign(new Error('Team not found'), { statusCode: 404 });
  return team;
}

/** Overwrites the old code — it stops working the moment this returns. */
export async function regenerateTeamJoinCode(teamId: string, kind: TeamJoinCodeKind) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) throw Object.assign(new Error('Team not found'), { statusCode: 404 });

  const code = await generateTeamJoinCode(kind);
  await prisma.team.update({
    where: { id: teamId },
    data: kind === 'PLAYER' ? { playerJoinCode: code } : { staffJoinCode: code },
  });
  return code;
}

/**
 * Redeem a reusable team code. Unlike the per-email invitation flow there is no
 * email check and no approval step — whoever holds the code joins immediately.
 * A player code always joins as PLAYER; a staff code requires the caller to
 * pick one of the staff roles.
 */
export async function redeemTeamJoinCode(code: string, userId: string, role?: TeamRole) {
  await assertEmailVerified(userId);
  const normalized = normalizeCode(code);

  const playerTeam = await prisma.team.findUnique({
    where: { playerJoinCode: normalized },
    select: { id: true, name: true },
  });
  if (playerTeam) {
    if (await isMember(playerTeam.id, userId)) {
      throw Object.assign(new Error('You are already a member of this team'), { statusCode: 409 });
    }
    await addMember(playerTeam.id, userId, TeamRole.PLAYER);
    return { team: playerTeam, kind: 'PLAYER' as const, role: TeamRole.PLAYER };
  }

  const staffTeam = await prisma.team.findUnique({
    where: { staffJoinCode: normalized },
    select: { id: true, name: true },
  });
  if (staffTeam) {
    if (!role || !STAFF_ROLES.includes(role)) {
      throw Object.assign(
        new Error('Pick a staff role: Assistant Coach or Statistician. Managers join by email invitation.'),
        { statusCode: 400 },
      );
    }
    if (await isMember(staffTeam.id, userId)) {
      throw Object.assign(new Error('You are already a member of this team'), { statusCode: 409 });
    }
    await addMember(staffTeam.id, userId, role);
    return { team: staffTeam, kind: 'STAFF' as const, role };
  }

  throw Object.assign(new Error('Invalid or unknown join code'), { statusCode: 404 });
}

export type CodeLookupResult =
  | { kind: 'EMAIL_INVITE' | 'TEAM_PLAYER' | 'TEAM_STAFF'; teamName: string }
  | { kind: null };

/**
 * Read-only classification of a code so the UI can show the right confirm step
 * (e.g. a role picker for staff codes) without redeeming twice.
 */
export async function lookupCode(code: string): Promise<CodeLookupResult> {
  const normalized = normalizeCode(code);

  const invitation = await prisma.invitation.findUnique({
    where: { joinCode: normalized },
    select: { team: { select: { name: true } } },
  });
  if (invitation) return { kind: 'EMAIL_INVITE', teamName: invitation.team.name };

  const playerTeam = await prisma.team.findUnique({
    where: { playerJoinCode: normalized },
    select: { name: true },
  });
  if (playerTeam) return { kind: 'TEAM_PLAYER', teamName: playerTeam.name };

  const staffTeam = await prisma.team.findUnique({
    where: { staffJoinCode: normalized },
    select: { name: true },
  });
  if (staffTeam) return { kind: 'TEAM_STAFF', teamName: staffTeam.name };

  return { kind: null };
}
