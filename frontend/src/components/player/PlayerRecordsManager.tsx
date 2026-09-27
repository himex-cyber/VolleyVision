import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerDashboard, useLinkPlayer, useUnlinkPlayer, useTeams, useTeam } from '../../hooks';
import { isEmailNotVerifiedError, getApiErrorMessage } from '../../lib/api';
import type { PlayerRecord } from '../../types';
import ResendVerificationNotice from '../ui/ResendVerificationNotice';

// Account-linking management — which roster entries this user account is tied to.
// Moved here from the Player Dashboard (Iteration 3 Task 8): it's a Profile/account
// concern, not day-to-day performance content.

function LinkedPlayerCard({ player, onUnlink }: { player: PlayerRecord; onUnlink: () => void }) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-10 h-10 bg-grey-50 border border-grey-200 rounded-lg flex items-center justify-center font-semibold tabular-nums text-navy-700 shrink-0">
        {player.jerseyNumber}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-grey-900 text-sm">{player.firstName} {player.lastName}</p>
        <p className="text-grey-600 text-xs">{player.team.name} · {player.position.replace(/_/g, ' ')}</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Link to={`/players/${player.id}/dashboard`} className="btn-secondary text-xs px-3 py-1.5">Analytics</Link>
        <button className="text-grey-400 hover:text-error text-xs transition-colors" onClick={onUnlink}>Unlink</button>
      </div>
    </div>
  );
}

function LinkPlayerPanel() {
  const { data: teams } = useTeams();
  const linkPlayer = useLinkPlayer();
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [error, setError] = useState('');
  const [notVerified, setNotVerified] = useState(false);

  const { data: selectedTeam } = useTeam(selectedTeamId);

  async function handleLink() {
    setError(''); setNotVerified(false);
    if (!selectedPlayerId) { setError('Select a player first.'); return; }
    try {
      await linkPlayer.mutateAsync(selectedPlayerId);
      setSelectedTeamId('');
      setSelectedPlayerId('');
    } catch (err) {
      if (isEmailNotVerifiedError(err)) {
        setNotVerified(true);
      } else {
        setError(getApiErrorMessage(err, "Couldn't link that player. Try again."));
      }
    }
  }

  return (
    <div className="card p-5 space-y-4 border-dashed">
      <div>
        <p className="font-semibold text-grey-900 text-sm">Link a Player Record</p>
        <p className="text-grey-600 text-xs mt-0.5">
          Connect your account to a player roster entry to unlock career statistics and development tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-grey-600 mb-1">Select Team</label>
          <select
            className="input text-sm"
            value={selectedTeamId}
            onChange={(e) => { setSelectedTeamId(e.target.value); setSelectedPlayerId(''); }}
          >
            <option value="">Choose a team…</option>
            {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-grey-600 mb-1">Select Player</label>
          <select
            className="input text-sm"
            value={selectedPlayerId}
            onChange={(e) => setSelectedPlayerId(e.target.value)}
            disabled={!selectedTeamId}
          >
            <option value="">Choose a player…</option>
            {selectedTeam?.players?.map((p) => (
              <option key={p.id} value={p.id}>#{p.jerseyNumber} {p.firstName} {p.lastName}</option>
            ))}
          </select>
        </div>
      </div>

      {notVerified && <ResendVerificationNotice />}
      {error && <p className="text-error text-xs">{error}</p>}

      <button className="btn-primary text-sm" onClick={handleLink} disabled={linkPlayer.isPending || !selectedPlayerId}>
        {linkPlayer.isPending ? 'Linking…' : 'Link Player Record'}
      </button>
    </div>
  );
}

export default function PlayerRecordsManager() {
  const { data } = usePlayerDashboard();
  const unlinkPlayer = useUnlinkPlayer();
  const players = data?.players ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-grey-600">My Player Records</h2>
      {players.length === 0 ? (
        <LinkPlayerPanel />
      ) : (
        <>
          <div className="space-y-2">
            {players.map((player) => (
              <LinkedPlayerCard
                key={player.id}
                player={player}
                onUnlink={() => {
                  if (confirm(`Unlink ${player.firstName} ${player.lastName} from your account?`)) {
                    unlinkPlayer.mutate(player.id);
                  }
                }}
              />
            ))}
          </div>
          <LinkPlayerPanel />
        </>
      )}
    </section>
  );
}
