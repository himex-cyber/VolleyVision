// What the app keeps on the device so a tracker can reopen offline (6.6a): the
// signed-in user's name and role, and the last copy of each match opened on
// the tracker (its roster included, so taps can still name a player). Players
// can be minors, so all of it is cleared on sign-out.
import type { Match, User } from '../types';
import { storageGet, storageKeys, storageRemove, storageSet } from './safeStorage';

const USER_KEY = 'vv_user';
const MATCH_PREFIX = 'vv_match:';
// ponytail: the few most recent matches opened on the tracker; a device that
// tracks more at once can raise it.
const MAX_CACHED_MATCHES = 5;

type CachedUser = Pick<User, 'id' | 'firstName' | 'lastName' | 'role'>;

export function cacheUser(u: User): void {
  const { id, firstName, lastName, role } = u;
  storageSet(USER_KEY, JSON.stringify({ id, firstName, lastName, role } satisfies CachedUser));
}

/** A stand-in User while /auth/me can't be reached. No email is kept. */
export function cachedUser(): User | null {
  try {
    const raw = storageGet(USER_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CachedUser;
    // emailVerified true: an offline tracker shouldn't see the verify banner.
    return c?.id ? { ...c, email: '', profileImage: null, emailVerified: true } : null;
  } catch {
    return null;
  }
}

export function cacheMatch(match: Match): void {
  const others = storageKeys(MATCH_PREFIX).filter((k) => k !== `${MATCH_PREFIX}${match.id}`);
  for (const k of others.slice(0, Math.max(0, others.length - (MAX_CACHED_MATCHES - 1)))) storageRemove(k);
  storageSet(`${MATCH_PREFIX}${match.id}`, JSON.stringify(match));
}

/** The server says this caller can't see the match (removed from the team, deleted). */
export function forgetMatch(id: string): void {
  storageRemove(`${MATCH_PREFIX}${id}`);
}

/** The cached user's id, to compare with who is signing in. */
export function cachedUserId(): string | null {
  return cachedUser()?.id ?? null;
}

export function cachedMatch(id: string): Match | undefined {
  try {
    const raw = storageGet(`${MATCH_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as Match) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sign-out, a 401, or a different account signing in: the cached user and
 * every cached match go. Queued taps and this device's own event keys stay
 * (per user, random ids, no names): the taps send once that user is back, and
 * their keys must still read as this device's (6.11).
 */
export function clearOfflineCache(): void {
  storageRemove(USER_KEY);
  for (const k of storageKeys(MATCH_PREFIX)) storageRemove(k);
}
