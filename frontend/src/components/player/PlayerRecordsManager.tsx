import { Link } from 'react-router-dom';
import { usePlayerDashboard } from '../../hooks';
import type { PlayerRecord } from '../../types';

// Account-linking management — which roster entries this user account is tied to.
// Moved here from the Player Dashboard (Iteration 3 Task 8): it's a Profile/account
// concern, not day-to-day performance content.
//
// Phase 4: players can no longer self-link or self-unlink their record (both
// endpoints now always 403 server-side) — a coach with MANAGE_MEMBERS links or
// unlinks from the team roster instead (see TeamDetailPage).

function LinkedPlayerCard({ player }: { player: PlayerRecord }) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-10 h-10 bg-grey-50 border border-grey-200 rounded-lg flex items-center justify-center font-semibold tabular-nums text-navy-700 shrink-0">
        {player.jerseyNumber}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-grey-900 text-sm">{player.firstName} {player.lastName}</p>
        <p className="text-grey-600 text-xs">{player.team.name} · {player.position.replace(/_/g, ' ')}</p>
      </div>
      <Link to={`/players/${player.id}/dashboard?teamId=${player.teamId}`} className="btn-secondary text-xs px-3 py-1.5 shrink-0">Analytics</Link>
    </div>
  );
}

export default function PlayerRecordsManager() {
  const { data } = usePlayerDashboard();
  const players = data?.players ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-grey-600">My Player Records</h2>
      {players.length > 0 && (
        <div className="space-y-2">
          {players.map((player) => (
            <LinkedPlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
      <p className="card p-4 border-dashed text-sm text-grey-600">
        Ask your coach to link your player record.
      </p>
    </section>
  );
}
