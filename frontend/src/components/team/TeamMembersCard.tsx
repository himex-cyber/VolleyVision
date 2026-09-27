import { useState } from 'react';
import {
  useTeamMembers, useUpdateMemberRole, useUpdateMemberAccess,
  useRemoveMember, useTeamRole, useHasPermission,
} from '../../hooks';
import type { TeamRole, TeamMember, AccessTier, AccessCategory } from '../../types';
import { ROLE_LABELS, ROLE_BADGE, TIER_OPTIONS, ACCESS_CATEGORIES, invitableRoleOptions } from '../../lib/teamRoles';
import { getApiErrorMessage } from '../../lib/api';
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
  const updateRole      = useUpdateMemberRole(teamId);
  const updateAccess    = useUpdateMemberAccess(teamId);
  const removeMember    = useRemoveMember(teamId);
  const { data: roleInfo } = useTeamRole(teamId);
  const { user } = useAuth();

  const canManage = roleInfo?.permissions.includes('MANAGE_MEMBERS') ?? false;
  // Managing members doesn't imply invitation access — the join-codes route
  // 403s without it, so the inline invite block is gated separately.
  const canInvite = useHasPermission(teamId, 'INVITE_USERS');

  // People join only by accepting an invite or redeeming a code — there is no
  // way to put someone on a team without their consent.
  const [showInvite, setShowInvite] = useState(false);

  // A team may have at most 2 assistant coaches (backend-enforced, 409 if
  // violated) — tracked here so the role picker can disable the option before
  // the round-trip. Keyed by memberId so only the row that failed shows it.
  const [roleError, setRoleError] = useState<{ id: string; message: string } | null>(null);
  const assistantCoachCount = members?.filter((m) => m.role === 'ASSISTANT_COACH').length ?? 0;

  // UX filter mirroring the backend's canInviteRole — the viewer's own role
  // (owner already resolves to HEAD_COACH via roleInfo) caps which roles they
  // may offer, so e.g. an assistant coach never sees MANAGER in the picker.
  const invitableRoles = invitableRoleOptions(roleInfo?.role);
  const staffInviteRoles = invitableRoles
    .map((r) => r.value)
    .filter((r) => r === 'ASSISTANT_COACH' || r === 'MANAGER' || r === 'STATISTICIAN');

  async function handleRoleChange(memberId: string, role: TeamRole): Promise<boolean> {
    setRoleError(null);
    try {
      await updateRole.mutateAsync({ memberId, role });
      return true;
    } catch (err) {
      setRoleError({ id: memberId, message: getApiErrorMessage(err, "Couldn't change role. Try again.") });
      return false;
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
        <h2 className="font-semibold text-grey-900">Team Members</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-grey-600 tabular-nums">{members?.length ?? 0} members</span>
          {canInvite && staffInviteRoles.length > 0 && (
            <button
              className={`${showInvite ? 'btn-ghost' : 'btn-primary'} text-sm px-3 py-1.5`}
              onClick={() => setShowInvite(!showInvite)}
            >
              {showInvite ? 'Cancel' : '+ Invite staff'}
            </button>
          )}
        </div>
      </div>

      {showInvite && canInvite && staffInviteRoles.length > 0 && (
        <div className="px-5 py-4 border-b border-grey-200 bg-grey-50 space-y-2">
          <p className="text-xs text-grey-600">Invite staff by email. Staff who can see the staff code can share it too.</p>
          <TeamJoinCodes teamId={teamId} only="STAFF" />
          <QuickEmailInvite
            teamId={teamId}
            roles={staffInviteRoles}
            defaultRole={staffInviteRoles.includes('ASSISTANT_COACH') ? 'ASSISTANT_COACH' : staffInviteRoles[0]}
          />
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
              roleOptions={invitableRoles}
              isSelf={m.user.id === user?.id}
              // Other members already holding ASSISTANT_COACH — excludes this
              // row itself, so a current assistant coach can still be re-saved.
              otherAssistantCoachCount={m.role === 'ASSISTANT_COACH' ? assistantCoachCount - 1 : assistantCoachCount}
              roleError={roleError?.id === m.id ? roleError.message : null}
              onRoleChange={(role) => handleRoleChange(m.id, role)}
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
  roleOptions: { value: TeamRole; label: string }[];
  isSelf: boolean;
  otherAssistantCoachCount: number;
  roleError: string | null;
  onRoleChange: (role: TeamRole) => Promise<boolean>;
  onAccessChange: (category: AccessCategory, tier: AccessTier) => void;
  onRemove: () => void;
}

function MemberRow({
  member, canManage, roleOptions, isSelf, otherAssistantCoachCount, roleError, onRoleChange, onAccessChange, onRemove,
}: MemberRowProps) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<TeamRole>(member.role);
  const [saving, setSaving] = useState(false);

  async function saveRole() {
    setSaving(true);
    const ok = await onRoleChange(role);
    setSaving(false);
    if (ok) setEditing(false);
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
          {member.user.email && <p className="text-grey-600 text-xs truncate">{member.user.email}</p>}
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
              {/* Include the member's current role even if the viewer couldn't
                  newly assign it, so an existing MANAGER doesn't just vanish
                  from an assistant coach's picker (they can still re-save it,
                  or lower it, but never raise it — server re-checks either way). */}
              {(roleOptions.some((r) => r.value === member.role)
                ? roleOptions
                : [...roleOptions, { value: member.role, label: ROLE_LABELS[member.role] }]
              ).map((r) => {
                // At most 2 assistant coaches per team (409 from the backend
                // otherwise) — disable before the round-trip once full, unless
                // this member already holds the role (re-saving is a no-op).
                const full = r.value === 'ASSISTANT_COACH' && otherAssistantCoachCount >= 2 && member.role !== 'ASSISTANT_COACH';
                return (
                  <option key={r.value} value={r.value} disabled={full}>
                    {r.label}{full ? ' (2 max — full)' : ''}
                  </option>
                );
              })}
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

          {roleError && <p className="text-error text-xs">{roleError}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <button className="btn-primary text-sm px-3 py-1.5" onClick={saveRole} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
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
