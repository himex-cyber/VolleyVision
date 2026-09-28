import { useEffect } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import axios from 'axios';
import { usePlayerAnalytics, useMatchAnalytics, useTeam, useHasPermission, usePlayerZones } from '../hooks';
import { StatsCards } from '../components/analytics/StatsOverview';
import { POSITION_FULL_LABELS } from '../types';
import PlayerRadarChart from '../components/charts/PlayerRadarChart';
import CourtHeatMap from '../components/analytics/CourtHeatMap';
import type { StatLine } from '../types';
import { ArrowLeftIcon } from '../components/ui/icons';

export default function PlayerDashboardPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const [searchParams] = useSearchParams();
  // Present only when arriving from a match's Player Statistics table — keeps
  // the coach inside that match's context (back button + player tab bar)
  // instead of the generic career-wide profile view.
  const matchId = searchParams.get('matchId') ?? undefined;
  // The team these stats are scoped to — defaults server-side to the player's
  // home team when absent (e.g. a bookmarked link from before this param existed).
  const teamId = searchParams.get('teamId') ?? undefined;
  const { data, isLoading, isError, error } = usePlayerAnalytics(playerId!, teamId);
  const { data: matchData } = useMatchAnalytics(matchId ?? '');
  // Waits for the stats: a caller refused those (403) is refused the map too.
  const zones = usePlayerZones(data ? playerId! : '', teamId, matchId);
  // Roster context (no matchId) gets a full-team tab bar. Guarded by the hook's
  // own `enabled: !!id`, so this stays above the early returns below.
  const { data: team } = useTeam(data?.teamId ?? '');
  // The tab bars link to other players' dashboards, which only staff may open
  // (a player viewing their own page would get a 403 on every other tab).
  const canTrack = useHasPermission(data?.teamId ?? '', 'TRACK_MATCH');

  // Only when arriving in match context — restores the previous title on unmount.
  useEffect(() => {
    if (!matchId || !matchData) return;
    const previous = document.title;
    document.title = `Game Day Stats – vs ${matchData.match.opponent} | VolleyVision`;
    return () => { document.title = previous; };
  }, [matchId, matchData]);

  if (isLoading) return <p className="text-navy-300">Loading analytics…</p>;
  if (axios.isAxiosError(error) && error.response?.status === 403) {
    return (
      <p className="text-error">
        Individual stats are visible to this team's coaching staff and to the player.
        Ask one of the team's coaches if you need them.
      </p>
    );
  }
  if (isError || !data) return <p className="text-error">Couldn't load player analytics.</p>;

  return (
    <div className="space-y-6">
      <div>
        {matchId ? (
          <Link
            to={`/matches/${matchId}/dashboard`}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Match Stats
          </Link>
        ) : (
          <Link
            to={`/teams/${data.teamId}`}
            className="btn-secondary inline-flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            Back to Roster
          </Link>
        )}

        {matchId && matchData && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-grey-500">Game Day Stats</p>
            <p className="text-sm text-grey-600 mt-0.5">
              vs {matchData.match.opponent} · {format(new Date(matchData.match.matchDate), 'PPP')}
              {matchData.match.venue && ` · ${matchData.match.venue}`}
              {matchData.match.competition && ` · ${matchData.match.competition}`}
            </p>
          </div>
        )}

        <h1 className="text-2xl font-bold text-grey-900 mt-2">
          #{data.player.jerseyNumber} {data.player.firstName} {data.player.lastName}
        </h1>
        <p className="text-sm text-navy-300 mt-1">
          {POSITION_FULL_LABELS[data.player.position]}
        </p>
      </div>

      {/* Player tab bar — only in match context, listing every player with
          stats in that match (not the full roster), so the coach can compare
          players while staying inside the same match. */}
      {canTrack && matchId && matchData && matchData.playerStats.length > 0 && (
        <div className="flex items-center gap-1 border-b border-grey-200 pb-px overflow-x-auto">
          {matchData.playerStats.map((row) => (
            <NavLink
              key={row.player.id}
              to={`/players/${row.player.id}/dashboard?matchId=${matchId}&teamId=${data.teamId}`}
              className={({ isActive }) =>
                `px-3.5 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-gold-500 text-navy-700 font-semibold'
                    : 'border-transparent text-grey-600 hover:text-navy-700'
                }`}
            >
              #{row.player.jerseyNumber} {row.player.lastName}
            </NavLink>
          ))}
        </div>
      )}

      {/* Roster context — the whole team, so a coach arriving from the Roster
          can move between players without going back. Mutually exclusive with
          the match-scoped bar above. */}
      {canTrack && !matchId && team?.players && team.players.length > 0 && (
        <div className="flex items-center gap-1 border-b border-grey-200 pb-px overflow-x-auto">
          {[...team.players]
            .sort((a, b) => a.jerseyNumber - b.jerseyNumber)
            .map((p) => (
              <NavLink
                key={p.id}
                to={`/players/${p.id}/dashboard?teamId=${data.teamId}`}
                className={({ isActive }) =>
                  `px-3.5 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-gold-500 text-navy-700 font-semibold'
                      : 'border-transparent text-grey-600 hover:text-navy-700'
                  }`}
              >
                #{p.jerseyNumber} {p.lastName}
              </NavLink>
            ))}
        </div>
      )}

      <StatsCards stats={data.stats} />
      <PlayerRadarChart stats={data.stats} />

      <section id="zones">
        {zones.isLoading ? (
          <p className="text-sm text-grey-600">Loading court zones…</p>
        ) : zones.isError || !zones.data ? (
          <p className="text-sm text-error">Couldn't load court zones. Try refreshing the page.</p>
        ) : (
          <CourtHeatMap data={zones.data} title="Court zones" />
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-grey-900 mb-3">Set Breakdown</h2>
        {data.setStats.length === 0 ? (
          <div className="card p-6 text-navy-300 text-sm text-center">
            Record events to generate set statistics.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.setStats.map((set: StatLine & { setNumber: number }) => (
              <div key={set.setNumber} className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-grey-900">Set {set.setNumber}</h3>
                  <span className="tabular-nums text-xs text-navy-300">{set.totalEvents} events</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-navy-300">Kills</span><span className="tabular-nums ml-2 text-grey-900">{set.kills}</span></div>
                  <div><span className="text-navy-300">Aces</span><span className="tabular-nums ml-2 text-grey-900">{set.aces}</span></div>
                  <div><span className="text-navy-300">Blocks</span><span className="tabular-nums ml-2 text-grey-900">{set.totalBlocks}</span></div>
                  <div><span className="text-navy-300">Digs</span><span className="tabular-nums ml-2 text-grey-900">{set.digs}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
