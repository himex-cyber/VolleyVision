import { useState } from 'react';
import {
  useMyInvitations, useAcceptInvitation, useDeclineInvitation,
  useMyTeams, useMyMemberships, useTeamInvitations, useCreateInvitation, useHasPermission,
} from '../hooks';
import type { Invitation, TeamRole } from '../types';
import { isPendingApproval } from '../types';
import { ROLE_LABELS, ROLE_BADGE, ROLE_OPTIONS } from '../lib/teamRoles';
import { isEmailNotVerifiedError } from '../lib/api';
import JoinByCodeCard from '../components/team/JoinByCodeCard';
import TeamJoinCodes from '../components/team/TeamJoinCodes';
import ResendVerificationNotice from '../components/ui/ResendVerificationNotice';

const COACH_ROLES: TeamRole[] = ['HEAD_COACH', 'MANAGER', 'ASSISTANT_COACH', 'STATISTICIAN'];

const STATUS_BADGE: Record<Invitation['status'], string> = {
  PENDING: 'badge-accent',
  ACCEPTED: 'badge-success',
  DECLINED: 'badge-error',
  EXPIRED: 'badge-neutral',
};

function daysLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ── Received (player) ─────────────────────────────────────────────────────────
function InvitationCard({ inv }: { inv: Invitation }) {
  const accept  = useAcceptInvitation();
  const decline = useDeclineInvitation();

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-grey-900 text-base">{inv.team?.name}</p>
          <p className="text-grey-500 text-xs mt-0.5">{inv.team?.division} · Season {inv.team?.season}</p>
          <p className="text-grey-600 text-sm mt-2">
            Invited by <span className="text-grey-900 font-medium">{inv.invitedBy?.firstName} {inv.invitedBy?.lastName}</span>
          </p>
        </div>
        <span className={`badge shrink-0 mt-0.5 ${ROLE_BADGE[inv.role]}`}>{ROLE_LABELS[inv.role]}</span>
      </div>

      <p className="text-grey-500 text-xs">
        Expires in {daysLeft(inv.expiresAt)} day{daysLeft(inv.expiresAt) !== 1 ? 's' : ''}
      </p>

      {accept.isError && (
        isEmailNotVerifiedError(accept.error) ? (
          <ResendVerificationNotice />
        ) : (
          <p className="text-error text-xs">{(accept.error as any)?.response?.data?.error ?? "Couldn't accept that invitation."}</p>
        )
      )}
      {decline.isError && <p className="text-error text-xs">{(decline.error as any)?.response?.data?.error ?? "Couldn't decline that invitation."}</p>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1 text-sm py-2" disabled={accept.isPending} onClick={() => accept.mutate(inv.token)}>
          {accept.isPending ? 'Accepting…' : 'Accept'}
        </button>
        <button className="btn-secondary flex-1 text-sm py-2" disabled={decline.isPending} onClick={() => decline.mutate(inv.token)}>
          {decline.isPending ? 'Declining…' : 'Decline'}
        </button>
      </div>
    </div>
  );
}

// ── Sent (coach) — for a single selected team ─────────────────────────────────
function TeamSentInvitations({ teamId }: { teamId: string }) {
  const { data: invitations, isLoading } = useTeamInvitations(teamId);
  const createInv = useCreateInvitation(teamId);
  const canInvite = useHasPermission(teamId, 'INVITE_USERS');

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('PLAYER');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    const addr = email.trim();
    try {
      const result = await createInv.mutateAsync({ email: addr, role });
      setEmail(''); setRole('PLAYER'); setShowForm(false);
      if (isPendingApproval(result)) {
        setNotice(`Invitation to ${addr} submitted for approval.`);
      } else if (result.emailSent) {
        setNotice(`Invitation sent to ${addr} — they'll receive a join code by email.`);
      } else {
        setNotice(`Invite created, but the email failed — share this code manually${result.joinCode ? `: ${result.joinCode}` : '.'}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Couldn't send that invitation. Try again.");
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
        <span className="text-xs text-grey-600 tabular-nums">
          {invitations?.filter((i) => i.status === 'PENDING').length ?? 0} pending
        </span>
        {canInvite && (
          <button className="btn-primary text-xs px-3 py-1.5" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Invite'}
          </button>
        )}
      </div>

      {canInvite && <TeamJoinCodes teamId={teamId} />}

      {showForm && canInvite && (
        <form onSubmit={handleCreate} className="px-5 py-4 border-b border-grey-200 bg-grey-50 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-grey-600 font-medium mb-1">Email address</label>
              <input className="input text-sm" type="email" placeholder="player@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-grey-600 font-medium mb-1">Role</label>
              <select className="input text-sm" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-error text-xs">{error}</p>}
          <button type="submit" className="btn-primary text-sm" disabled={createInv.isPending}>
            {createInv.isPending ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      )}

      {notice && (
        <div className="px-5 py-3 border-b border-grey-200 text-sm text-grey-900 bg-gold-500/10 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button className="text-grey-500 hover:text-grey-900 text-xs" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {isLoading ? (
        <p className="text-grey-600 text-sm p-5">Loading…</p>
      ) : !invitations?.length ? (
        <p className="text-grey-600 text-sm p-5">No invitations sent yet.</p>
      ) : (
        <div className="divide-y divide-grey-200">
          {invitations.map((inv) => (
            <div key={inv.id} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-grey-900 text-sm font-medium truncate">{inv.email}</p>
                <p className="text-grey-500 text-xs">
                  {ROLE_LABELS[inv.role]} · {new Date(inv.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`badge ${STATUS_BADGE[inv.status]}`}>
                {inv.status.charAt(0) + inv.status.slice(1).toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SentByYourTeams() {
  const { data: owned } = useMyTeams();
  const { data: memberships } = useMyMemberships();

  const ownedIds = new Set(owned?.map((t) => t.id) ?? []);
  const teams = [
    ...(owned ?? []).map((t) => ({ id: t.id, name: t.name })),
    ...(memberships ?? [])
      .filter((m) => COACH_ROLES.includes(m.role) && !ownedIds.has(m.team.id))
      .map((m) => ({ id: m.team.id, name: m.team.name })),
  ];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (teams.length === 0) return null;

  const activeId = selectedId ?? teams[0].id;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-grey-600">Sent by your teams</h2>
      {teams.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                t.id === activeId ? 'bg-navy-100 text-navy-700' : 'text-grey-600 hover:bg-grey-50'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <TeamSentInvitations key={activeId} teamId={activeId} />
    </section>
  );
}

export default function InvitationsPage() {
  const { data: invitations, isLoading } = useMyInvitations();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display font-bold text-2xl text-grey-900">Invitations</h1>
        <p className="text-grey-600 text-sm mt-0.5">Accept invitations sent to you, and manage invitations sent by your teams</p>
      </div>

      {/* Self-serve join by code */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-grey-600">Join a team</h2>
        <JoinByCodeCard />
      </section>

      {/* Received */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-grey-600">Invitations for you</h2>
        {isLoading ? (
          <p className="text-grey-600 text-sm">Loading invitations…</p>
        ) : !invitations?.length ? (
          <div className="card p-8 text-center">
            <p className="text-grey-900 font-medium">No pending invitations</p>
            <p className="text-grey-600 text-sm mt-1">When a coach invites you to a team it will appear here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {invitations.map((inv) => <InvitationCard key={inv.id} inv={inv} />)}
          </div>
        )}
      </section>

      {/* Sent (coach/manager) */}
      <SentByYourTeams />
    </div>
  );
}
