/**
 * Does an incoming event belong before something already recorded on the match?
 * If so its point can't simply be added to the running score: the set
 * boundaries after it may move, so the match is replayed instead (6.3).
 *
 * The tie rules mirror buildTimeline (lib/scoreReplay.ts): at the same
 * timestamp events sort before adjustments, and the sort is stable, so a new
 * event tying the latest event lands after it (in order), but one tying the
 * latest adjustment lands before it (out of order).
 */
export function isOutOfOrder(incoming: Date, latestEventAt: Date | null, latestAdjustmentAt: Date | null): boolean {
  const t = incoming.getTime();
  return (latestEventAt != null && t < latestEventAt.getTime())
    || (latestAdjustmentAt != null && t <= latestAdjustmentAt.getTime());
}
