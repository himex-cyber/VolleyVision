import { useState } from 'react';
import {
  useTeamMembers, useAddMember, useUpdateMemberRole, useUpdateMemberAccess,
  useRemoveMember, useUserSearch, useTeamRole, useHasPermission,
} from '../../hooks';
import type { TeamRole, TeamMember, AccessTier, AccessCategory } from '../../types';
import { ROLE_OPTIONS, ROLE_LABELS, ROLE_BADGE, TIER_OPTIONS, ACCESS_CATEGORIES } from '../../lib/teamRoles';
import { useAuth } from '../../context/AuthContext';
import { ChevronIcon, PencilIcon } from '../ui/icons';
import TeamJoinCodes from './TeamJoinCodes';
import QuickEmailInvite from './QuickEmailInvite';

interface Props {
  teamId: string;
  ownerId?: string | null;
}

export default function TeamMembersCard({ teamId }: Props) {
  const { data: members, isLoading } = useTeamMembers(teamId);
  const addMember       = useAddMember(teamId);
  const updateRole      = useUpdateMemberRole(teamId);
  const updateAccess    = useUpdateMemberAccess(teamId);
  const removeMember    = useRemoveMember(teamId);
  const { data: roleInfo } = useTeamRole(teamId);
  const { user } = useAuth();

  const canManage = roleInfo?.permissions.includes('MANAGE_MEMBERS') ?? false;
  // Managing members doesn't imply invitation access — the join-codes route
  // 403s without it, so the inline invite block is gated separately.
  const canInvite = useHasPermission(teamId, 'INVITE_USERS');

  const [showAdd, setShowAdd]     = useState(false);
  const [searchQ, setSearchQ]     = useState('');
  const [addRole, setAddRole]     = useState<TeamRole>('PLAYER');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addError, setAddError]   = useState('');

  const { data: searchResults } = useUserSearch(searchQ);

  async function handleAdd() {
    setAddError('');
    if (!selectedUserId) { setAddError('Select a user first.'); return; }
    try {
      await addMember.mutateAsync({ userId: selectedUserId, role: addRole });
      setShowAdd(false);
      setSearchQ('');
      setSelectedUserId('');
    } catch (err: any) {
      setAddError(err?.response?.data?.error ?? "Couldn't add that member. Try again.");
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
        <h2 className="font-semibold text-grey-900">Team Members</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-grey-600 tabular-nums">{members?.length ?? 0} members</span>
          {canManage && (
            <button
              className={`${showAdd ? 'btn-ghost' : 'btn-primary'} text-sm px-3 py-1.5`}
              onClick={() => setShowAdd(!showAdd)}
            >
              {showAdd ? 'Cancel' : '+ Add member'}
            </button>
          )}
        </div>
      </div>

      {/* Add member panel */}
      {showAdd && canManage && (
        <div className="px-5 py-4 border-b border-grey-200 bg-grey-50 space-y-3">
          <div className="space-y-2">
            <label className="block text-xs text-grey-600 font-medium">Search user</label>
            <input
              className="input text-sm"
              placeholder="Their full email address…"
              value={searchQ}
              onChange={(e) => { setSearchQ(e.target.value); setSelectedUserId(''); }}
            />
            {searchResults && searchResults.length > 0 && !selectedUserId && (
              <div className="bg-white border border-grey-200 rounded-xl overflow-hidden">
                {searchResults.map((u) => (
                  <button
                    key={u.id}
                    className="w-full text-left px-4 py-2.5 hover:bg-grey-50 transition-colors border-b border-grey-200 last:border-0"
                    onClick={() => { setSelectedUserId(u.id); setSearchQ(`${u.firstName} ${u.lastName} — ${u.email}`); }}
                  >
                    <span className="text-grey-900 text-sm font-medium">{u.firstName} {u.lastName}</span>
                    <span className="text-grey-600 text-xs ml-2">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
            {searchQ.includes('@') && searchResults?.length === 0 && !selectedUserId && (
              <p className="text-grey-600 text-xs px-1">
                No account uses that email — invite them instead.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-grey-600 font-medium">Role</label>
            <select
              className="input text-sm"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as TeamRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {addError && <p className="text-error text-xs">{addError}</p>}

          <button className="btn-primary text-sm" onClick={handleAdd} disabled={addMember.isPending || !selectedUserId}>
            {addMember.isPending ? 'Adding…' : 'Add member'}
          </button>

          {/* The search above only finds people who already have an account. */}
          {canInvite && (
            <div className="border-t border-grey-200 pt-4 mt-1 space-y-2">
              <p className="text-xs text-grey-600">
                Inviting someone who doesn't have an account yet? Share the staff code, or send an email invite:
              </p>
              <TeamJoinCodes teamId={teamId} only="STAFF" />
              <QuickEmailInvite
                teamId={teamId}
                roles={['ASSISTANT_COACH', 'MANAGER', 'STATISTICIAN']}
                defaultRole="ASSISTANT_COACH"
              />
            </div>
          )}
        </div>
      )}

      {/* Members list */}
      {isLoading ? (
        <p className="text-grey-600 text-sm p-5">Loading members…</p>
      ) : !members?.length ? (
        <p className="text-grey-600 text-sm p-5 italic">No members yet.</p>
      ) : (
        <div className="divide-y divide-grey-200">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              canManage={canManage}
              isSelf={m.user.id === user?.id}
              onRoleChange={(role) => updateRole.mutate({ memberId: m.id, role })}
              onAccessChange={(category, tier) =>
                updateAccess.mutate({ memberId: m.id, tiers: { [category]: tier } })}
              onRemove={() => {
                if (confirm(`Remove ${m.user.firstName} ${m.user.lastName} from the team?`)) {
                  removeMember.mutate(m.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface MemberRowProps {
  member: TeamMember;
  canManage: boolean;
  isSelf: boolean;
  onRoleChange: (role: TeamRole) => void;
  onAccessChange: (category: AccessCategory, tier: AccessTier) => void;
  onRemove: () => void;
}

function MemberRow({ member, canManage, isSelf, onRoleChange, onAccessChange, onRemove }: MemberRowProps) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<TeamRole>(member.role);

  function saveRole() {
    onRoleChange(role);
    setEditing(false);
  }

  // Access tiers are only meaningful for staff roles (players/viewers can't
  // perform these actions), and a coach can't edit their own tiers.
  const showTiers = canManage && !isSelf && member.role !== 'PLAYER' && member.role !== 'VIEWER';

  return (
    <div>
      {/* ── Summary row — always visible ── */}
      <div className={`px-5 py-3 flex items-center gap-4 ${editing ? 'bg-grey-50' : ''}`}>
        <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center font-bold text-sm text-navy-700 shrink-0">
          {member.user.firstName[0]}{member.user.lastName[0]}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-grey-900 truncate">
            {member.user.firstName} {member.user.lastName}
            {isSelf && <span className="text-grey-400 font-normal text-xs ml-1.5">(you)</span>}
          </p>
          <p className="text-grey-600 text-xs truncate">{member.user.email}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`badge ${ROLE_BADGE[member.role]} text-sm px-2.5 py-1`}>{ROLE_LABELS[member.role]}</span>
          {canManage && !isSelf && (
            <>
              <button
                className="btn-icon w-14 h-14"
                title="Change role"
                aria-label="Change role"
                aria-expanded={editing}
                onClick={() => {
                  if (editing) { setEditing(false); setRole(member.role); }
                  else setEditing(true);
                }}
              >
                <PencilIcon className="w-6 h-6" />
              </button>
              <ChevronIcon
                className={`w-5 h-5 shrink-0 text-grey-600 transition-transform ${editing ? 'rotate-90' : ''}`}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Edit panel ── */}
      {editing && (
        <div className="px-5 py-4 bg-grey-50 border-t border-grey-200 space-y-3">
          <div>
            <label className="block text-xs text-grey-600 mb-1">Role</label>
            <select
              className="input text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Per-member access tiers. These save immediately on change — they're
              not part of the Save Changes batch below. */}
          {showTiers && (
            <div className="pt-3 border-t border-grey-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ACCESS_CATEGORIES.map((cat) => (
                <label key={cat.key} className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-grey-600" title={cat.hint}>
                    {cat.label}
                  </span>
                  <select
                    className="input text-xs py-1.5"
                    value={member[cat.key]}
                    onChange={(e) => onAccessChange(cat.key, e.target.value as AccessTier)}
                  >
                    {TIER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <button className="btn-primary text-sm px-3 py-1.5" onClick={saveRole}>Save Changes</button>
              <button
                className="btn-ghost text-sm px-3 py-1.5"
                onClick={() => { setEditing(false); setRole(member.role); }}
              >
                Cancel
              </button>
            </div>
            <button className="btn-danger text-sm px-3 py-1.5" onClick={onRemove}>
              Remove member
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
