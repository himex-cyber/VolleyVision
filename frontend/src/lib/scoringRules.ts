// Copy of backend/src/lib/scoringRules.ts, tested there (scoreReplay.test.ts
// fails if this drifts from the marker line down). The tracker's provisional
// score (6.8) must score a tap exactly as the server will.

export const HOME_POINT_EVENTS: readonly string[] = [
  'KILL',
  'ACE',
  'SOLO_BLOCK',
  'BLOCK_ASSIST',
] as const;

export const AWAY_POINT_EVENTS: readonly string[] = [
  'ATTACK_ERROR',
  'SERVICE_ERROR',
  'DIG_ERROR',
  'SETTING_ERROR',
  'BLOCK_ERROR',
] as const;

export const HOME_POINT_SET = new Set(HOME_POINT_EVENTS);
export const AWAY_POINT_SET = new Set(AWAY_POINT_EVENTS);

/**
 * Returns which team scores a point for this event type, or null if non-scoring.
 *
 * `isOpponentEvent` inverts the outcome: an opponent's kill/ace/block scores for
 * the AWAY side (them), and an opponent's error scores for the HOME side (us).
 * Omitting the parameter preserves the original own-player behavior.
 */
export function scoringTeam(eventType: string, isOpponentEvent = false): 'home' | 'away' | null {
  let team: 'home' | 'away' | null = null;
  if (HOME_POINT_SET.has(eventType)) team = 'home';
  else if (AWAY_POINT_SET.has(eventType)) team = 'away';
  if (team === null) return null;
  if (!isOpponentEvent) return team;
  return team === 'home' ? 'away' : 'home';
}
