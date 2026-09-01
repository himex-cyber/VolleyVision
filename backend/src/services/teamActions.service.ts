import { TeamRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { createInvitation } from './invitation.service';

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
      matchDate: new Date(p.matchDate),
      opponent: p.opponent,
      competition: p.competition ?? null,
      venue: p.venue ?? null,
      status: 'SCHEDULED',
    },
  });
}

export function applyUpdateMatch(matchId: string, p: MatchUpdatePayload) {
  return prisma.match.update({
    where: { id: matchId },
    data: {
      matchDate: p.matchDate ? new Date(p.matchDate) : undefined,
      opponent: p.opponent,
      competition: p.competition,
      venue: p.venue,
      status: p.status as any,
      setScores: p.setScores as any,
    },
  });
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

export function applyCreateInvitation(p: InvitationCreatePayload) {
  // createInvitation also triggers the invitation email (Fix 1).
  return createInvitation(p.teamId, p.invitedById, p.email, p.role);
}
