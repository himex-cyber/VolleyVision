import { prisma } from '../lib/prisma';

/**
 * Player roster primitives — the lowest layer of the "apply the change" family.
 *
 * These live below the orchestration in teamActions.service rather than inside
 * it. The distinction matters structurally: teamActions COMPOSES actions across
 * invitations, players and memberships, so anything it imports sits above it,
 * and anything that imports it sits below. teamMembership.service needs to
 * create a player row when a member is promoted — a primitive, not an
 * orchestration — and reaching up into teamActions for it inverted the layering
 * and closed a three-module import cycle:
 *
 *   invitation → teamMembership → teamActions → invitation
 *
 * Moving the primitive down breaks that cycle at its actual cause. Do not
 * re-export these from teamActions as a shim; that would restore the edge.
 *
 * This module must depend only on lib/prisma and types — never on
 * teamActions, invitation, or teamMembership. backend/scripts/check-import-cycles.js
 * enforces that.
 *
 * Both callers use these so the create/update/delete logic is never duplicated:
 *   - the immediate path (head coach / owner) calls them directly
 *   - the approval path calls them when a head coach approves a queued request
 *
 * Payload shapes match what the controllers put into ApprovalRequest.payload.
 */

export interface PlayerCreatePayload {
  firstName: string;
  lastName: string;
  jerseyNumber: number;
  position: string;
  teamId: string;
  // Set when the roster row is created for an existing user account (e.g. a
  // member promoted to PLAYER) — links the row to that user.
  userId?: string;
}
export interface PlayerUpdatePayload {
  firstName?: string;
  lastName?: string;
  jerseyNumber?: number;
  position?: string;
}

export function applyCreatePlayer(p: PlayerCreatePayload) {
  return prisma.player.create({
    data: {
      firstName: p.firstName,
      lastName: p.lastName,
      jerseyNumber: Number(p.jerseyNumber),
      position: p.position as any,
      teamId: p.teamId,
      userId: p.userId ?? null,
    },
  });
}

export function applyUpdatePlayer(playerId: string, p: PlayerUpdatePayload) {
  return prisma.player.update({
    where: { id: playerId },
    data: {
      firstName: p.firstName,
      lastName: p.lastName,
      jerseyNumber: p.jerseyNumber != null ? Number(p.jerseyNumber) : undefined,
      position: p.position as any,
    },
  });
}

export function applyDeletePlayer(playerId: string) {
  return prisma.player.delete({ where: { id: playerId } });
}
