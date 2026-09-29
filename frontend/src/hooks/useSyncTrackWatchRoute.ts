import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { MatchStatus } from '../types';

/**
 * Keeps you on the right route while a match is live. Track (input controls)
 * and Watch (read-only) are separate routes for the same match, so flipping
 * the Coach/Player toggle alone doesn't move you between them — without this,
 * you'd have to manually navigate away and back to see the correct page.
 * Mirrors the same canTrack + status === 'IN_PROGRESS' condition MatchPageHeader
 * already uses to decide which tab to show.
 */
export function useSyncTrackWatchRoute(
  matchId: string | undefined,
  status: MatchStatus | undefined,
  canTrack: boolean,
  // False while the caller's role is unknown (loading, or offline on a cold
  // start): don't bounce a tracker to Watch before the answer arrives (6.6a).
  roleKnown = true,
) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!matchId || status !== 'IN_PROGRESS' || !roleKnown) return;
    const onTrackRoute = location.pathname.endsWith('/track');
    const onWatchRoute = location.pathname.endsWith('/watch');
    if (canTrack && onWatchRoute) {
      navigate(`/matches/${matchId}/track`, { replace: true });
    } else if (!canTrack && onTrackRoute) {
      navigate(`/matches/${matchId}/watch`, { replace: true });
    }
  }, [matchId, status, canTrack, roleKnown, location.pathname, navigate]);
}
