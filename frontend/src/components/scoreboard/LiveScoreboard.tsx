import clsx from 'clsx';
import type { MatchStatus } from '../../types';

// Best-of-5 — mirrors SETS_TO_WIN_MATCH in backend/src/lib/setOperations.ts.
const SETS_TO_WIN = 3;

export type ScoreSide = 'home' | 'away';

/**
 * The live scoreboard: big tap-to-score digits, gold on our side, navy on
 * theirs, with the set number and sets won.
 *
 * Display data comes in as plain values rather than a Match, so this can back a
 * read-only match view later without dragging the tracker's data fetching with
 * it. Every handler is optional and independent — omit them all to render a
 * read-only board, or pass only the ones a given surface should offer.
 *
 * Per-set score history is deliberately not shown here: MatchDashboardPage's
 * Match Stats tab already breaks it down, one tab away.
 */
export interface LiveScoreboardProps {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  homeSetsWon: number;
  awaySetsWon: number;
  /** Display-only — MatchPageHeader's dropdown owns changing match status. */
  status: MatchStatus;
  /** The set the tracker is pointed at — not necessarily the set being played. */
  currentSet: number;

  /** Jump straight to a set (1–5) to view or correct it. */
  onSelectSet?: (set: number) => void;
  /** Adjust a side's running score by `delta`. */
  onScore?: (side: ScoreSide, delta: number) => void;
  /**
   * Award the current set to whoever leads, ignoring the points threshold.
   * No surface passes this today — the manual End Set flow complicated live
   * tracking in testing and is disabled (see the commented-out route in
   * backend/src/routes/matches.ts). Kept wired for possible future use.
   */
  onEndSet?: () => void;
  /** Zero the current set's running score only. */
  onResetSet?: () => void;
  /** Zero the entire match — sets won and history included. */
  onResetMatch?: () => void;
  /** Undo the last recorded stat event (kill, dig…) — never a whole set. */
  onUndoEvent?: () => void;
  canUndoEvent?: boolean;
  /** Disables the mutating controls while a request is in flight. */
  busy?: boolean;
}

/** Three dots per side, filled up to the sets that side has won. */
function SetsWonDots({ won, side }: { won: number; side: ScoreSide }) {
  return (
    <div className="flex gap-1.5" aria-label={`${won} of ${SETS_TO_WIN} sets won`}>
      {Array.from({ length: SETS_TO_WIN }, (_, i) => (
        <span
          key={i}
          className={clsx(
            'w-2.5 h-2.5 rounded-full shrink-0',
            i < won ? (side === 'home' ? 'bg-gold-500' : 'bg-navy-500') : 'bg-grey-200',
          )}
        />
      ))}
    </div>
  );
}

interface TeamPanelProps {
  name: string;
  score: number;
  setsWon: number;
  side: ScoreSide;
  onScore?: (side: ScoreSide, delta: number) => void;
  busy?: boolean;
}

