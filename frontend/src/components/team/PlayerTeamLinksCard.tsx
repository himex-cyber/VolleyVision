import { useState } from 'react';
import { usePlayerTeams, useAddPlayerTeamLink, useRemovePlayerTeamLink } from '../../hooks';
import { useMyTeams, useMyMemberships } from '../../hooks';
import { getApiErrorMessage } from '../../lib/api';
import { CloseIcon } from '../ui/icons';

interface Props {
  playerId:      string;
  homeTeamId:    string;
  playerName:    string;
}

export default function PlayerTeamLinksCard({ playerId, homeTeamId, playerName }: Props) {
  const { data, isLoading } = usePlayerTeams(playerId);
  // Link targets must mirror the backend rule exactly: POST
  // /players/:id/team-links requires MANAGE_TEAM on the *target* team, which
  // only the owner and a HEAD_COACH hold. Building this from the general
  // team list would offer teams the user merely plays on, and every one of
  // those picks would 403.
  const { data: ownedTeams } = useMyTeams();
  const { data: memberships } = useMyMemberships();
  const addLink    = useAddPlayerTeamLink(playerId);
  const removeLink = useRemovePlayerTeamLink(playerId);

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [error, setError] = useState('');

  const manageable = [
    ...(ownedTeams ?? []).map((t) => ({ id: t.id, name: t.name })),
    ...(memberships ?? [])
      .filter((m) => m.role === 'HEAD_COACH')
      .map((m) => ({ id: m.team.id, name: m.team.name })),
  ];

  // Exclude the home team, teams already linked, and any duplicate between the
  // owned and head-coach lists.
  const excluded = new Set([homeTeamId, ...(data?.linkedTeams.map((l) => l.team.id) ?? [])]);
  const availableTeams = manageable.filter((t) => {
    if (excluded.has(t.id)) return false;
    excluded.add(t.id);
    return true;
  });

  async function handleAdd() {
    if (!selectedTeamId) return;
    setError('');
    try {
      await addLink.mutateAsync(selectedTeamId);
      setSelectedTeamId('');
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't link that team. Try again."));
    }
  }

  if (isLoading) return <p className="text-xs text-grey-600 py-1">Loading linked teams…</p>;

  return (
    <div className="pt-3 border-t border-grey-200 space-y-2">
      <p className="text-sm text-grey-600 font-semibold">
        {playerName}'s teams
      </p>

      {/* Additional-team links only — the home team is obvious from the roster
          this player is listed under, so its badge is redundant (Task 10). */}
      <div className="flex flex-wrap items-center gap-2">
        {data && data.linkedTeams.length === 0 && (
          <span className="text-xs text-grey-400">Not linked to any additional teams.</span>
        )}
        {data?.linkedTeams.map((l) => (
          <span
            key={l.linkId}
            className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 rounded-full
                       bg-grey-200 text-grey-900 text-xs font-semibold"
          >
            {l.team.name}
            <button
              className="w-7 h-7 shrink-0 grid place-items-center rounded-full text-grey-600
                         hover:text-error hover:bg-error/10 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              onClick={() => removeLink.mutate(l.team.id)}
              title={`Remove link to ${l.team.name}`}
              aria-label={`Remove link to ${l.team.name}`}
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
      </div>

      {/* Add link */}
      {availableTeams.length > 0 && (
        <div className="flex gap-2 items-center">
          <select
            className="input text-xs py-1 flex-1"
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
          >
            <option value="">Link to another team…</option>
            {availableTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            className="btn-secondary text-xs px-3 py-1 shrink-0"
            disabled={!selectedTeamId || addLink.isPending}
            onClick={handleAdd}
          >
            {addLink.isPending ? 'Linking…' : 'Link'}
          </button>
        </div>
      )}
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}
