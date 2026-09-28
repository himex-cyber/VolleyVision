import { useParams } from 'react-router-dom';
import { useMatchAnalytics, useMatchReport, useHasPermission, useMyPlayerIds } from '../hooks';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import { PlayerStatsTable, StatsCards } from '../components/analytics/StatsOverview';
import MatchReportCard from '../components/analytics/MatchReportCard';

export default function MatchDashboardPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { data, isLoading, isError } = useMatchAnalytics(matchId!);
  const { data: reportData } = useMatchReport(matchId!);
  // teamId is only known once the match loads; the hook stays unconditional and
  // re-runs when it resolves. Track is offered only to those who can track a
  // live match (players never can — Iteration 3 Task 6).
  const canTrack = useHasPermission(data?.match.teamId ?? '', 'TRACK_MATCH');
  // Staff open any player's stats; a player opens only their own.
  const myPlayerIds = useMyPlayerIds(!canTrack);

  if (isLoading) return <p className="text-grey-600">Loading analytics...</p>;
  if (isError || !data) return <p className="text-error">Couldn't load match analytics.</p>;

  return (
    <div className="space-y-6">
      <MatchPageHeader
        matchId={data.match.id}
        teamId={data.match.teamId}
        teamName={data.match.teamName}
        opponent={data.match.opponent}
        matchDate={data.match.matchDate}
        competition={data.match.competition}
        venue={data.match.venue}
        status={data.match.status}
        canTrack={canTrack}
      />

      {/* The nav tab reads just "Stats", so name the page explicitly here —
          same pattern as the player dashboard's "Game Day Stats" eyebrow. */}
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">Match Stats</p>

      {/* Phase 4 — Final Score Summary */}
      <div className="card p-4 space-y-3">
        {/* Match winner */}
        {data.match.status === 'COMPLETED' && (
          <div className="text-center py-2 rounded-lg bg-gold-500/10 border border-gold-500/30 text-navy-700 font-semibold text-sm">
            {data.match.homeSetsWon >= data.match.awaySetsWon
              ? `${data.match.teamName} won the match`
              : `${data.match.opponent} won the match`}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex-1 min-w-0 text-right">
            <div className="text-sm text-grey-600 mb-1 truncate">{data.match.teamName}</div>
            <div className="tabular-nums text-3xl font-bold text-grey-900">{data.match.homeScore}</div>
          </div>
          <div className="text-center shrink-0">
            <div className="flex items-center gap-2 justify-center mb-1">
              <span className="tabular-nums text-2xl font-bold text-navy-700">{data.match.homeSetsWon}</span>
              <span className="text-grey-600 text-sm">–</span>
              <span className="tabular-nums text-2xl font-bold text-grey-600">{data.match.awaySetsWon}</span>
            </div>
            <div className="text-xs text-grey-600">Sets won</div>
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm text-grey-600 mb-1 truncate">{data.match.opponent}</div>
            <div className="tabular-nums text-3xl font-bold text-grey-600">{data.match.awayScore}</div>
          </div>
        </div>

        {/* Per-set results */}
        {Array.isArray(data.match.setScores) && (data.match.setScores as {set:number;home:number;away:number}[]).length > 0 && (
          <div className="border-t border-grey-200 pt-3">
            <div className="text-xs text-grey-600 mb-2 text-center">Set results</div>
            <div className="flex gap-2 justify-center flex-wrap">
              {(data.match.setScores as {set:number;home:number;away:number}[]).map((s) => {
                const homeWon = s.home > s.away;
                return (
                  <div key={s.set} className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] text-grey-600">S{s.set}</span>
                    <span className={`tabular-nums text-sm font-bold px-3 py-1 rounded border ${homeWon ? 'text-navy-700 border-gold-500/30 bg-gold-500/10' : 'text-grey-600 border-grey-200 bg-grey-50'}`}>
                      {s.home}–{s.away}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sprint 6 — Automated Match Report */}
      {reportData && <MatchReportCard report={reportData} />}

      <StatsCards stats={data.teamStats} />

      <section>
        <h2 className="text-lg font-semibold text-grey-900 mb-3">Set Breakdown</h2>
        {!data.setStats.length ? (
          <div className="card p-6 text-grey-600 text-sm">Record events to generate set analytics.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.setStats.map((set) => (
              <div key={set.setNumber} className="card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-grey-900">Set {set.setNumber}</h3>
                  <span className="tabular-nums text-xs text-grey-600">{set.totalEvents} events</span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                  <div><p className="tabular-nums text-lg">{set.kills}</p><p className="text-xs text-grey-600">Kills</p></div>
                  <div><p className="tabular-nums text-lg">{set.aces}</p><p className="text-xs text-grey-600">Aces</p></div>
                  <div><p className="tabular-nums text-lg">{set.digs}</p><p className="text-xs text-grey-600">Digs</p></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-grey-900 mb-3">Player Statistics</h2>
        <PlayerStatsTable rows={data.playerStats} matchId={matchId} teamId={data.match.teamId} canOpen={(id) => canTrack || myPlayerIds.has(id)} />
      </section>
    </div>
  );
}
