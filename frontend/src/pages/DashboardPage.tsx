import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCoachDashboard, useMyPlayerRecords } from '../hooks';
import { buildHomeTeams, type HomeTeamCard } from '../lib/homeTeams';
import type { TeamRole } from '../types';
import { ROLE_BADGE } from '../lib/teamRoles';
import JoinByCodeCard from '../components/team/JoinByCodeCard';
import MyStats from '../components/player/MyStats';

// One home page for everyone (Phase 4.5) — there's no global coach/player
// mode any more. "My teams" shows a card per team with the caller's role
// there (from buildHomeTeams); "My stats" only appears for someone with a
// linked player record, on any team.

// Same destination TeamsPage's own team cards link to.
function TeamCard({ card }: { card: HomeTeamCard }) {
  return (
    <Link
      to={`/teams/${card.teamId}/dashboard`}
      className="card p-5 flex flex-col gap-3 hover:border-navy-500 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-grey-900 text-lg leading-tight min-w-0 truncate">{card.name}</h3>
        <span className={`badge ${ROLE_BADGE[card.role]} shrink-0 mt-0.5`}>{card.badge}</span>
      </div>
      <p className="text-sm text-grey-600">
        {card.nextMatch
          ? `Next: vs ${card.nextMatch.opponent} · ${new Date(card.nextMatch.matchDate).toLocaleDateString()}`
          : 'No upcoming matches'}
      </p>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  // One call has it all: owned teams, other teams with the caller's role there,
  // and each team's soonest upcoming match.
  const { data: dash, isLoading, isError } = useCoachDashboard();
  // Records only; MyStats fetches the portal itself when it renders.
  const { data: records } = useMyPlayerRecords();

  const joinRef = useRef<HTMLDivElement>(null);

  const teams = useMemo(
    () => buildHomeTeams(
      dash?.ownedTeams ?? [],
      (dash?.memberTeams ?? []).map((t) => ({ role: t.memberRole as TeamRole, team: t })),
      dash?.upcomingMatches ?? [],
    ),
    [dash],
  );

  const hasStats = (records?.length ?? 0) > 0;

  function focusJoinCard() {
    const el = joinRef.current;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector('input')?.focus();
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h1 className="font-display font-bold text-2xl text-grey-900">Welcome back, {user.firstName}</h1>

      {isLoading ? (
        <p className="text-grey-600 text-sm">Loading your teams…</p>
      ) : isError ? (
        <p className="text-error text-sm">Couldn't load your teams. Check your connection and refresh the page.</p>
      ) : teams.length === 0 ? (
        <div className="card p-6 sm:p-12 text-center space-y-4">
          <p className="text-grey-900 font-medium">Create a team or join one with a code.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/teams?new=1" className="btn-primary">Create a team</Link>
            <button type="button" className="btn-secondary" onClick={focusJoinCard}>
              Join with a code
            </button>
          </div>
          <div ref={joinRef} className="max-w-md mx-auto text-left">
            <JoinByCodeCard />
          </div>
        </div>
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-grey-600">My teams</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((card) => <TeamCard key={card.teamId} card={card} />)}
          </div>
        </section>
      )}

      {hasStats && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-grey-600">My stats</h2>
          <MyStats />
        </section>
      )}
    </div>
  );
}
