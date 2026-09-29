import { lazy, Suspense, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { PlayerStatsTable, StatsCards } from '../components/analytics/StatsOverview';
import StatLeaderboardChart from '../components/charts/StatLeaderboardChart';
import { useTeamAnalytics, useTeamTrends, useTeamZones, useHasPermission, useMyPlayerIds } from '../hooks';
import TeamTrendChart from '../components/charts/TeamTrendChart';
import CoachInsights from '../components/analytics/CoachInsights';
import { generateTeamInsights } from '../lib/insights';
import PlayerInsights from '../components/analytics/PlayerInsights';
import TeamSubNav from '../components/ui/TeamSubNav';
import CourtHeatMap from '../components/analytics/CourtHeatMap';
import DateRangeFilter from '../components/analytics/DateRangeFilter';
import { rangeText, useDateRangeParams } from '../lib/dateRange';

// Point-flow panels (7.9): their own chunks (recharts and all), so the
// dashboard's first paint doesn't wait for them.
const RotationAnalytics = lazy(() => import('../components/analytics/RotationAnalytics'));
const AdvancedMetricsPanel = lazy(() => import('../components/analytics/AdvancedMetricsPanel'));
const panelFallback = <div className="card p-6 h-40 animate-pulse bg-grey-50" aria-hidden="true" />;

export default function TeamDashboardPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const range = useDateRangeParams();
  const query = useTeamAnalytics(teamId!, range);
  // A new range is a new query key, so `data` goes undefined while it loads.
  // Keeping the last result stops the whole page (and the date input being
  // typed into) from unmounting on every change.
  const lastData = useRef(query.data);
  if (query.data) lastData.current = query.data;
  const data = query.data ?? lastData.current;
  const { isLoading, isError } = query;
  const trends = useTeamTrends(teamId!, range);
  const zones = useTeamZones(teamId!, range);
  // Individual player analytics are for this team's staff and the player
  // themself — gate the drill-down links the same way. Always fetched (not
  // just for non-staff): a coach who also has a linked player record on this
  // team gets their own "My stats" section below alongside the full view.
  const canTrack = useHasPermission(teamId!, 'TRACK_MATCH');
  const myPlayerIds = useMyPlayerIds();
  const canOpenPlayer = (playerId: string) => canTrack || myPlayerIds.has(playerId);
  // The server decides who gets every row (lib/playerPrivacy): a global admin
  // who isn't a member has no TRACK_MATCH here but still gets them all. Any row
  // that isn't the caller's own means this is the full staff view.
  const fullView = canTrack || (data?.playerStats ?? []).some((r) => !myPlayerIds.has(r.player.id));
  const myOwnStats = (data?.playerStats ?? []).filter((r) => myPlayerIds.has(r.player.id));

  const insights =
  trends.data
    ? generateTeamInsights(trends.data)
    : [];


  if (isLoading && !data) return <p className="text-grey-600">Loading analytics...</p>;
  if (isError || !data) return <p className="text-error">Couldn't load team analytics.</p>;

  // Scheduled and cancelled matches have no events, so they don't count as shown.
  const matchCount = data.matchSummary.completed + data.matchSummary.inProgress;
  const hasRange = !!(range.from || range.to);

  return (
    <div className="space-y-6">
      <TeamSubNav teamId={data.team.id} teamName={data.team.name} />
      <div>
        <h1 className="text-2xl font-bold text-grey-900">{data.team.name} Dashboard</h1>
        <p className="text-sm text-grey-600 mt-1">
          {data.team.division && `${data.team.division} | `}Season {data.team.season}
        </p>
      </div>

      <DateRangeFilter season={data.team.season} />
      <p className="text-sm text-grey-600">
        {hasRange ? `Showing ${matchCount} ${matchCount === 1 ? 'match' : 'matches'} ${rangeText(range)}` : `Showing all ${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`}
      </p>

      {hasRange && matchCount === 0 && (
        <div className="card p-6 text-center text-grey-600 text-sm">
          No matches in these dates. Try a wider range.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(data.matchSummary).map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-grey-600">{label.replace(/([A-Z])/g, ' $1')}</p>
            <p className="tabular-nums text-2xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <StatsCards stats={data.teamStats} />

      <section id="zones">
        {zones.isLoading ? (
          <p className="text-sm text-grey-600">Loading court zones…</p>
        ) : zones.isError || !zones.data ? (
          <p className="text-sm text-error">Couldn't load court zones. Try refreshing the page.</p>
        ) : (
          <CourtHeatMap data={zones.data} title="Court zones" canTrack={canTrack} />
        )}
      </section>

      {/* Team-level point flow across the team's matches: every member. */}
      <Suspense fallback={panelFallback}>
        <section id="rotations">
          <RotationAnalytics scope="team" id={teamId!} canTrack={canTrack} range={range} />
        </section>
        <section id="advanced">
          <AdvancedMetricsPanel scope="team" id={teamId!} canTrack={canTrack} range={range} />
        </section>
      </Suspense>

        {trends.data && trends.data.length === 0 && (
        <div className="card p-6 text-center text-grey-600 text-sm">
          Complete matches to see performance trends over time.
        </div>
      )}

      {trends.data && trends.data.length > 0 && (
          <div className="grid lg:grid-cols-2 gap-4">
            <TeamTrendChart
              title="Kills Trend"
              data={trends.data}
              dataKey="kills"
            />

            <TeamTrendChart
              title="Aces Trend"
              data={trends.data}
              dataKey="aces"
            />

            <TeamTrendChart
              title="Blocks Trend"
              data={trends.data}
              dataKey="blocks"
            />

            <TeamTrendChart
              title="Digs Trend"
              data={trends.data}
              dataKey="digs"
            />

            <TeamTrendChart
              title="Hitting % Trend"
              data={trends.data}
              dataKey="hittingPercentage"
            />
          </div>
        )}
      {/* Individual player breakdowns are staff-only — the server now sends
          non-staff viewers 0 or 1 playerStats rows (their own), so leaderboards
          and cross-player insights have nothing meaningful to show them. */}
      {fullView && (
        <div className="grid md:grid-cols-2 gap-4">
          <StatLeaderboardChart
            title="Top Killers"
            players={data.playerStats}
            metric="kills"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
            range={range}
          />

          <StatLeaderboardChart
            title="Top Aces"
            players={data.playerStats}
            metric="aces"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
            range={range}
          />

          <StatLeaderboardChart
            title="Top Blocks"
            players={data.playerStats}
            metric="totalBlocks"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
            range={range}
          />

          <StatLeaderboardChart
            title="Top Digs"
            players={data.playerStats}
            metric="digs"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
            range={range}
          />
        </div>
      )}

      <CoachInsights insights={insights} />

      {fullView ? (
        <>
          <PlayerInsights players={data.playerStats} />
          <section>
            <h2 className="text-lg font-semibold text-grey-900 mb-3">Season Player Statistics</h2>
            <PlayerStatsTable rows={data.playerStats} teamId={teamId!} canOpen={canOpenPlayer} range={range} />
          </section>
          {/* Coach/staff who also have a linked player record on this team — the
              non-staff branch below already covers "Your Stats" for everyone else. */}
          {myOwnStats.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-grey-900 mb-3">My Stats</h2>
              <PlayerStatsTable rows={myOwnStats} teamId={teamId!} canOpen={canOpenPlayer} range={range} />
            </section>
          )}
        </>
      ) : data.playerStats[0] ? (
        <section>
          <h2 className="text-lg font-semibold text-grey-900 mb-3">Your Stats</h2>
          <PlayerStatsTable rows={data.playerStats} teamId={teamId!} canOpen={canOpenPlayer} range={range} />
        </section>
      ) : null}
    </div>
  );
}


