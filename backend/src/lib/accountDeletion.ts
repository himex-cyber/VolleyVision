// Account deletion rules (9.4), pure so they're tested without a database.
// The deletion itself is services/accountDeletion.service.ts.

/**
 * Stands in for a deleted account's id on its audit rows (Karlos, 1 Oct):
 * the rows stay as team history, anonymised. audit_logs.user_id is NOT NULL,
 * and GET /audit filters by the caller's id, so this never matches a person.
 */
export const DELETED_USER_ID = 'deleted-user';

type TeamRef = { id: string; name: string };
export type DeletionBlocker = TeamRef & { reason: 'owner' | 'head_coach' };

/**
 * Teams that stop a deletion: every team they own (teams.owner_id is
 * RESTRICT, and a team always has an owner), and, as a guard for legacy data,
 * any team where they're head coach without owning it (a cascade would leave
 * that team with none).
 */
export function deletionBlockers(owned: TeamRef[], headCoachOf: TeamRef[]): DeletionBlocker[] {
  const ownedIds = new Set(owned.map((t) => t.id));
  return [
    ...owned.map((t) => ({ ...t, reason: 'owner' as const })),
    ...headCoachOf.filter((t) => !ownedIds.has(t.id)).map((t) => ({ ...t, reason: 'head_coach' as const })),
  ];
}

export function blockersMessage(blockers: DeletionBlocker[]): string {
  const names = (reason: DeletionBlocker['reason']) => blockers.filter((b) => b.reason === reason).map((b) => b.name).join(', ');
  const parts: string[] = [];
  if (names('owner')) parts.push(`Transfer or delete these teams first: ${names('owner')}.`);
  if (names('head_coach')) parts.push(`You're the head coach of ${names('head_coach')}. Ask its owner to change your role, or contact support.`);
  return parts.join(' ');
}
