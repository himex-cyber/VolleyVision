import { Prisma, TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createInvitation } from './invitation.service';
import { canInviteRole } from '../lib/rolePermissions';
import { getUserTeamRole } from './permission.service';
import { AppError } from '../middleware/errorHandler';
import { withMatchLock } from './eventRecording.service';
import { parseMatchDate } from '../lib/matchDate';

/**
 * Stabilization Pass 2 — single "apply the change" function per structural
 * action. Both callers use these so the actual create/update/delete logic is
 * never duplicated:
 *   - the immediate path (head coach / owner) calls them directly
 *   - the approval path calls them when a head coach approves a queued request
 *
 * Payload shapes match what the controllers put into ApprovalRequest.payload.
 */

// ── Players ──────────────────────────────────────────────────────────────────
// Moved to playerActions.service.ts. They are primitives, not orchestration, and
// teamMembership.service needs them — importing them from here made a service
// below this one depend on this one, closing an import cycle. Deliberately NOT
// re-exported: a shim here would keep the edge that the move removed.

// ── Matches ──────────────────────────────────────────────────────────────────

export interface MatchCreatePayload {
  teamId: string;
  matchDate: string | Date;
  opponent: string;
  competition?: string | null;
  venue?: string | null;
}
export interface MatchUpdatePayload {
  matchDate?: string | Date;
  opponent?: string;
  competition?: string | null;
  venue?: string | null;
  status?: string;
  setScores?: unknown;
}

export function applyCreateMatch(p: MatchCreatePayload) {
  return prisma.match.create({
    data: {
      teamId: p.teamId,
      // Wall-clock fixture time, stored as written (8.0.7). Checked by the
      // controller; a request queued before that check parses the same way.
      matchDate: parseMatchDate(p.matchDate) ?? new Date(p.matchDate),
      opponent: p.opponent,
      competition: p.competition ?? null,
      venue: p.venue ?? null,
      status: 'SCHEDULED',
    },
  });
}

export function applyUpdateMatch(matchId: string, p: MatchUpdatePayload) {
  const write = (db: Prisma.TransactionClient) => db.match.update({
    where: { id: matchId },
    data: {
      matchDate: p.matchDate ? parseMatchDate(p.matchDate) ?? new Date(p.matchDate) : undefined,
      opponent: p.opponent,
      competition: p.competition,
      venue: p.venue,
      status: p.status as any,
      setScores: p.setScores as any,
    },
  });
  // status and setScores are also written by the replay a tap can trigger;
  // without the lock one of the two writes silently wins.
  return p.status !== undefined || p.setScores !== undefined ? withMatchLock(matchId, write) : write(prisma);
}

export function applyDeleteMatch(matchId: string) {
  return prisma.match.delete({ where: { id: matchId } });
}

// ── Invitations ──────────────────────────────────────────────────────────────

export interface InvitationCreatePayload {
  teamId: string;
  invitedById: string;
  email: string;
  role: TeamRole;
}

export async function applyCreateInvitation(p: InvitationCreatePayload) {
  // For an APPROVAL_REQUIRED inviter, this runs later
  // (when a head coach/manager approves the queued ApprovalRequest) using the
  // payload captured back when the request was made. The inviter's authority
  // can have changed since then (demoted, access tier revoked) — re-check
  // against their CURRENT role here, in the one path both the immediate and
  // queued flows funnel through, rather than trusting the stale payload.
  const { role: currentRole } = await getUserTeamRole(p.invitedById, p.teamId);
  if (!currentRole || !canInviteRole(currentRole, p.role)) {
    throw new AppError(403, 'You can no longer invite a member at that role.');
  }
  // createInvitation also triggers the invitation email (Fix 1).
  return createInvitation(p.teamId, p.invitedById, p.email, p.role);
}
