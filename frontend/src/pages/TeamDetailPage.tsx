import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTeam, useCreatePlayer, useDeletePlayer, useUpdatePlayer, useTransferOwnership, useHasPermission, useApprovalRequests, useApproveRequest, useRejectRequest } from '../hooks';
import type { Position, ApprovalRequest } from '../types';
import { POSITION_FULL_LABELS, POSITION_BADGE, isPendingApproval } from '../types';
import { useAuth } from '../context/AuthContext';
import TeamMembersCard from '../components/team/TeamMembersCard';
import PermissionGuard from '../components/ui/PermissionGuard';
import PlayerTeamLinksCard from '../components/team/PlayerTeamLinksCard';
import TeamJoinCodes from '../components/team/TeamJoinCodes';
import QuickEmailInvite from '../components/team/QuickEmailInvite';
import TeamSubNav from '../components/ui/TeamSubNav';
import { ChevronIcon, PencilIcon } from '../components/ui/icons';

const POSITIONS: Position[] = [
  'SETTER',
  'OUTSIDE_HITTER',
  'OPPOSITE',
  'MIDDLE_BLOCKER',
  'LIBERO',
  'DEFENSIVE_SPECIALIST',
];

// ── Approval queue (Stabilization Pass 2) ────────────────────────────────────
// Head coach / owner reviews structural changes submitted by other staff.
const APPROVAL_LABELS: Record<ApprovalRequest['action'], string> = {
  PLAYER_CREATE: 'Add player',
  PLAYER_UPDATE: 'Edit player',
  PLAYER_DELETE: 'Remove player',
  MATCH_CREATE: 'Create match',
  MATCH_UPDATE: 'Edit match',
  MATCH_DELETE: 'Delete match',
  INVITATION_CREATE: 'Send invitation',
};

function describeApproval(req: ApprovalRequest): string {
  const p = req.payload as Record<string, unknown>;
  switch (req.action) {
    case 'PLAYER_CREATE':
      return `#${p.jerseyNumber} ${p.firstName} ${p.lastName}`;
    case 'MATCH_CREATE':
      return `vs ${p.opponent}`;
    case 'INVITATION_CREATE':
      return `${p.email} as ${String(p.role).replace(/_/g, ' ').toLowerCase()}`;
    default:
      return '';
  }
}

