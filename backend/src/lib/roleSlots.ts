// Team role limits (Karlos, 2026-09-27): exactly one HEAD_COACH per team and at
// most two ASSISTANT_COACH. Pure so it can be tested without a database; the
// services that write TeamMembership.role call it inside a transaction.

export const MAX_ASSISTANT_COACHES = 2;

/**
 * Why `role` cannot be given to a member, or null if it can.
 * `assistantsExcludingMember` counts the team's ASSISTANT_COACH memberships
 * other than the one being changed, so re-saving an existing assistant never
 * counts against itself.
 */
export function roleSlotError(role: string, assistantsExcludingMember: number): string | null {
  // The head coach is the owner. Changing who that is has to move ownership
  // too, so it only happens through ownership transfer, never a role edit.
  if (role === 'HEAD_COACH') return 'The head coach is the team owner. Transfer ownership to change them.';
  if (role === 'ASSISTANT_COACH' && assistantsExcludingMember >= MAX_ASSISTANT_COACHES) {
    return `A team can have at most ${MAX_ASSISTANT_COACHES} assistant coaches.`;
  }
  return null;
}
