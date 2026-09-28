import { NavLink } from 'react-router-dom';
import { isEnabled } from '../../config/features';

// Shared tab group for a single team's pages, so Dashboard / Matches / Roster
// are reachable from any of the three without returning to the Teams grid.
// `end` on the Roster link keeps it from matching the /dashboard or /matches
// child routes.
export default function TeamSubNav({ teamId, teamName }: { teamId: string; teamName?: string }) {
  const tabs = [
    { to: `/teams/${teamId}/dashboard`, label: 'Dashboard', end: false },
    { to: `/teams/${teamId}/matches`, label: 'Matches', end: false },
    { to: `/teams/${teamId}`, label: 'Roster', end: true },
    ...(isEnabled('teamChat') ? [{ to: `/teams/${teamId}/chat`, label: 'Chat', end: false }] : []),
  ];

  return (
    <div className="flex items-center gap-1 border-b border-grey-200 pb-px overflow-x-auto">
      {teamName && (
        <span className="mr-3 font-display font-semibold text-grey-900 truncate max-w-[40%]">{teamName}</span>
      )}
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `inline-flex items-center min-h-[44px] px-3.5 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              isActive
                ? 'border-gold-500 text-navy-700 font-semibold'
                : 'border-transparent text-grey-600 hover:text-navy-700'
            }`}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
