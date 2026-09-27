import { useParams } from 'react-router-dom';
import { PlayerStatsTable, StatsCards } from '../components/analytics/StatsOverview';
import StatLeaderboardChart from '../components/charts/StatLeaderboardChart';
import { useTeamAnalytics, useTeamTrends, useHasPermission } from '../hooks';
import TeamTrendChart from '../components/charts/TeamTrendChart';
import CoachInsights from '../components/analytics/CoachInsights';
import { generateTeamInsights } from '../lib/insights';
import PlayerInsights from '../components/analytics/PlayerInsights';
import TeamSubNav from '../components/ui/TeamSubNav';

export default function TeamDashboardPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data, isLoading, isError } = useTeamAnalytics(teamId!);
  const trends = useTeamTrends(teamId!);
  // Individual player analytics 403 for anyone but this team's tracking staff
  // (or the player themself, which this season-wide list has no way to know
  // per row) — gate the drill-down links the same way.
  const canOpenPlayerDashboard = useHasPermission(teamId!, 'TRACK_MATCH');

  const insights =
  trends.data
    ? generateTeamInsights(trends.data)
    : [];


  if (isLoading) return <p className="text-navy-300">Loading analytics...</p>;
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
            <p className="text-xs text-navy-300">{label.replace(/([A-Z])/g, ' $1')}</p>
            <p className="tabular-nums text-2xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <StatsCards stats={data.teamStats} />
        {trends.data && trends.data.length === 0 && (
        <div className="card p-6 text-center text-navy-300 text-sm">
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
      <div className="grid md:grid-cols-2 gap-4">
        <StatLeaderboardChart
          title="Top Killers"
          players={data.playerStats}
          metric="kills"
          teamId={teamId!}
          canOpen={canOpenPlayerDashboard}
        />

        <StatLeaderboardChart
          title="Top Aces"
          players={data.playerStats}
          metric="aces"
          teamId={teamId!}
          canOpen={canOpenPlayerDashboard}
        />

        <StatLeaderboardChart
          title="Top Blocks"
          players={data.playerStats}
          metric="totalBlocks"
          teamId={teamId!}
          canOpen={canOpenPlayerDashboard}
        />

        <StatLeaderboardChart
          title="Top Digs"
          players={data.playerStats}
          metric="digs"
          teamId={teamId!}
          canOpen={canOpenPlayerDashboard}
        />
      </div>
      
      <CoachInsights insights={insights} />
      <PlayerInsights players={data.playerStats} />

      <section>
        <h2 className="text-lg font-semibold text-grey-900 mb-3">Season Player Statistics</h2>
        <PlayerStatsTable rows={data.playerStats} teamId={teamId!} canOpen={canOpenPlayerDashboard} />
      </section>
    </div>
  );
}


