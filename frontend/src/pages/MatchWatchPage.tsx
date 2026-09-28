import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useMatch, useEvents, useHasPermission } from '../hooks';
import { useSyncTrackWatchRoute } from '../hooks/useSyncTrackWatchRoute';
import { EVENT_META, type Event } from '../types';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import LiveScoreboard from '../components/scoreboard/LiveScoreboard';

// Read-only spectator view for players/viewers watching a live match — the
// counterpart to TrackingPage, but with every LiveScoreboard handler omitted
// so nothing here is clickable or editable. Score/status poll every 5s via
// useMatch's `live` flag; the event feed reuses useEvents' existing 5s poll.

const META = new Map(EVENT_META.map((m) => [m.type, m]));

const OUTCOME_DOT: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'bg-success',
  negative: 'bg-error',
  neutral: 'bg-grey-400',
};

function actorLabel(e: Event, teamName?: string): string {
  if (e.player) return `${e.player.firstName} ${e.player.lastName}`;
  if (e.isOpponentEvent) return e.opponentJerseyNumber != null ? `Opponent #${e.opponentJerseyNumber}` : 'Opponent';
  // Own-team event with the player redacted for a non-staff viewer (per-player
  // privacy rule) — attribute it to the team instead of showing a blank dash.
  return teamName ?? '—';
}

export default function MatchWatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { data: match, isLoading } = useMatch(matchId!, { live: true });
  const { data: events } = useEvents(matchId!);
  // Only used to bounce back to Track if the Coach/Player toggle flips —
  // this page itself is read-only regardless (see canTrack={false} below).
  const canTrack = useHasPermission(match?.teamId ?? '', 'TRACK_MATCH');
  useSyncTrackWatchRoute(matchId, match?.status, canTrack);

  const recentEvents = useMemo(
    () =>
      [...(events ?? [])]
        .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
        .slice(0, 15),
    [events],
  );

  if (isLoading) return <p className="text-grey-600">Loading…</p>;
  if (!match) return <p className="text-error">Match not found.</p>;

  const currentSet = Math.min((match.homeSetsWon ?? 0) + (match.awaySetsWon ?? 0) + 1, 5);
  const isLive = match.status === 'IN_PROGRESS';

  return (
    <div className="space-y-6">
      <MatchPageHeader
        matchId={match.id}
        teamId={match.teamId}
        teamName={match.team?.name}
        opponent={match.opponent}
        matchDate={match.matchDate}
        competition={match.competition}
        venue={match.venue}
        status={match.status}
        canTrack={false}
      />

      {!isLive ? (
        <div className="card p-12 text-center space-y-3">
          <p className="text-grey-600">This match isn't live right now.</p>
          <div className="flex items-center justify-center gap-4 text-sm">
            <Link to={`/matches/${match.id}/dashboard`} className="text-navy-700 hover:underline">Stats</Link>
            <Link to={`/matches/${match.id}/events`} className="text-navy-700 hover:underline">Events</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs font-semibold text-navy-900">
            <span className="w-2 h-2 rounded-full bg-gold-500 animate-pulse" aria-hidden />
            Live — updating every few seconds
          </div>

          <LiveScoreboard
            homeName={match.team?.name ?? 'Home'}
            awayName={match.opponent}
            homeScore={match.homeScore ?? 0}
            awayScore={match.awayScore ?? 0}
            homeSetsWon={match.homeSetsWon ?? 0}
            awaySetsWon={match.awaySetsWon ?? 0}
            status={match.status}
            currentSet={currentSet}
          />

          <div className="card overflow-hidden">
            <div className="px-5 py-2.5 border-b border-grey-200 bg-grey-50">
              <h2 className="font-display font-semibold text-grey-900">Recent Events</h2>
            </div>
            {recentEvents.length === 0 ? (
              <p className="p-8 text-center text-grey-600 text-sm">No events recorded yet.</p>
            ) : (
              <ul className="divide-y divide-grey-200">
                {recentEvents.map((e) => {
                  const meta = META.get(e.eventType);
                  const outcome = meta?.outcome ?? 'neutral';
                  return (
                    <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          e.player ? 'bg-navy-100 text-navy-700' : 'bg-grey-200 text-grey-500'
                        }`}
                      >
                        <span className="tabular-nums font-bold text-sm">
                          {e.player?.jerseyNumber ?? e.opponentJerseyNumber ?? '—'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-grey-900 truncate">{actorLabel(e, match.team?.name)}</p>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${OUTCOME_DOT[outcome]}`} aria-hidden />
                          <span className="text-sm text-grey-600">{meta?.label ?? e.eventType}</span>
                        </div>
                      </div>
                      <span className="text-xs text-grey-500 tabular-nums shrink-0">
                        {format(new Date(e.recordedAt), 'HH:mm')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
