import { Link } from 'react-router-dom';
import { useCoachDashboard, useTeamAnalytics } from '../hooks';
import { useAuth } from '../context/AuthContext';
import type { MatchSummaryItem, PlayerStatLine, StatLine } from '../types';
import { POSITION_LABELS } from '../types';
import PlayerRadarChart from '../components/charts/PlayerRadarChart';
import TeamTrendChart from '../components/charts/TeamTrendChart';

function won(m: MatchSummaryItem) {
  return m.homeSetsWon > m.awaySetsWon;
}

// ── Win-rate donut (a single-value gauge, not a data chart) ───────────────────
function WinRateDonut({ pct }: { pct: number | null }) {
  const r = 50;
  const circ = 2 * Math.PI * r;
  const frac = pct == null ? 0 : Math.max(0, Math.min(100, pct)) / 100;
  return (
    <svg viewBox="0 0 120 120" width="118" height="118" className="shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="12" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke="#FFB81C" strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${frac * circ} ${circ}`} transform="rotate(-90 60 60)"
      />
      <text x="60" y="56" textAnchor="middle" fontFamily="Inter,sans-serif" fontWeight="700" fontSize="26" fill="#FFFFFF">
        {pct == null ? '—' : `${Math.round(pct)}%`}
      </text>
      <text x="60" y="74" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="10.5" fill="#8FA0C4">win rate</text>
    </svg>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-2.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-grey-600">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="font-bold text-[30px] leading-none tabular-nums text-grey-900">{value}</span>
        {sub && <span className="text-xs text-grey-600">{sub}</span>}
      </div>
    </div>
  );
}