function TeamPanel({ name, score, setsWon, side, onScore, busy }: TeamPanelProps) {
  const isHome = side === 'home';
  const interactive = !!onScore;

  function addPoint() {
    if (!busy) onScore?.(side, 1);
  }

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Add a point to ${name}` : undefined}
      onClick={interactive ? addPoint : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                addPoint();
              }
            }
          : undefined
      }
      className={clsx(
        'flex flex-col min-w-0 p-3 sm:p-6 transition-colors outline-none',
        isHome
          ? 'border-l-4 border-gold-500 bg-gradient-to-b from-gold-500/10 to-transparent'
          : 'border-r-4 border-navy-500 items-end text-right',
        interactive && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500',
        interactive && (isHome ? 'hover:bg-gold-500/15' : 'hover:bg-navy-500/5'),
      )}
    >
      {/* self-stretch: the away panel is items-end, which would size this row
          to the whole name and stop it truncating. */}
      <div className={clsx('flex items-center gap-2.5 min-w-0 min-h-[26px] self-stretch', !isHome && 'flex-row-reverse')}>
        <span className="flex-1 min-w-0 font-display font-bold text-lg sm:text-2xl uppercase tracking-wide leading-none text-navy-700 truncate">
          {name}
        </span>
        {/* Below sm there's no room for it beside the name; the gold (home)
            and navy (away) edges already say which side is which. */}
        <span className="hidden sm:inline text-[10px] font-bold tracking-widest text-grey-600 border border-grey-200 rounded px-1.5 py-0.5 shrink-0">
          {isHome ? 'HOME' : 'AWAY'}
        </span>
      </div>

      <div className="mt-3">
        <SetsWonDots won={setsWon} side={side} />
      </div>

      {/* Zero-padded so the digits hold their width and the two sides stay
          visually level as scores cross from one digit to two. */}
      <div className="font-display tabular-nums font-extrabold leading-[0.92] tracking-tight text-grey-900 mt-auto pt-4 text-[clamp(40px,11vw,120px)] sm:text-[clamp(56px,11vw,120px)]">
        {String(score).padStart(2, '0')}
      </div>
    </div>
  );
}

/**
 * A side's point-correction button. Lives in the shared controls row below the
 * scorebug rather than inside its TeamPanel, so all the board's controls read
 * as one row — but it stays aligned under the side it corrects.
 */
function MinusButton({
  name,
  score,
  side,
  onScore,
  busy,
}: {
  name: string;
  score: number;
  side: ScoreSide;
  onScore: (side: ScoreSide, delta: number) => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Subtract a point from ${name}`}
      title={`Subtract a point from ${name}`}
      disabled={busy || score === 0}
      onClick={() => onScore(side, -1)}
      className="grid place-items-center w-11 h-11 shrink-0 rounded-lg bg-grey-50 hover:bg-grey-200 disabled:opacity-40 text-grey-900 text-2xl font-semibold border border-grey-200 transition-colors leading-none"
    >
      −
    </button>
  );
}

