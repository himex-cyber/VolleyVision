/**
 * Which portal a user lands in — coach or player.
 *
 * The rule is consumed by the SPA (frontend/src/context/ViewModeContext.tsx),
 * not by any backend route. It lives here because this is the only place the
 * repo can execute a test: there is no frontend test runner, and backend's
 * tsconfig `rootDir: ./src` rejects importing across the package boundary
 * (TS6059). ViewModeContext carries a short mirror of the same rule.
 *
 * ponytail: rule duplicated across the two packages, kept honest by this file
 * being the tested copy. Collapse to one import the day a shared package or a
 * frontend test runner exists.
 */

export type ViewMode = 'coach' | 'player';

export interface ViewModeInput {
  /** Owns or staffs at least one team. */
  canCoach: boolean;
  /** Has a PLAYER membership or a linked player record. */
  canPlay: boolean;
  /** The user's own previous toggle, from localStorage. */
  stored: ViewMode | null;
  /** 'COACH' | 'PLAYER' | 'UNSURE' — what they said at registration. */
  signupIntent: string | null | undefined;
}

/**
 * Capability outranks stated intent, always: signupIntent is an onboarding hint
 * a user typed once and can never update, while capability is derived from real
 * memberships. Someone who answered "PLAYER" and then went and head-coached a
 * team gets the coach view — the intent must not strand them out of the portal
 * they actually work in.
 *
 * Intent only breaks a genuine tie: both capabilities (a playing coach), or
 * none yet (a brand-new account, or capability queries still in flight). Even
 * then an explicit toggle wins over it, because a choice the user made in the
 * app is fresher than one they made at signup.
 *
 * Coach is the fallback for COACH / UNSURE / missing intent — it was the
 * previous unconditional default, so nothing regresses for existing users.
 */
export function resolveViewMode({ canCoach, canPlay, stored, signupIntent }: ViewModeInput): ViewMode {
  if (canCoach && !canPlay) return 'coach';
  if (canPlay && !canCoach) return 'player';
  if (stored) return stored;
  return signupIntent === 'PLAYER' ? 'player' : 'coach';
}
