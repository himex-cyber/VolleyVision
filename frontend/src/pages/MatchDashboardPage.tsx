import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { useMatchAnalytics, useMatchReport, useMatchZones, useHasPermission, useMyPlayerIds } from '../hooks';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import PrintButton from '../components/ui/PrintButton';
import PrintHeader from '../components/ui/PrintHeader';
import { format, parseISO } from 'date-fns';
import { PlayerStatsTable, StatsCards } from '../components/analytics/StatsOverview';
import CsvButton from '../components/analytics/CsvButton';
import { playerStatsCsv } from '../lib/analyticsCsv';
import { safeFileName, toCsv } from '../lib/csv';
import MatchReportCard from '../components/analytics/MatchReportCard';
import CourtHeatMap from '../components/analytics/CourtHeatMap';

// Point-flow panels (7.9): their own chunks (recharts and all), so the
// dashboard's first paint doesn't wait for them.
const MomentumChart = lazy(() => import('../components/charts/MomentumChart'));
const RotationAnalytics = lazy(() => import('../components/analytics/RotationAnalytics'));
const AdvancedMetricsPanel = lazy(() => import('../components/analytics/AdvancedMetricsPanel'));
// The same imports as the lazy panels (the bundler caches them): printing
// waits for these chunks, or the PDF would hold loading placeholders.
const panelChunks = () => Promise.all([
  import('../components/charts/MomentumChart'),
  import('../components/analytics/RotationAnalytics'),
  import('../components/analytics/AdvancedMetricsPanel'),
]);
const panelFallback = <div className="card p-6 h-40 animate-pulse bg-grey-50" aria-hidden="true" />;

export default function MatchDashboardPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { data, isLoading, isError } = useMatchAnalytics(matchId!);
  const { data: reportData } = useMatchReport(matchId!);
  const { data: zonesData, isLoading: zonesLoading, isError: zonesError } = useMatchZones(matchId!);
  // teamId is only known once the match loads; the hook stays unconditional and
  // re-runs when it resolves. Track is offered only to those who can track a
  // live match (players never can — Iteration 3 Task 6).
  const canTrack = useHasPermission(data?.match.teamId ?? '', 'TRACK_MATCH');
  // Staff open any player's stats; a player opens only their own.
  const myPlayerIds = useMyPlayerIds(!canTrack);
  // The server decides who gets every row (lib/playerPrivacy): a global admin
  // who isn't a member has no TRACK_MATCH here but still gets them all. Any row
  // that isn't the caller's own means this is the full staff view.
  const fullView = canTrack || (data?.playerStats ?? []).some((r) => !myPlayerIds.has(r.player.id));

  if (isLoading) return <p className="text-grey-600">Loading analytics...</p>;
  if (isError || !data) return <p className="text-error">Couldn't load match analytics.</p>;

  // matchDate is fixture wall-clock time stored as UTC (8.0.7): its date part is
  // the entered date, whereas formatting it in local time can shift the day.
  const fileParts = [data.match.teamName, 'vs', data.match.opponent, data.match.matchDate.slice(0, 10)];
  const csvName = (table: string) => safeFileName(['VolleyVision', ...fileParts, table]);
  const printedMatch = `${data.match.teamName} vs ${data.match.opponent}, ${format(parseISO(data.match.matchDate.slice(0, 10)), 'd MMM yyyy')}`;

  // A set can be in the scores only (no events) or in the stats only (no score
  // entered), so join on the set number and leave the missing side empty.
  const buildSetsCsv = () => {
    const scores = Array.isArray(data.match.setScores) ? (data.match.setScores as { set: number; home: number; away: number }[]) : [];
    const nums = [...new Set([...scores.map((s) => s.set), ...data.setStats.map((s) => s.setNumber)])].sort((a, b) => a - b);
    return toCsv(
      [
        { header: 'Set', value: (n: number) => n },
        { header: 'Us', value: (n) => scores.find((s) => s.set === n)?.home ?? null },
        { header: 'Them', value: (n) => scores.find((s) => s.set === n)?.away ?? null },
        { header: 'Kills', value: (n) => data.setStats.find((s) => s.setNumber === n)?.kills ?? null },
        { header: 'Aces', value: (n) => data.setStats.find((s) => s.setNumber === n)?.aces ?? null },
        { header: 'Digs', value: (n) => data.setStats.find((s) => s.setNumber === n)?.digs ?? null },
        { header: 'Events', value: (n) => data.setStats.find((s) => s.setNumber === n)?.totalEvents ?? null },
      ],
      nums
    );
  };

  return (
    <div className="space-y-6">
      <PrintHeader lines={[printedMatch]} />
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

      <div className="flex justify-end">
        <PrintButton title={`VolleyVision – ${printedMatch.replace(', ', ' – ')}`} chunks={panelChunks} />
      </div>

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

      <section id="zones">
        {zonesLoading ? (
          <p className="text-sm text-grey-600">Loading court zones…</p>
        ) : zonesError || !zonesData ? (
          <p className="text-sm text-error">Couldn't load court zones. Try refreshing the page.</p>
        ) : (
          <CourtHeatMap data={zonesData} title="Court zones" canTrack={canTrack} />
        )}
      </section>

      {/* Team-level point flow: every member, no per-player rows. */}
      <Suspense fallback={panelFallback}>
        <section id="momentum">
          <MomentumChart matchId={matchId!} homeName={data.match.teamName} awayName={data.match.opponent} canTrack={canTrack} />
        </section>
        <section id="rotations">
          <RotationAnalytics scope="match" id={matchId!} canTrack={canTrack} csvName={csvName} />
        </section>
        <section id="advanced">
          <AdvancedMetricsPanel scope="match" id={matchId!} canTrack={canTrack} />
        </section>
      </Suspense>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-grey-900">Set Breakdown</h2>
          <CsvButton filename={csvName('sets')} build={buildSetsCsv} />
        </div>
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

      {/* Non-staff get 0 or 1 playerStats rows (their own) from the server —
          the full roster table is staff-only; a player sees just their own line. */}
      {fullView ? (
        <section>
          {/* Rows are exactly what's on screen: staff get every player, a player
              only their own row (the server already left the others out).
              Names are free text and can name minors. */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold text-grey-900">Player Statistics</h2>
            <CsvButton filename={csvName('player stats')} build={() => playerStatsCsv(data.playerStats)} />
          </div>
          <PlayerStatsTable rows={data.playerStats} matchId={matchId} teamId={data.match.teamId} canOpen={(id) => canTrack || myPlayerIds.has(id)} />
        </section>
      ) : data.playerStats[0] ? (
        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-semibold text-grey-900">Your Stats</h2>
            <CsvButton filename={csvName('my stats')} build={() => playerStatsCsv(data.playerStats)} />
          </div>
          <PlayerStatsTable rows={data.playerStats} matchId={matchId} teamId={data.match.teamId} canOpen={(id) => myPlayerIds.has(id)} />
        </section>
      ) : null}
    </div>
  );
}
