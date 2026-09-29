import { NavLink, useLocation } from 'react-router-dom';
import { confirmLeave } from '../../lib/leaveGuard';

// Match-level tab group (Match Stats | Events | Track/Watch), one level down
// from TeamSubNav and styled identically to it. `mode` picks which live tab
// shows: 'track' for those who can run the tracker on an in-progress match,
// 'watch' for read-only spectators (players never get Track — Iteration 3
// Task 6), or omitted entirely outside of IN_PROGRESS.
export default function MatchSubNav({ matchId, mode }: { matchId: string; mode?: 'track' | 'watch' }) {
  const { pathname } = useLocation();
  const tabs = [
    { to: `/matches/${matchId}/dashboard`, label: 'Stats' },
    { to: `/matches/${matchId}/events`, label: 'Events' },
    ...(mode === 'track' ? [{ to: `/matches/${matchId}/track`, label: 'Track' }] : []),
    ...(mode === 'watch' ? [{ to: `/matches/${matchId}/watch`, label: 'Watch' }] : []),
  ];

  return (
    <div className="flex items-end border-b border-grey-200 pb-px overflow-x-auto print:hidden">
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            // The tracker asks first while taps are waiting to send (6.9).
            onClick={(e) => { if (t.to !== pathname && !confirmLeave()) e.preventDefault(); }}
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
    </div>
  );
}
