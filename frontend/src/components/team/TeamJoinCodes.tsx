import { useState } from 'react';
import { useTeamJoinCodes, useRegenerateJoinCode } from '../../hooks';
import type { TeamJoinCodeKind } from '../../lib/api';
import { copyText } from '../../lib/clipboard';

// ── Join codes (coach) — persistent, reusable player/staff codes ──────────────
// Shared by the Invitations tab (both codes) and the inline "+ Add player" /
// "+ Add member" panels (a single code, via `only`).

function JoinCodeRow({ label, hint, code, kind, teamId, rowClass }: {
  label: string; hint: string; code: string | null; kind: TeamJoinCodeKind; teamId: string;
  rowClass: string;
}) {
  const regenerate = useRegenerateJoinCode(teamId);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    if (!code) return;
    setCopied((await copyText(code)) ? 'copied' : 'failed');
    setTimeout(() => setCopied('idle'), 2000);
  }

  function handleRegenerate() {
    if (!confirm(`Regenerate the ${label.toLowerCase()}? The old code will stop working.`)) return;
    regenerate.mutate(kind);
  }

  return (
    <div className={`flex items-center gap-3 ${rowClass}`}>
      <div className="flex-1 min-w-0">
        <p className="text-grey-900 text-sm font-medium">{label}</p>
        <p className="text-grey-600 text-xs">{hint}</p>
      </div>
      <span className="badge badge-neutral font-mono tracking-widest text-sm px-3 py-1">
        {code ?? '—'}
      </span>
      <button className="btn-secondary text-xs px-3 py-1.5" onClick={copy} disabled={!code}>
        {copied === 'copied' ? 'Copied ✓' : copied === 'failed' ? "Couldn't copy" : 'Copy'}
      </button>
      <button
        className="text-grey-600 hover:text-grey-900 text-xs px-2 py-1.5"
        onClick={handleRegenerate}
        disabled={regenerate.isPending}
      >
        {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
      </button>
    </div>
  );
}

interface Props {
  teamId: string;
  /**
   * Render just one code. Used by the inline add-player / add-member panels,
   * which each only care about their own half and supply their own label.
   */
  only?: TeamJoinCodeKind;
}

export default function TeamJoinCodes({ teamId, only }: Props) {
  const { data: codes, isLoading, isError } = useTeamJoinCodes(teamId);
  if (isError) return null; // no invitation access — the route 403s

  // Nested inside an already-padded panel, the rows shouldn't re-indent or draw
  // their own boundary; standalone on the Invitations tab, they should.
  const rowClass = only ? 'py-2' : 'px-5 py-3';
  // The server leaves the staff code out below FULL_ACCESS on invitations.
  const canSeeStaffCode = !!codes && 'staffJoinCode' in codes;

  const rows = {
    PLAYER: (
      <JoinCodeRow
        label="Player code" hint="Joins as Player"
        code={codes?.playerJoinCode ?? null} kind="PLAYER" teamId={teamId} rowClass={rowClass}
      />
    ),
    STAFF: canSeeStaffCode ? (
      <JoinCodeRow
        label="Staff code" hint="Joins as Assistant Coach or Statistician"
        code={codes?.staffJoinCode ?? null} kind="STAFF" teamId={teamId} rowClass={rowClass}
      />
    ) : null,
  };

  if (only) {
    return isLoading
      ? <p className="text-grey-600 text-sm py-2">Loading code…</p>
      : rows[only];
  }

  return (
    <div className="border-b border-grey-200">
      <p className="px-5 pt-3 text-xs text-grey-600 font-medium">Join codes — share with your squad; anyone with a code joins instantly</p>
      {isLoading ? (
        <p className="text-grey-600 text-sm px-5 py-3">Loading codes…</p>
      ) : (
        <div className="divide-y divide-grey-200">
          {rows.PLAYER}
          {rows.STAFF}
        </div>
      )}
    </div>
  );
}
