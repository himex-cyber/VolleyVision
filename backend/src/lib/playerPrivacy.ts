// Per-player data rule (Karlos, 28 Sept): a player's individual numbers go only
// to that team's staff (TRACK_MATCH), a global admin, and the player themself.
// Everyone else gets team totals plus their own row. Privacy by omission: the
// rows are left out server-side, not hidden in the UI. Jersey numbers aren't
// anonymous (every member can read the roster), so "hiding" a player means
// removing them entirely. Players can be minors.
//
// Callers pass `isStaff` already resolved (TRACK_MATCH on the team, or admin),
// so this stays pure and testable without Prisma.

type WithUser = { userId: string | null };

const isCaller = (userId: string | null | undefined, callerId: string | null) =>
  callerId != null && userId === callerId;

/** Players whose individual stats this caller may see, with userId stripped. */
export function visiblePlayers<T extends WithUser>(players: T[], isStaff: boolean, callerId: string | null): Omit<T, 'userId'>[] {
  return players
    .filter((p) => isStaff || isCaller(p.userId, callerId))
    .map(({ userId: _userId, ...rest }) => rest);
}

/**
 * Roster rows for this caller (8.0.4): every row stays (the roster is visible
 * to every member), but userId, an internal account id, is only on the
 * caller's own row unless they're staff. Null rather than removed: installed
 * apps read the field.
 */
export function maskOtherUserIds<T extends WithUser>(players: T[], isStaff: boolean, callerId: string | null): T[] {
  return isStaff ? players : players.map((p) => (isCaller(p.userId, callerId) ? p : { ...p, userId: null }));
}

type MemberRow = { user: { id: string | null; email?: unknown; role?: unknown } };

/**
 * Members list rows for this caller (8.5.0.1). Only members who can manage
 * the roster get emails, account ids and the global role (who is an ADMIN).
 * Everyone else keeps their own id, which the "(you)" label reads; other ids
 * are null rather than removed, as in maskOtherUserIds.
 */
export function maskMembers<T extends MemberRow>(members: T[], canManage: boolean, callerId: string | null): T[] {
  if (canManage) return members;
  return members.map((m) => {
    const { email: _email, role: _role, ...user } = m.user;
    return { ...m, user: { ...user, id: isCaller(user.id, callerId) ? user.id : null } };
  });
}

type EventWithPlayer = {
  playerId: string | null;
  notes: string | null;
  isOpponentEvent: boolean;
  player: (WithUser & Record<string, unknown>) | null;
  clientKey?: string | null;
};

/**
 * The match event log for this caller. Staff see it whole. For anyone else an
 * own-team event by someone other than the caller keeps its type, set, zone,
 * rotation and time but loses who did it and the coach's note; the caller's own
 * events and opponent events are unchanged. player.userId is always stripped,
 * and so is the offline queue's clientKey for non-staff (it identifies the
 * tracking device's taps; only staff track).
 */
export function redactEvents<T extends EventWithPlayer>(events: T[], isStaff: boolean, callerId: string | null) {
  return events.map((raw) => {
    const e = !isStaff && 'clientKey' in raw ? { ...raw, clientKey: null } : raw;
    const player = e.player ? (({ userId: _userId, ...rest }) => rest)(e.player) : null;
    if (isStaff || e.isOpponentEvent || isCaller(e.player?.userId, callerId)) return { ...e, player };
    return { ...e, playerId: null, player: null, notes: null };
  });
}
