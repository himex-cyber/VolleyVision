import { Link } from 'react-router-dom';
import { formatMatchDate } from '../../lib/matchTime';
import type { UpcomingMatchItem } from '../../types';

interface Props {
  matches: UpcomingMatchItem[];
}

export default function UpcomingGamesCard({ matches }: Props) {
  return (
    <div className="card p-5">
      <h2 className="font-semibold text-chalk-100 mb-3">Upcoming games</h2>
      {matches.length === 0 ? (
        <p className="text-chalk-500 text-sm">No upcoming scheduled games.</p>
      ) : (
        <div className="space-y-2">
          {matches.map((m) => (
            <Link
              key={m.id}
              to={`/matches/${m.id}/dashboard`}
              className="block rounded-lg bg-court-800/60 hover:bg-court-800 p-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-chalk-100 truncate">
                    vs {m.opponent}
                  </div>
                  <div className="text-xs text-chalk-500 truncate">
                    {m.team.name}
                    {m.competition ? ` · ${m.competition}` : ''}
                    {m.venue ? ` · ${m.venue}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-medium text-navy-700">
                    {formatMatchDate(m.matchDate, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div className="text-xs text-chalk-600">
                    {formatMatchDate(m.matchDate, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
