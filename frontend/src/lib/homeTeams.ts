/**
 * Copy of backend/src/lib/homeTeams.ts (tested there; the frontend can't
 * import backend code and has no test runner of its own — see that file's
 * header). Builds the /dashboard "My teams" cards: one per team the user
 * owns or belongs to, with their role there and the team's next match.
 *
 * ponytail: rule duplicated across the two packages, kept honest by the
 * backend file being the tested copy. Collapse to one import the day a
 * shared package or a frontend test runner exists.
 */

export type TeamRole = 'HEAD_COACH' | 'MANAGER' | 'ASSISTANT_COACH' | 'STATISTICIAN' | 'PLAYER' | 'VIEWER';
export type HomeBadge = 'Coach' | 'Staff' | 'Player' | 'Viewer';

interface TeamRef { id: string; name: string }
interface UpcomingMatch { id: string; matchDate: string | Date; opponent: string; team: { id: string } }

export interface HomeTeamCard {
  teamId: string;
  name: string;
  role: TeamRole;
  badge: HomeBadge;
  nextMatch: { id: string; matchDate: string | Date; opponent: string } | null;
}

const BADGE: Record<TeamRole, HomeBadge> = {
  HEAD_COACH: 'Coach',
  MANAGER: 'Staff',
  ASSISTANT_COACH: 'Staff',
  STATISTICIAN: 'Staff',
  PLAYER: 'Player',
  VIEWER: 'Viewer',
};
const ORDER: HomeBadge[] = ['Coach', 'Staff', 'Player', 'Viewer'];

export function buildHomeTeams(
  owned: TeamRef[],
  memberships: { role: TeamRole; team: TeamRef }[],
  upcoming: UpcomingMatch[],
): HomeTeamCard[] {
  // The owner is always the team's coach (the server resolves them to
  // HEAD_COACH too), even if their membership row is missing.
  const byTeam = new Map<string, { team: TeamRef; role: TeamRole }>();
  for (const m of memberships) byTeam.set(m.team.id, { team: m.team, role: m.role });
  for (const team of owned) byTeam.set(team.id, { team, role: 'HEAD_COACH' });

  const soonest = [...upcoming].sort((a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime());

  return [...byTeam.values()]
    .map(({ team, role }) => {
      const next = soonest.find((m) => m.team.id === team.id);
      return {
        teamId: team.id,
        name: team.name,
        role,
        badge: BADGE[role],
        nextMatch: next ? { id: next.id, matchDate: next.matchDate, opponent: next.opponent } : null,
      };
    })
    .sort((a, b) => ORDER.indexOf(a.badge) - ORDER.indexOf(b.badge) || a.name.localeCompare(b.name));
}