function ApprovalQueueCard({ teamId }: { teamId: string }) {
  const { data: requests, isLoading } = useApprovalRequests(teamId, 'PENDING');
  const approve = useApproveRequest(teamId);
  const reject = useRejectRequest(teamId);

  if (isLoading || !requests || requests.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
        <h2 className="font-semibold text-grey-900">Pending approval</h2>
        <span className="badge badge-accent">{requests.length}</span>
      </div>
      <div className="divide-y divide-grey-200">
        {requests.map((req) => (
          <div key={req.id} className="px-5 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-grey-900">
                <span className="font-medium">{APPROVAL_LABELS[req.action]}</span>
                {describeApproval(req) && <span className="text-grey-600"> · {describeApproval(req)}</span>}
              </p>
              <p className="text-xs text-grey-600 mt-0.5">
                Requested by {req.requestedBy.firstName} {req.requestedBy.lastName} ·{' '}
                {new Date(req.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                className="btn-ghost text-sm px-3 py-1.5"
                disabled={reject.isPending}
                onClick={() => reject.mutate(req.id)}
              >
                Reject
              </button>
              <button
                className="btn-primary text-sm px-3 py-1.5"
                disabled={approve.isPending}
                onClick={() => approve.mutate(req.id)}
              >
                Approve
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { data: team, isLoading } = useTeam(teamId!);
  const { user } = useAuth();
  const createPlayer = useCreatePlayer();
  const deletePlayer = useDeletePlayer();
  const updatePlayer = useUpdatePlayer(teamId!);
  const transferOwnership = useTransferOwnership();
  const canManageTeam = useHasPermission(teamId!, 'MANAGE_TEAM');
  // Roster access doesn't imply invitation access — the join-codes route 403s
  // without it, so the inline invite block is gated separately.
  const canInvite = useHasPermission(teamId!, 'INVITE_USERS');

  const [showTransfer, setShowTransfer] = useState(false);
  const [transferEmail, setTransferEmail] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [pendingNotice, setPendingNotice] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    jerseyNumber: '',
    position: 'SETTER' as Position,
  });

  // Per-player edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    jerseyNumber: '',
    position: 'SETTER' as Position,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const playerName = `${form.firstName} ${form.lastName}`.trim();
    const result = await createPlayer.mutateAsync({
      ...form,
      jerseyNumber: Number(form.jerseyNumber),
      teamId: teamId!,
    });
    setForm({ firstName: '', lastName: '', jerseyNumber: '', position: 'SETTER' });
    setShowForm(false);
    // Non-head-coach adds are queued rather than applied — reflect that instead
    // of implying the player is already on the roster.
    setPendingNotice(
      isPendingApproval(result)
        ? `${playerName} submitted for the head coach's approval.`
        : '',
    );
  }

  function startEdit(player: { id: string; firstName: string; lastName: string; jerseyNumber: number; position: Position }) {
    setEditingId(player.id);
    setEditForm({
      firstName: player.firstName,
      lastName: player.lastName,
      jerseyNumber: String(player.jerseyNumber),
      position: player.position,
    });
  }

  async function handleUpdate(e: React.FormEvent, id: string) {
    e.preventDefault();
    await updatePlayer.mutateAsync({
      id,
      data: {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        jerseyNumber: Number(editForm.jerseyNumber),
        position: editForm.position,
      },
    });
    setEditingId(null);
  }

  if (isLoading) return <p className="text-grey-600">Loading…</p>;
  if (!team) return <p className="text-grey-600">Team not found.</p>;

  return (
    <div className="space-y-6">
      <TeamSubNav teamId={team.id} teamName={team.name} />
      <div>
        <h1 className="text-2xl font-bold text-grey-900">{team.name}</h1>
        <p className="text-grey-600 text-sm mt-0.5">{team.division ? `${team.division} · ` : ''}Season {team.season}</p>
      </div>

      {/* Pending-approval confirmation after a queued action */}
      {pendingNotice && (
        <div className="card p-4 border border-gold-500/30 bg-gold-500/10 text-sm text-grey-900 flex items-center justify-between gap-3">
          <span>{pendingNotice}</span>
          <button className="text-grey-500 hover:text-grey-900 text-xs" onClick={() => setPendingNotice('')}>Dismiss</button>
        </div>
      )}

      {/* Approval queue — head coach / owner only */}
      {canManageTeam && <ApprovalQueueCard teamId={teamId!} />}

      {/* Ownership card */}
      <div className="card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-grey-600 font-semibold mb-1">Owner</p>
            {team.owner && (
              <p className="text-grey-900 font-medium">
                {team.owner.firstName} {team.owner.lastName}
                <span className="text-grey-600 font-normal ml-2 text-sm">{team.owner.email}</span>
              </p>
            )}
          </div>

          <div className="flex gap-2 shrink-0">
            {/* Transfer — only user with TRANSFER_OWNERSHIP permission */}
            <PermissionGuard teamId={teamId!} permission="TRANSFER_OWNERSHIP">
              {team.owner && (
                <button
                  className="btn-secondary text-sm"
                  onClick={() => setShowTransfer(!showTransfer)}
                >
                  Transfer
                </button>
              )}
            </PermissionGuard>
          </div>
        </div>

        {/* Transfer form */}
        {showTransfer && team.owner && (
          <form
            className="mt-4 pt-4 border-t border-grey-200 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!transferEmail.trim()) return;
              // The backend resolves the email against this team's members, so the
              // coach never has to know the new owner's internal id.
              await transferOwnership.mutateAsync({ teamId: team.id, newOwnerEmail: transferEmail.trim() });
              setShowTransfer(false);
              setTransferEmail('');
            }}
          >
            <input
              className="input flex-1 text-sm"
              type="email"
              placeholder="New owner's email (must already be a team member)"
              value={transferEmail}
              onChange={(e) => setTransferEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary text-sm" disabled={transferOwnership.isPending}>
              {transferOwnership.isPending ? 'Transferring…' : 'Confirm'}
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setShowTransfer(false)}>
              Cancel
            </button>
          </form>
        )}

        {transferOwnership.isError && (
          <p className="mt-2 text-error text-sm">
            {(transferOwnership.error as any)?.response?.data?.error ?? "Couldn't transfer ownership. Try again."}
          </p>
        )}
      </div>

      {/* Members */}
      <TeamMembersCard teamId={teamId!} ownerId={team.ownerId} />

      {/* Roster — the add-player control lives in this card's own header (Task 10) */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
          <h2 className="font-semibold text-grey-900">Roster</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-grey-600 tabular-nums">{team.players?.length ?? 0} players</span>
            <PermissionGuard teamId={teamId!} permission="MANAGE_ROSTER">
              <button
                className={`${showForm ? 'btn-ghost' : 'btn-primary'} text-sm px-3 py-1.5`}
                onClick={() => setShowForm(!showForm)}
              >
                {showForm ? 'Cancel' : '+ Add player'}
              </button>
            </PermissionGuard>
          </div>
        </div>

        {/* Add-player form */}
        {showForm && user && (
          <div className="px-5 py-4 border-b border-grey-200 bg-grey-50">
          <form onSubmit={handleCreate} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-grey-600 mb-1">First Name *</label>
              <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1">Last Name *</label>
              <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1"># Jersey *</label>
              <input className="input" type="number" min="0" max="99" value={form.jerseyNumber} onChange={(e) => setForm({ ...form, jerseyNumber: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 mb-1">Position *</label>
              <select className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value as Position })}>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>{POSITION_FULL_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <button type="submit" className="btn-primary" disabled={createPlayer.isPending}>
                {createPlayer.isPending ? 'Adding…' : 'Add Player'}
              </button>
            </div>
          </form>

          {/* The form above only creates a stat-tracking row — no account. This
              invites a real person who can log in and track their own stats. */}
          {canInvite && (
            <div className="border-t border-grey-200 pt-4 mt-4 space-y-2">
              <p className="text-xs text-grey-600">
                Inviting a player to log in and track their own stats? Share the player code, or send an email invite:
              </p>
              <TeamJoinCodes teamId={teamId!} only="PLAYER" />
              <QuickEmailInvite teamId={teamId!} role="PLAYER" />
            </div>
          )}
          </div>
        )}

        {!team.players?.length ? (
          <p className="text-grey-600 text-sm p-5">No players yet — add your roster to start tracking.</p>
        ) : (
          <div className="divide-y divide-grey-200">
            {team.players?.map((player) => {
              const isEditing = editingId === player.id;
              const playerName = `${player.firstName} ${player.lastName}`;

              return (
                <div key={player.id}>
                  {/* ── Summary row — always visible, navigates to the player's dashboard ── */}
                  <div
                    role="button"
                    tabIndex={0}
                    className={`px-5 py-3 flex items-center gap-4 cursor-pointer transition-colors
                                hover:bg-grey-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500
                                ${isEditing ? 'bg-grey-50' : ''}`}
                    onClick={() => navigate(`/players/${player.id}/dashboard`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/players/${player.id}/dashboard`);
                      }
                    }}
                  >
                    {/* Jersey-number avatar. There's no player-photo field in
                        the data model, so this placeholder carries the whole
                        identity of the row — it reads as an avatar, not an icon. */}
                    <div className="w-14 h-14 shrink-0 rounded-full bg-navy-100 border-2 border-navy-500
                                    grid place-items-center font-display font-bold text-navy-700 text-xl tabular-nums">
                      {player.jerseyNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-grey-900 truncate">{playerName}</p>
                    </div>
                    <span className={`badge ${POSITION_BADGE[player.position]} text-sm px-2.5 py-1`}>
                      {POSITION_FULL_LABELS[player.position]}
                    </span>
                    <PermissionGuard teamId={teamId!} permission="MANAGE_TEAM">
                      <button
                        className="btn-icon w-14 h-14"
                        title="Edit player"
                        aria-label={`Edit ${playerName}`}
                        aria-expanded={isEditing}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isEditing) setEditingId(null);
                          else startEdit(player);
                        }}
                      >
                        <PencilIcon className="w-6 h-6" />
                      </button>
                      <ChevronIcon
                        className={`w-5 h-5 shrink-0 text-grey-600 transition-transform ${isEditing ? 'rotate-90' : ''}`}
                      />
                    </PermissionGuard>
                  </div>

                  {/* ── Edit panel — outside the clickable row, so nothing here navigates ── */}
                  {isEditing && (
                    <div className="px-5 py-4 bg-grey-50 border-t border-grey-200 space-y-3">
                      <form
                        onSubmit={(e) => handleUpdate(e, player.id)}
                        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                      >
                        <div>
                          <label className="block text-xs text-grey-600 mb-1">First Name</label>
                          <input
                            className="input text-sm"
                            value={editForm.firstName}
                            onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-grey-600 mb-1">Last Name</label>
                          <input
                            className="input text-sm"
                            value={editForm.lastName}
                            onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-grey-600 mb-1"># Jersey</label>
                          <input
                            className="input text-sm"
                            type="number"
                            min="0"
                            max="99"
                            value={editForm.jerseyNumber}
                            onChange={(e) => setEditForm({ ...editForm, jerseyNumber: e.target.value })}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-grey-600 mb-1">Position</label>
                          <select
                            className="input text-sm"
                            value={editForm.position}
                            onChange={(e) => setEditForm({ ...editForm, position: e.target.value as Position })}
                          >
                            {POSITIONS.map((p) => (
                              <option key={p} value={p}>{POSITION_FULL_LABELS[p]}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2 sm:col-span-4 flex items-center justify-between gap-2">
                          <div className="flex gap-2">
                            <button type="submit" className="btn-primary text-sm px-3 py-1.5" disabled={updatePlayer.isPending}>
                              {updatePlayer.isPending ? 'Saving…' : 'Save Changes'}
                            </button>
                            <button type="button" className="btn-ghost text-sm px-3 py-1.5" onClick={() => setEditingId(null)}>
                              Cancel
                            </button>
                          </div>
                          <PermissionGuard teamId={teamId!} permission="MANAGE_TEAM">
                            <button
                              type="button"
                              className="btn-danger text-sm px-3 py-1.5"
                              onClick={() => {
                                if (confirm(`Remove ${playerName}?`)) {
                                  deletePlayer.mutate({ id: player.id, teamId: teamId! });
                                }
                              }}
                            >
                              Delete player
                            </button>
                          </PermissionGuard>
                        </div>
                      </form>

                      <PermissionGuard teamId={teamId!} permission="MANAGE_TEAM">
                        <PlayerTeamLinksCard
                          playerId={player.id}
                          homeTeamId={player.teamId}
                          playerName={playerName}
                        />
                      </PermissionGuard>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
