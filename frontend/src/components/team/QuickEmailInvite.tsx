import { useState } from 'react';
import { useCreateInvitation } from '../../hooks';
import type { TeamRole } from '../../types';
import { isPendingApproval } from '../../types';
import { getApiErrorMessage } from '../../lib/api';
import { ROLE_LABELS } from '../../lib/teamRoles';

// Compact single-row email invite, for nesting inside an already-open panel.
// Either a fixed `role` (no dropdown) or a constrained `roles` list.
type Props =
  | { teamId: string; role: TeamRole; roles?: undefined; defaultRole?: undefined }
  | { teamId: string; role?: undefined; roles: TeamRole[]; defaultRole: TeamRole };

function initialRole(props: Props): TeamRole {
  return props.role !== undefined ? props.role : props.defaultRole;
}

export default function QuickEmailInvite(props: Props) {
  const { teamId, roles } = props;
  const createInv = useCreateInvitation(teamId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>(initialRole(props));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    const addr = email.trim();
    try {
      const result = await createInv.mutateAsync({ email: addr, role });
      setEmail('');
      if (isPendingApproval(result)) {
        setNotice(`Invitation to ${addr} submitted for approval.`);
      } else if (result.emailSent) {
        setNotice(`Invitation sent to ${addr} — they'll receive a join code by email.`);
      } else {
        setNotice(`Invite created, but the email failed — share this code manually${result.joinCode ? `: ${result.joinCode}` : '.'}`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't send that invitation. Try again."));
    }
  }

  return (
    <form onSubmit={handleSend} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="input text-sm flex-1"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {roles ? (
          <select
            className="input text-sm w-auto shrink-0"
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            aria-label="Invite role"
          >
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        ) : (
          <span className="text-xs text-grey-600 shrink-0">as {ROLE_LABELS[role]}</span>
        )}
        <button type="submit" className="btn-primary text-sm px-3 py-1.5 shrink-0" disabled={createInv.isPending}>
          {createInv.isPending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {error && <p className="text-error text-xs">{error}</p>}
      {notice && (
        <p className="text-xs text-grey-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" className="text-grey-500 hover:text-grey-900 shrink-0" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      )}
    </form>
  );
}
