import { useParams } from 'react-router-dom';
import { PlayerStatsTable, StatsCards } from '../components/analytics/StatsOverview';
import StatLeaderboardChart from '../components/charts/StatLeaderboardChart';
import { useTeamAnalytics, useTeamTrends, useHasPermission, useMyPlayerIds } from '../hooks';
import TeamTrendChart from '../components/charts/TeamTrendChart';
import CoachInsights from '../components/analytics/CoachInsights';
import { generateTeamInsights } from '../lib/insights';
import PlayerInsights from '../components/analytics/PlayerInsights';
import TeamSubNav from '../components/ui/TeamSubNav';

export default function TeamDashboardPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data, isLoading, isError } = useTeamAnalytics(teamId!);
  const trends = useTeamTrends(teamId!);
  // Individual player analytics are for this team's staff and the player
  // themself — gate the drill-down links the same way.
  const canTrack = useHasPermission(teamId!, 'TRACK_MATCH');
  const myPlayerIds = useMyPlayerIds(!canTrack);
  const canOpenPlayer = (playerId: string) => canTrack || myPlayerIds.has(playerId);

  const insights =
  trends.data
    ? generateTeamInsights(trends.data)
    : [];


  if (isLoading) return <p className="text-grey-600">Loading analytics...</p>;
  if (isError || !data) return <p className="text-error">Couldn't load team analytics.</p>;

  return (
    <div className="space-y-6">
      <TeamSubNav teamId={data.team.id} teamName={data.team.name} />
      <div>
        <h1 className="text-2xl font-bold text-grey-900">{data.team.name} Dashboard</h1>
        <p className="text-sm text-grey-600 mt-1">
          {data.team.division && `${data.team.division} | `}Season {data.team.season}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(data.matchSummary).map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-grey-600">{label.replace(/([A-Z])/g, ' $1')}</p>
            <p className="tabular-nums text-2xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <StatsCards stats={data.teamStats} />
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
      {canTrack && (
        <div className="grid md:grid-cols-2 gap-4">
          <StatLeaderboardChart
            title="Top Killers"
            players={data.playerStats}
            metric="kills"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
          />

          <StatLeaderboardChart
            title="Top Aces"
            players={data.playerStats}
            metric="aces"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
          />

          <StatLeaderboardChart
            title="Top Blocks"
            players={data.playerStats}
            metric="totalBlocks"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
          />

          <StatLeaderboardChart
            title="Top Digs"
            players={data.playerStats}
            metric="digs"
            teamId={teamId!}
            canOpen={canOpenPlayer}
            canOpenAll={canTrack}
          />
        </div>
      )}

      <CoachInsights insights={insights} />

      {canTrack ? (
        <>
          <PlayerInsights players={data.playerStats} />
          <section>
            <h2 className="text-lg font-semibold text-grey-900 mb-3">Season Player Statistics</h2>
            <PlayerStatsTable rows={data.playerStats} teamId={teamId!} canOpen={canOpenPlayer} />
          </section>
        </>
      ) : data.playerStats[0] ? (
        <section>
          <h2 className="text-lg font-semibold text-grey-900 mb-3">Your Stats</h2>
          <PlayerStatsTable rows={data.playerStats} teamId={teamId!} canOpen={canOpenPlayer} />
        </section>
      ) : null}
    </div>
  );
}