export default function LiveScoreboard({
  homeName,
  awayName,
  homeScore,
  awayScore,
  homeSetsWon,
  awaySetsWon,
  status,
  currentSet,
  onSelectSet,
  onScore,
  onEndSet,
  onResetSet,
  onResetMatch,
  onUndoEvent,
  canUndoEvent = false,
  busy = false,
}: LiveScoreboardProps) {
  const tied = homeScore === awayScore;
  const hasControlsRow = !!(onScore || onUndoEvent || onEndSet || onResetSet || onResetMatch);

  return (
    <div className="card p-2.5 space-y-2">
      {/* ── Set jump + match status ──
          Direct 1–5 jump (rather than prev/next stepping) so a mis-tap in an
          earlier set can be fixed without walking back through the others. */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-1.5 pt-1.5">
        {onSelectSet && (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSelectSet(s)}
                aria-pressed={currentSet === s}
                className={clsx(
                  'w-11 h-11 rounded-lg text-sm tabular-nums font-bold transition-colors border',
                  currentSet === s
                    ? 'bg-gold-500 border-gold-500 text-navy-900'
                    : 'bg-grey-50 border-grey-200 text-grey-600 hover:bg-grey-200',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Status is display-only: MatchPageHeader's dropdown owns changing it,
            and it sits on this same page — two controls for one value invites
            them to disagree. `ml-auto` keeps it right-aligned when there's no
            set selector to sit opposite. */}
        <span
          className={clsx(
            'ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg',
            status === 'IN_PROGRESS'
              ? 'bg-gold-500/15 text-navy-900 border border-gold-500/50'
              : 'bg-grey-50 text-grey-600 border border-grey-200',
          )}
        >
          {status === 'IN_PROGRESS' ? '● LIVE' : status}
        </span>
      </div>

      {/* ── Scorebug ── */}
      {/* minmax(0,1fr): a plain 1fr won't shrink below a long team name, so
          one side took the whole board at 360px. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch rounded-2xl overflow-hidden">
        <TeamPanel
          name={homeName}
          score={homeScore}
          setsWon={homeSetsWon}
          side="home"
          onScore={onScore}
          busy={busy}
        />

        <div className="flex flex-col items-center justify-center gap-1 px-4 sm:px-5 py-6 bg-grey-50 border-x border-grey-200 min-w-[76px] sm:min-w-[92px]">
          <div className="text-[11px] font-bold tracking-[0.24em] text-navy-700">SET</div>
          <div className="font-display tabular-nums font-extrabold leading-none text-grey-900 text-[clamp(32px,5vw,56px)]">
            {currentSet}
          </div>
          <div className="font-display tabular-nums font-bold text-xl text-grey-600 mt-2 flex items-center gap-2">
            <span className="text-navy-700">{homeSetsWon}</span>
            <span className="text-grey-400 text-base">–</span>
            <span className="text-grey-600">{awaySetsWon}</span>
          </div>
          <div className="text-[10px] font-semibold tracking-widest text-grey-400">SETS WON</div>
        </div>

        <TeamPanel
          name={awayName}
          score={awayScore}
          setsWon={awaySetsWon}
          side="away"
          onScore={onScore}
          busy={busy}
        />
      </div>

      {/* ── Controls ──
          One row directly under the scorebug: each side's − sits at its own
          edge, aligned under the score it corrects, with the shared actions
          centred between them. */}
      {hasControlsRow && (
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 pb-1.5 pt-1">
          <div>
            {onScore && (
              <MinusButton name={homeName} score={homeScore} side="home" onScore={onScore} busy={busy} />
            )}
          </div>

          <div className="flex items-center justify-center gap-2 flex-wrap">
            {onUndoEvent && (
              <button
                type="button"
                onClick={onUndoEvent}
                disabled={busy || !canUndoEvent}
                title="Undo the last recorded stat event"
                className="min-h-[44px] text-sm font-medium text-grey-600 hover:text-navy-700 bg-grey-50 border border-grey-200 hover:border-grey-400 disabled:opacity-40 disabled:hover:text-grey-600 disabled:hover:border-grey-200 rounded-xl px-4 py-2.5 transition-colors"
              >
                ↩ Undo Event
              </button>
            )}

            {onEndSet && (
              <button
                type="button"
                onClick={onEndSet}
                disabled={busy || tied}
                // A tied set has no winner to award it to; the backend rejects it
                // too, but disabling here explains why rather than erroring.
                title={tied ? 'Scores are tied — no winner to award the set to' : 'Award this set to whoever leads'}
                className="min-h-[44px] font-display font-bold text-[15px] tracking-wide text-navy-900 bg-gold-500 hover:bg-gold-600 disabled:opacity-40 disabled:hover:bg-gold-500 rounded-xl px-6 py-2.5 transition-colors"
              >
                END SET →
              </button>
            )}

            {onResetMatch && (
              <button
                type="button"
                onClick={onResetMatch}
                disabled={busy}
                title="Zero the whole match — every set and its history"
                className="min-h-[44px] text-sm font-semibold text-error-strong bg-error/10 hover:bg-error/20 border border-error/30 disabled:opacity-40 rounded-xl px-4 py-2.5 transition-colors"
              >
                Reset Match
              </button>
            )}

            {onResetSet && (
              <button
                type="button"
                onClick={onResetSet}
                disabled={busy}
                title="Zero this set's score only"
                className="min-h-[44px] text-sm font-medium text-grey-600 hover:text-navy-700 bg-grey-50 border border-grey-200 hover:border-grey-400 disabled:opacity-40 rounded-xl px-4 py-2.5 transition-colors"
              >
                Reset Set
              </button>
            )}
          </div>

          <div>
            {onScore && (
              <MinusButton name={awayName} score={awayScore} side="away" onScore={onScore} busy={busy} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
