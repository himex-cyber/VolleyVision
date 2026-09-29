/**
 * Copy of backend/src/lib/matchCacheShape.ts (tested there; matchCacheShape.test.ts
 * fails if this drifts from the MATCH_KEYS line down). Used by offlineCache.
 */

const MATCH_KEYS = [
  'id', 'teamId', 'status', 'matchDate', 'opponent', 'competition', 'venue',
  'homeScore', 'awayScore', 'homeSetsWon', 'awaySetsWon', 'setScores', '_count',
] as const;
const PLAYER_KEYS = ['id', 'firstName', 'lastName', 'jerseyNumber', 'position', 'teamId'] as const;

type Row = Record<string, unknown>;

const pick = (row: Row, keys: readonly string[]): Row =>
  Object.fromEntries(keys.filter((k) => k in row).map((k) => [k, row[k]]));

/**
 * A match as the tracker keeps it on the device (8.0.4): what the tracker and
 * its header read, and nothing else. The full response carries more than an
 * offline tracker needs, including other players' account ids; players can be
 * minors. Applied on write and on read, so a full copy cached by an older
 * version is trimmed too.
 */
export function trimCachedMatch(match: Row): Row {
  const team = match.team as Row | null | undefined;
  return {
    ...pick(match, MATCH_KEYS),
    ...(team ? {
      team: { ...pick(team, ['id', 'name']), players: ((team.players as Row[] | undefined) ?? []).map((p) => pick(p, PLAYER_KEYS)) },
    } : {}),
  };
}
