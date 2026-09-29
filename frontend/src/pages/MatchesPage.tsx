import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatMatchDate, toDateTimeLocal } from '../lib/matchTime';
import { useTeam, useMatches, useCreateMatch, useUpdateMatch, useDeleteMatch, useHasPermission } from '../hooks';
import { isPendingApproval, type Match, type MatchStatus } from '../types';
import TeamSubNav from '../components/ui/TeamSubNav';
import { PencilIcon } from '../components/ui/icons';

const STATUS_STYLES = {
  SCHEDULED: 'badge-info',
  IN_PROGRESS: 'badge-accent',
  COMPLETED: 'badge-success',
  CANCELLED: 'badge-error',
};

const MATCH_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export default function MatchesPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { data: team } = useTeam(teamId!);

  // Match-management is tiered; live tracking is a separate permission. Players
  // hold neither, so they only ever see Stats + Events.
  const canManageMatches = useHasPermission(teamId!, 'CREATE_MATCH');
  const canDeleteMatches = useHasPermission(teamId!, 'DELETE_MATCH');
  const canTrack = useHasPermission(teamId!, 'TRACK_MATCH');

  const [filters, setFilters] = useState({ opponent: '', status: '', from: '', to: '' });
  const activeFilters = {
    opponent: filters.opponent || undefined,
    status:   filters.status   || undefined,
    from:     filters.from     || undefined,
    to:       filters.to       || undefined,
  };

  const { data: matches, isLoading } = useMatches(teamId!, activeFilters);
  const createMatch = useCreateMatch();
  const updateMatch = useUpdateMatch();
  const deleteMatch = useDeleteMatch();
  const navigate = useNavigate();

  const [showForm, setShowForm] = useState(false);
  const [pendingNotice, setPendingNotice] = useState('');
  const [form, setForm] = useState({ matchDate: '', opponent: '', competition: '', venue: '' });

  // Inline edit (Fix 4/5) — mirrors the create form but pre-filled, with an
  // explicit status control. `editingId` marks which card is expanded.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ matchDate: string; opponent: string; competition: string; venue: string; status: MatchStatus }>(
    { matchDate: '', opponent: '', competition: '', venue: '', status: 'SCHEDULED' }
  );

  function openForm() {
    setForm((f) => ({ ...f, competition: f.competition || '' }));
    setShowForm(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const opponent = form.opponent;
    const result = await createMatch.mutateAsync({ ...form, teamId: teamId! });
    if (isPendingApproval(result)) {
      setShowForm(false);
      setForm({ matchDate: '', opponent: '', competition: '', venue: '' });
      setPendingNotice(`Match vs ${opponent} submitted for the head coach's approval.`);
      return;
    }
    // Created immediately — start it (SCHEDULED → IN_PROGRESS) so tracking, which
    // is restricted to in-progress matches, can open.
    await updateMatch.mutateAsync({ id: result.id, data: { status: 'IN_PROGRESS' } });
    navigate(`/matches/${result.id}/track`);
  }

  // Pre-fill the inline edit form from the match's current values. The stored
  // ISO date is converted to the `datetime-local` input's expected shape.
  function openEdit(match: Match) {
    setEditingId(match.id);
    setEditForm({
      matchDate: toDateTimeLocal(match.matchDate),
      opponent: match.opponent,
      competition: match.competition ?? '',
      venue: match.venue ?? '',
      status: match.status,
    });
  }

  async function handleEditSubmit(e: React.FormEvent, id: string) {
    e.preventDefault();
    const opponent = editForm.opponent;
    const result = await updateMatch.mutateAsync({ id, data: editForm });
    if (isPendingApproval(result)) {
      setEditingId(null);
      setPendingNotice(`Changes to match vs ${opponent} submitted for the head coach's approval.`);
      return;
    }
    setEditingId(null);
  }

  // Begin a scheduled match, then open the live tracker.
  async function startAndTrack(id: string) {
    const res = await updateMatch.mutateAsync({ id, data: { status: 'IN_PROGRESS' } });
    if (isPendingApproval(res)) {
      setPendingNotice('Starting this match was submitted for the head coach approval.');
      return;
    }
    navigate(`/matches/${id}/track`);
  }

  return (
    <div className="space-y-6">
      <TeamSubNav teamId={teamId!} teamName={team?.name} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-grey-900">Matches</h1>
          <p className="text-grey-600 text-sm mt-0.5">{team?.name}</p>
        </div>
        {canManageMatches && (
          <button className={showForm ? 'btn-ghost' : 'btn-primary'} onClick={() => (showForm ? setShowForm(false) : openForm())}>
            {showForm ? 'Cancel' : '+ New match'}
          </button>
        )}
      </div>

      {pendingNotice && (
        <div className="card p-4 border border-gold-500/40 bg-gold-500/10 text-sm text-grey-900 flex items-center justify-between gap-3">
          <span>{pendingNotice}</span>
          <button className="text-grey-600 hover:text-grey-900 text-xs" onClick={() => setPendingNotice('')}>Dismiss</button>
        </div>
      )}

      {/* Filter bar */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-grey-600 mb-1">Opponent</label>
          <input className="input text-sm" placeholder="Search opponent…" value={filters.opponent} onChange={(e) => setFilters({ ...filters, opponent: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-grey-600 mb-1">Status</label>
          <select className="input text-sm" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {MATCH_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-grey-600 mb-1">From</label>
          <input type="date" className="input text-sm" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-grey-600 mb-1">To</label>
          <input type="date" className="input text-sm" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        {(filters.opponent || filters.status || filters.from || filters.to) && (
          <div className="sm:col-span-4">
            <button className="text-xs text-grey-600 hover:text-grey-900 transition-colors" onClick={() => setFilters({ opponent: '', status: '', from: '', to: '' })}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card p-5">
          <h2 className="font-display font-semibold text-grey-900 mb-4">New Match</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-grey-600 mb-1">Date & Time *</label>
              <input type="datetime-local" className="input" value={form.matchDate} onChange={(e) => setForm({ ...form, matchDate: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1">Opponent *</label>
              <input className="input" placeholder="e.g. Wellington Wolves" value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1">Competition</label>
              <input className="input" placeholder="e.g. National League" value={form.competition} onChange={(e) => setForm({ ...form, competition: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1">Venue</label>
              <input className="input" placeholder="e.g. Cowles Stadium" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary" disabled={createMatch.isPending}>
                {createMatch.isPending ? 'Creating…' : 'Create & Start Tracking'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Matches list */}
      {isLoading ? (
        <p className="text-grey-600 text-sm">Loading…</p>
      ) : matches?.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-grey-600">No matches yet — record your first match to unlock your stats.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches?.map((match) => (
            <div key={match.id} className="space-y-3">
            {/* The whole card opens the match's Stats page; the action buttons
                below stop propagation so they keep working independently. */}
            <div
              role="link"
              tabIndex={0}
              aria-label={`View stats for match vs ${match.opponent}`}
              onClick={() => navigate(`/matches/${match.id}/dashboard`)}
              onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') navigate(`/matches/${match.id}/dashboard`); }}
              className="card p-4 flex items-center gap-4 cursor-pointer transition-all hover:border-navy-500 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-grey-900">vs {match.opponent}</span>
                  <span className={`badge ${STATUS_STYLES[match.status]}`}>{match.status.replace('_', ' ')}</span>
                </div>
                <p className="text-grey-600 text-xs mt-0.5">
                  {formatMatchDate(match.matchDate, { dateStyle: 'long', timeStyle: 'short' })}
                  {match.venue && ` · ${match.venue}`}
                  {match.competition && ` · ${match.competition}`}
                </p>
              </div>

              {/* Every control here is an explicit h-9 so the text buttons and the
                  icon button resolve to the same 36px height and sit level. */}
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-2 justify-end">
                  <Link to={`/matches/${match.id}/dashboard`} className="btn-ghost text-sm px-3 h-9 inline-flex items-center">Stats</Link>
                  <Link to={`/matches/${match.id}/events`} className="btn-ghost text-sm px-3 h-9 inline-flex items-center">Events</Link>

                  {/* Live tracking: coaches/staff only, and only for a live or startable match. */}
                  {canTrack && match.status === 'IN_PROGRESS' && (
                    <Link to={`/matches/${match.id}/track`} className="btn-primary text-sm px-3 h-9 inline-flex items-center">Track</Link>
                  )}
                  {canTrack && match.status === 'SCHEDULED' && (
                    <button
                      className="btn-primary text-sm px-3 h-9 inline-flex items-center"
                      disabled={updateMatch.isPending}
                      onClick={() => startAndTrack(match.id)}
                    >
                      Start
                    </button>
                  )}
                  {/* Spectators get the read-only mirror of Track. The pulsing
                      dot matches MatchWatchPage's live indicator. */}
                  {!canTrack && match.status === 'IN_PROGRESS' && (
                    <Link
                      to={`/matches/${match.id}/watch`}
                      className="btn-primary text-sm px-3 h-9 inline-flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse" aria-hidden />
                      Watch
                    </Link>
                  )}

                  {canManageMatches && (
                    <button
                      className="btn-icon"
                      title="Edit match"
                      aria-label={`Edit match vs ${match.opponent}`}
                      onClick={() => (editingId === match.id ? setEditingId(null) : openEdit(match))}
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Inline edit form (Fix 4/5) — same fields/layout as New Match,
                pre-filled, plus an explicit Status control. */}
            {editingId === match.id && (
              <div className="card p-5">
                <h2 className="font-display font-semibold text-grey-900 mb-4">Edit Match</h2>
                <form onSubmit={(e) => handleEditSubmit(e, match.id)} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-grey-600 mb-1">Date & Time *</label>
                    <input type="datetime-local" className="input" value={editForm.matchDate} onChange={(e) => setEditForm({ ...editForm, matchDate: e.target.value })} required />
                  </div>
                  <div>
                    <label className="block text-xs text-grey-600 mb-1">Opponent *</label>
                    <input className="input" value={editForm.opponent} onChange={(e) => setEditForm({ ...editForm, opponent: e.target.value })} required />
                  </div>
                  <div>
                    <label className="block text-xs text-grey-600 mb-1">Competition</label>
                    <input className="input" value={editForm.competition} onChange={(e) => setEditForm({ ...editForm, competition: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-grey-600 mb-1">Venue</label>
                    <input className="input" value={editForm.venue} onChange={(e) => setEditForm({ ...editForm, venue: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-grey-600 mb-1">Status</label>
                    <select className="input" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value as MatchStatus })}>
                      {MATCH_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  {/* Delete sits opposite Save/Cancel — destructive and less
                      frequent, so it shouldn't read as equally weighted. */}
                  <div className="sm:col-span-2 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button type="submit" className="btn-primary" disabled={updateMatch.isPending}>
                        {updateMatch.isPending ? 'Saving…' : 'Save changes'}
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                    {canDeleteMatches && (
                      <button
                        type="button"
                        className="btn-danger"
                        aria-label={`Delete match vs ${match.opponent}`}
                        onClick={() => {
                          if (confirm(`Delete match vs ${match.opponent}? This cannot be undone.`)) {
                            deleteMatch.mutate({ id: match.id, teamId: teamId! });
                          }
                        }}
                      >
                        Delete match
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
