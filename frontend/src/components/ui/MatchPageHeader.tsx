import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import MatchSubNav from './MatchSubNav';
import { ArrowLeftIcon, ChevronIcon } from './icons';
import { isPendingApproval, type MatchStatus } from '../../types';
import { useHasPermission, useUpdateMatch } from '../../hooks';

// Shared header for all three match sub-pages (Match Stats | Events | Track).
// Consolidates the back button, title/meta block, and MatchSubNav so every
// sub-page renders an identical shell instead of hand-rolling its own.

const STATUS_STYLES: Record<MatchStatus, string> = {
  SCHEDULED: 'badge-info',
  IN_PROGRESS: 'badge-accent',
  COMPLETED: 'badge-success',
  CANCELLED: 'badge-error',
};

const MATCH_STATUSES: MatchStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

// Small color hint shown next to each row in the status menu — a subtle nod to
// what the badge becomes, without painting the whole row (see STATUS_STYLES).
const STATUS_DOT: Record<MatchStatus, string> = {
  SCHEDULED: 'bg-info',
  IN_PROGRESS: 'bg-gold-500',
  COMPLETED: 'bg-success',
  CANCELLED: 'bg-error',
};

interface MatchPageHeaderProps {
  matchId: string;
  teamId: string;
  teamName?: string;
  opponent: string;
  matchDate: string;
  competition?: string | null;
  venue?: string | null;
  status: MatchStatus;
  // Live tracking is offered only to those who can track a live match; the Track
  // tab additionally requires the match to be IN_PROGRESS (same gating as before).
  canTrack: boolean;
}

export default function MatchPageHeader({
  matchId,
  teamId,
  teamName,
  opponent,
  matchDate,
  competition,
  venue,
  status,
  canTrack,
}: MatchPageHeaderProps) {
  const canManageMatches = useHasPermission(teamId, 'CREATE_MATCH');
  const updateMatch = useUpdateMatch();
  const mode: 'track' | 'watch' | undefined =
    canTrack && status === 'IN_PROGRESS' ? 'track' :
    !canTrack && status === 'IN_PROGRESS' ? 'watch' :
    undefined;
  const [pendingNotice, setPendingNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleStatusChange(next: MatchStatus) {
    setMenuOpen(false);
    const result = await updateMatch.mutateAsync({ id: matchId, data: { status: next } });
    if (isPendingApproval(result)) {
      // Applied optimistically by the trigger's own prop binding — since we
      // read `status` from props (server state), a no-op mutation naturally
      // leaves the trigger showing the prior value once queries settle.
      setPendingNotice(`Status change submitted for the head coach's approval.`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={`/teams/${teamId}/matches`}
          className="btn-secondary inline-flex items-center gap-1.5 text-sm py-1.5 px-3 min-h-[44px]"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to Matches
        </Link>
        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-grey-900 break-words">
              {teamName ? `${teamName} vs ${opponent}` : `vs ${opponent}`}
            </h1>
            <p className="text-sm text-grey-600 mt-1">
              {format(new Date(matchDate), 'PPP')}
              {venue && ` · ${venue}`}
              {competition && ` · ${competition}`}
            </p>
          </div>
          {canManageMatches ? (
            <div className="relative shrink-0">
              <button
                type="button"
                disabled={updateMatch.isPending}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={menuOpen}
                aria-label="Match status"
                // The tappable area is this button (>=44x44); the `badge` styling below is
                // purely visual so the compact pill look is unchanged at rest.
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] p-1 cursor-pointer disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 rounded"
              >
                <span className={`badge ${STATUS_STYLES[status]} pr-6 pl-2 relative`}>
                  {status.replace('_', ' ')}
                  <ChevronIcon className="w-3 h-3 rotate-90 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </span>
              </button>

              {menuOpen && (
                <>
                  {/* Outside-click backdrop — no headless-ui/Radix in this codebase, keep it that way */}
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div role="listbox" className="card absolute right-0 mt-1 z-20 py-1 min-w-[9rem] shadow-lg">
                    {MATCH_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="option"
                        aria-selected={s === status}
                        onClick={() => handleStatusChange(s)}
                        className="w-full flex items-center gap-2 min-h-[44px] px-3 py-2 text-sm text-grey-900 hover:bg-grey-50 transition-colors text-left"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s]}`} aria-hidden />
                        {s.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span className={`badge ${STATUS_STYLES[status]} shrink-0`}>{status.replace('_', ' ')}</span>
          )}
        </div>
        {pendingNotice && (
          <div className="mt-3 card p-3 border border-gold-500/40 bg-gold-500/10 text-sm text-grey-900 flex items-center justify-between gap-3">
            <span>{pendingNotice}</span>
            <button className="inline-flex items-center min-h-[44px] px-2 text-grey-600 hover:text-grey-900 text-xs shrink-0" onClick={() => setPendingNotice('')}>Dismiss</button>
          </div>
        )}
      </div>

      <MatchSubNav matchId={matchId} mode={mode} />
    </div>
  );
}