export default function CoachDashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useCoachDashboard();

  const primaryTeam = data?.ownedTeams[0] ?? data?.memberTeams[0];
  const { data: analytics } = useTeamAnalytics(primaryTeam?.id ?? '');

  if (isLoading) return <p className="text-grey-600">Loading dashboard…</p>;
  if (!data) return <p className="text-error">Couldn't load coach dashboard.</p>;

  const { ownedTeams, memberTeams, coachingStats, recentMatches, upcomingMatches } = data;

  if (!primaryTeam) {
    return (
      <div className="space-y-5">
        <h1 className="font-display font-bold text-2xl text-grey-900">Welcome back, Coach {user?.firstName}</h1>
        <div className="card p-12 text-center space-y-3">
          <p className="text-grey-900 font-medium">No teams yet</p>
          <p className="text-grey-600 text-sm">Create a team to unlock your coaching dashboard.</p>
          <Link to="/teams" className="btn-primary inline-block">Create a team</Link>
        </div>
      </div>
    );
  }

  const allTeams = [...ownedTeams, ...memberTeams];
  const squadSize = allTeams.reduce((n, t) => n + (t._count?.players ?? 0), 0);

  const completed = recentMatches.filter((m) => m.status === 'COMPLETED');
  const form = completed.slice(0, 5);
  const nextMatch = upcomingMatches?.[0];

  // Match performance: sets won per match for the primary team, oldest → newest.
  const perfData = [...completed]
    .filter((m) => m.team.id === primaryTeam.id)
    .slice(0, 10)
    .reverse()
    .map((m) => ({ opponent: m.opponent.length > 8 ? `${m.opponent.slice(0, 8)}…` : m.opponent, sets: m.homeSetsWon }));

  const teamStats: StatLine | undefined = analytics?.teamStats;
  const hasTeamStats = !!teamStats && teamStats.totalEvents > 0;

  // Top players by kills (no composite rating exists in this app's data model).
  const topPlayers: PlayerStatLine[] = (analytics?.playerStats ?? [])
    .filter((p) => p.kills > 0)
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 4);

  const summary = [
    coachingStats.winPercentage != null ? `Win rate ${coachingStats.winPercentage}% this season.` : null,
    nextMatch ? `${nextMatch.opponent} up next — prep is due.` : null,
  ].filter(Boolean).join(' ');

  return (
    <div className="space-y-4">
      {/* Hero band */}
      <div className="relative overflow-hidden rounded-[20px] bg-navy-700 text-white p-6 sm:p-7">
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_auto_auto] items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-navy-300">
              {primaryTeam.name} · Season {primaryTeam.season}
            </p>
            <h1 className="font-display font-bold text-[30px] leading-tight mt-2">Welcome back, Coach {user?.firstName}</h1>
            {summary && <p className="text-[13.5px] text-navy-100 mt-2 max-w-sm leading-relaxed">{summary}</p>}
            <div className="flex flex-wrap gap-2.5 mt-4">
              <Link
                to={`/teams/${primaryTeam.id}/matches`}
                className="btn-primary text-sm inline-flex items-center gap-2"
              >
                + New match
              </Link>
              <button
                type="button"
                disabled
                title="Coming soon — training sessions"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                           bg-white/10 border border-white/20 text-white/80 cursor-not-allowed"
              >
                Plan session
              </button>
            </div>
          </div>

          <div className="hidden lg:flex justify-center">
            <WinRateDonut pct={coachingStats.winPercentage} />
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-300">Record</p>
              <div className="flex items-baseline gap-1.5 mt-1 tabular-nums">
                <span className="font-bold text-[26px]">{coachingStats.wins}</span>
                <span className="text-navy-300 font-semibold">–</span>
                <span className="font-bold text-[26px]">{coachingStats.losses}</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-navy-300">Form</p>
              <div className="flex gap-1.5 mt-1.5">
                {form.length === 0 && <span className="text-navy-300 text-xs">No completed matches</span>}
                {form.map((m) => (
                  <span
                    key={m.id}
                    title={`${won(m) ? 'W' : 'L'} ${m.homeSetsWon}–${m.awaySetsWon} vs ${m.opponent}`}
                    className={`w-6 h-6 rounded-md grid place-items-center text-[11px] font-bold ${
                      won(m) ? 'bg-success/25 text-success-dark' : 'bg-error/25 text-error-dark'
                    }`}
                  >
                    {won(m) ? 'W' : 'L'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI strip — real metrics only (training-load + squad-rating omitted, no data) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <KpiCard label="Matches" value={coachingStats.totalMatches} />
        <KpiCard label="Win rate" value={coachingStats.winPercentage != null ? `${coachingStats.winPercentage}%` : '—'} />
        <KpiCard label="Squad" value={squadSize} sub={`${allTeams.length} team${allTeams.length === 1 ? '' : 's'}`} />
        <KpiCard label="Teams" value={coachingStats.teamsOwned + coachingStats.teamsCoached} sub={`${coachingStats.teamsOwned} owned`} />
      </div>

      {/* Next events + team skills */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-[17px] text-grey-900">Next events</h2>
            {primaryTeam && (
              <Link to={`/teams/${primaryTeam.id}/matches`} className="text-[12.5px] font-semibold text-navy-700">Matches</Link>
            )}
          </div>
          {(upcomingMatches ?? []).length === 0 ? (
            <p className="text-grey-600 text-sm py-4">No upcoming matches scheduled.</p>
          ) : (
            <div className="divide-y divide-grey-200">
              {upcomingMatches.slice(0, 4).map((m) => {
                const d = new Date(m.matchDate);
                return (
                  <div key={m.id} className="flex items-center gap-3.5 py-3">
                    <div className="w-11 h-[52px] shrink-0 rounded-xl bg-navy-100 flex flex-col items-center justify-center leading-none">
                      <span className="text-[10px] font-semibold text-grey-600 uppercase">
                        {d.toLocaleDateString([], { weekday: 'short' })}
                      </span>
                      <span className="font-display font-bold text-[18px] text-navy-700">
                        {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-grey-900 truncate">vs {m.opponent}</p>
                      <p className="text-xs text-grey-600">
                        {m.team.name}{m.venue ? ` · ${m.venue}` : ''}{m.competition ? ` · ${m.competition}` : ''}
                      </p>
                    </div>
                    <span className="badge bg-gold-200 text-navy-900 shrink-0">Match</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasTeamStats && teamStats ? (
          <PlayerRadarChart stats={teamStats} />
        ) : (
          <div className="card p-5 grid place-items-center text-sm text-grey-600 min-h-[220px]">
            Record match events to see your team's skill profile.
          </div>
        )}
      </div>

      {/* Match performance */}
      {perfData.length >= 2 ? (
        <TeamTrendChart title="Match performance — sets won" data={perfData} dataKey="sets" />
      ) : null}

      {/* Top players + recent matches */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display font-semibold text-[17px] text-grey-900">Top players by kills</h2>
            <Link to={`/teams/${primaryTeam.id}`} className="text-[12.5px] font-semibold text-navy-700">Roster</Link>
          </div>
          {topPlayers.length === 0 ? (
            <p className="text-grey-600 text-sm py-3">No player stats recorded yet.</p>
          ) : (
            <div className="divide-y divide-grey-200">
              {topPlayers.map((p) => (
                <div key={p.player.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-9 h-9 rounded-full bg-navy-500 text-white grid place-items-center font-display font-bold text-[13px] shrink-0">
                    {p.player.firstName[0]}{p.player.lastName[0]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-semibold text-grey-900 truncate">
                      {p.player.firstName} {p.player.lastName}
                    </p>
                    <p className="text-[11.5px] text-grey-600">
                      {POSITION_LABELS[p.player.position]} · #{p.player.jerseyNumber}
                    </p>
                  </div>
                  <span className="tabular-nums font-bold text-navy-700 text-sm shrink-0">
                    {p.kills} <span className="text-grey-600 font-medium text-xs">K</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-display font-semibold text-[17px] text-grey-900 mb-2">Recent matches</h2>
          {completed.length === 0 ? (
            <p className="text-grey-600 text-sm py-3">No completed matches yet.</p>
          ) : (
            <div className="divide-y divide-grey-200">
              {completed.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center gap-3 py-2.5">
                  <span className={`w-8 h-8 rounded-lg grid place-items-center text-xs font-bold shrink-0 ${
                    won(m) ? 'bg-success/15 text-success-strong' : 'bg-error/15 text-error-strong'
                  }`}>
                    {won(m) ? 'W' : 'L'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-grey-900 truncate">vs {m.opponent}</p>
                    <p className="text-[11.5px] text-grey-600 tabular-nums">
                      {m.homeSetsWon}–{m.awaySetsWon} · {new Date(m.matchDate).toLocaleDateString()}
                    </p>
                  </div>
                  <Link to={`/matches/${m.id}/dashboard`} className="text-xs text-grey-400 hover:text-navy-700 transition-colors shrink-0">
                    Stats →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
