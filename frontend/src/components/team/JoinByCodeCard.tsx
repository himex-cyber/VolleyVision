import { useState, FormEvent } from 'react';
import { useLookupCode, useRedeemTeamCode, useRedeemInvitation } from '../../hooks';
import { isEmailNotVerifiedError, getApiErrorMessage } from '../../lib/api';
import type { CodeLookupResult } from '../../lib/api';
import type { TeamRole } from '../../types';
import ResendVerificationNotice from '../ui/ResendVerificationNotice';

const STAFF_ROLE_OPTIONS: { value: TeamRole; label: string }[] = [
  // No Manager: managers join by email invitation only (the server refuses it).
  { value: 'ASSISTANT_COACH', label: 'Assistant Coach' },
  { value: 'STATISTICIAN', label: 'Statistician' },
];

/**
 * Self-serve "I have a code" entry point, shared by the in-app Invitations page
 * and the public /invitations/redeem page so both behave identically. Looks the
 * code up first so staff codes can show a role picker before redeeming, and
 * personal email invites hand off to the existing single-use redeem flow.
 */
export default function JoinByCodeCard({ initialCode = '' }: { initialCode?: string }) {
  const lookup = useLookupCode();
  const redeemTeamCode = useRedeemTeamCode();
  const redeemInvitation = useRedeemInvitation();

  const [code, setCode] = useState(initialCode);
  const [found, setFound] = useState<CodeLookupResult | null>(null);
  const [role, setRole] = useState<TeamRole>('ASSISTANT_COACH');
  const [error, setError] = useState('');
  const [notVerified, setNotVerified] = useState(false);
  const [joinedTeam, setJoinedTeam] = useState<string | null>(null);

  const busy = lookup.isPending || redeemTeamCode.isPending || redeemInvitation.isPending;

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    setError(''); setNotVerified(false);
    const trimmed = code.trim();
    if (!trimmed) { setError('Enter a join code.'); return; }
    try {
      const result = await lookup.mutateAsync(trimmed);
      if (!result.kind) {
        setError("Couldn't redeem that code. Check it and try again.");
        return;
      }
      setFound(result);
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't redeem that code. Check it and try again."));
    }
  }

  async function handleConfirm() {
    setError(''); setNotVerified(false);
    try {
      if (found?.kind === 'EMAIL_INVITE') {
        const inv = await redeemInvitation.mutateAsync(code.trim());
        setJoinedTeam(inv.team?.name ?? 'your team');
      } else if (found?.kind === 'TEAM_PLAYER') {
        const result = await redeemTeamCode.mutateAsync({ code: code.trim() });
        setJoinedTeam(result.team.name);
      } else if (found?.kind === 'TEAM_STAFF') {
        const result = await redeemTeamCode.mutateAsync({ code: code.trim(), role });
        setJoinedTeam(result.team.name);
      }
    } catch (err) {
      if (isEmailNotVerifiedError(err)) {
        setNotVerified(true);
      } else {
        setError(getApiErrorMessage(err, "Couldn't redeem that code. Check it and try again."));
      }
    }
  }

  function reset() {
    setFound(null);
    setError('');
    setNotVerified(false);
    setCode('');
    setJoinedTeam(null);
  }

  if (joinedTeam) {
    return (
      <div className="card p-5 text-center space-y-2">
        <p className="text-grey-900 font-medium">You're in — you've joined {joinedTeam}.</p>
        <button className="text-grey-500 hover:text-grey-900 text-xs" onClick={reset}>Join another team</button>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      {!found ? (
        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-grey-600 font-medium mb-1">Have a join code?</label>
            <input
              className="input tracking-widest font-mono"
              placeholder="e.g. A2B3C4D5"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <button type="submit" className="btn-primary text-sm px-5 py-2.5" disabled={busy}>
            {lookup.isPending ? 'Checking…' : 'Continue'}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          {found.kind === 'TEAM_STAFF' && (
            <div>
              <label className="block text-xs text-grey-600 font-medium mb-1">Join as</label>
              <select className="input text-sm" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                {STAFF_ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className="btn-primary text-sm px-5 py-2.5" disabled={busy} onClick={handleConfirm}>
              {busy ? 'Joining…' : found.kind === 'TEAM_STAFF'
                ? `Join ${found.teamName} as ${STAFF_ROLE_OPTIONS.find((r) => r.value === role)?.label}`
                : found.kind === 'TEAM_PLAYER'
                  ? `Join ${found.teamName} as Player`
                  : `Accept your invitation to ${found.teamName}`}
            </button>
            <button className="text-grey-500 hover:text-grey-900 text-xs" onClick={() => { setFound(null); setError(''); }}>
              Back
            </button>
          </div>
        </div>
      )}

      {notVerified && <ResendVerificationNotice />}
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}
