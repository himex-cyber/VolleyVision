// Shared Prisma where-fragment for event queries that feed statistics.
//
// Two exclusions, both of which must apply to every stats-feeding query:
//   1. Opponent events (isOpponentEvent=true) exist for live scoring only —
//      an opponent's kills are not our kills.
//   2. Training events (trainingSessionId != null) belong to a training
//      session, never a match. They must never surface in match/career/team
//      analytics (Iteration 3). The training API was removed in v9.4.0, but
//      the table and column stay so it can return without a migration. Match-scoped queries already exclude them via
//      their matchId filter, but player-scoped stats queries (e.g. career
//      totals) have no match filter, so this fragment is the guarantee.
//
// Spread it into every stats-feeding event query so neither can be forgotten:
//
//   prisma.event.findMany({ where: { matchId, ...ownEventsOnly }, ... })
//
// Safe to combine with an explicit `matchId` filter — it sets neither matchId
// nor any key those queries set.
export const ownEventsOnly = { isOpponentEvent: false, trainingSessionId: null } as const;
