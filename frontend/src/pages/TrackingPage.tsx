import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useMatch, useEvents, useRecordEvent, useUndoEvent, useUpdateScore, useResetSetScore, useResetMatch, useHasPermission } from '../hooks';
import { useSyncTrackWatchRoute } from '../hooks/useSyncTrackWatchRoute';
import type { EventType, Player, Position } from '../types';
import { EVENT_META, POSITION_LABELS, POSITION_FULL_LABELS } from '../types';
import type { EventMeta } from '../types';
import clsx from 'clsx';
import CourtZoneSelector from '../components/tracking/CourtZoneSelector';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import LiveScoreboard from '../components/scoreboard/LiveScoreboard';
import type { ScoreSide } from '../components/scoreboard/LiveScoreboard';

// Event buttons grouped by category for the tablet layout
const CATEGORIES = [
  {
    label: 'Attack',
    events: ['KILL', 'ATTACK_ERROR', 'ATTACK_ATTEMPT', 'TIP', 'FREE_BALL'] as EventType[],
  },
  {
    label: 'Serve',
    events: ['ACE', 'SERVICE_ERROR', 'SERVE_IN'] as EventType[],
  },
  {
    label: 'Pass',
    events: ['PASS_3', 'PASS_2', 'PASS_1', 'PASS_0'] as EventType[],
  },
  {
    label: 'Block',
    events: ['SOLO_BLOCK', 'BLOCK_ASSIST', 'BLOCK_ERROR'] as EventType[],
  },
  {
    label: 'Defence',
    events: ['DIG', 'DIG_ERROR'] as EventType[],
  },
  {
    label: 'Set',
    events: ['ASSIST', 'SETTING_ERROR'] as EventType[],
  },
];

function getMeta(type: EventType) {
  return EVENT_META.find((m) => m.type === type)!;
}

// Passing grades 2 and 1 are separate values the analytics depend on, but to a
// coach mid-rally they're both just "a pass" — the distinction is quality, not
// action. So they share one visual button split into two tap zones, ordered
// left-to-right by descending quality like the rest of the row.
//
// Only the presentation is compound: each half records its own EventType and
// gets its own pulse, exactly like a plain event button. Both grades are
// outcome: neutral, so they'd render in identical colour anyway — the corner
// grade tag is what actually keeps them apart, since the shared "Pass" label
// can't.
const SPLIT_PASS_HALVES = [
  { type: 'PASS_2' as EventType, grade: '2' },
  { type: 'PASS_1' as EventType, grade: '1' },
];

function SplitPassButton({
  justRecorded,
  disabled,
  onRecord,
}: {
  justRecorded: string | null;
  disabled: boolean;
  onRecord: (type: EventType) => void;
}) {
  return (
    <div className="btn-event-split">
      {SPLIT_PASS_HALVES.map(({ type, grade }, i) => (
        <button
          key={type}
          onClick={() => onRecord(type)}
          disabled={disabled}
          aria-label={`Pass grade ${grade}`}
          className={clsx(
            'btn-event-split-half',
            i > 0 && 'border-l border-navy-600',
            justRecorded === type && 'scale-95 btn-event-just-recorded',
          )}
        >
          Pass
          <span className="absolute top-1 right-2 text-xs font-bold text-navy-300 tabular-nums">
            {grade}
          </span>
        </button>
      ))}
    </div>
  );
}

// Focus mode filters which event-button groups render (roster/score/zone stay
// put). Categories are matched against EVENT_META[].category so the lists stay
// in sync with the data rather than being hardcoded event-by-event.
type FocusMode = 'all' | 'attack' | 'defense';

const FOCUS_CATEGORIES: Record<Exclude<FocusMode, 'all'>, EventMeta['category'][]> = {
  attack: ['attack', 'serve', 'set'],
  defense: ['pass', 'block', 'defence'],
};

// Positions surfaced first (in this order) when a focus mode is active — a
// convenience re-sort of the roster, never a filter (any player can dig, pass,
// set, or attack, so all stay tappable).
const FOCUS_POSITION_PRIORITY: Record<Exclude<FocusMode, 'all'>, Position[]> = {
  attack: ['OUTSIDE_HITTER', 'OPPOSITE', 'MIDDLE_BLOCKER'],
  defense: ['LIBERO', 'DEFENSIVE_SPECIALIST'],
};

// Flash feedback state
type FlashState = { text: string; ok: boolean } | null;

export default function TrackingPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { data: match, isLoading } = useMatch(matchId!);
  const { data: events } = useEvents(matchId!);
  const recordEvent = useRecordEvent(matchId!);
  const undoEvent = useUndoEvent(matchId!);

  const updateScore = useUpdateScore(matchId!);
  const resetSetScore = useResetSetScore(matchId!);
  const resetMatch = useResetMatch(matchId!);
  // Track is offered only to those who can track a live match (players never
  // can — Iteration 3 Task 6); the shared header uses this to render the Track tab.
  const canTrack = useHasPermission(match?.teamId ?? '', 'TRACK_MATCH');
  // Flipping the Coach/Player toggle mid-session moves you to the matching
  // route — a player-mode user never sits on the live input screen.
  useSyncTrackWatchRoute(matchId, match?.status, canTrack);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [currentSet, setCurrentSet] = useState(1);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [selectedRotation, setSelectedRotation] = useState<number | null>(null);
  const [keepZone, setKeepZone] = useState(true);
  const [flash, setFlash] = useState<FlashState>(null);
  const [justRecorded, setJustRecorded] = useState<string | null>(null);
  const [isOpponentMode, setIsOpponentMode] = useState(false);
  const [opponentJerseyNumber, setOpponentJerseyNumber] = useState('');
  // Local-only, like keepZone/selectedRotation — never persisted.
  const [focusMode, setFocusMode] = useState<FocusMode>('all');
  // Distinct player IDs from the last few own-team events, most-recent-first,
  // capped at 3 — powers the quick-switch strip above the roster.
  const [recentPlayerIds, setRecentPlayerIds] = useState<string[]>([]);

  // Auto-select first player when roster loads
  useEffect(() => {
    if (match?.team?.players?.length && !selectedPlayer) {
      setSelectedPlayer(match.team.players[0]);
    }
  }, [match?.team?.players, selectedPlayer]);

  const showFlash = useCallback((text: string, ok: boolean) => {
    setFlash({ text, ok });
    setTimeout(() => setFlash(null), 1400);
  }, []);

  async function handleRecord(eventType: EventType) {
    if (!isOpponentMode && !selectedPlayer) {
      showFlash('Select a player first', false);
      return;
    }

    try {
      setJustRecorded(eventType);
      const meta = getMeta(eventType);
      const jerseyNum = opponentJerseyNumber.trim() !== '' ? parseInt(opponentJerseyNumber, 10) : null;
      await recordEvent.mutateAsync({
        matchId: matchId!,
        ...(isOpponentMode
          ? { isOpponentEvent: true, opponentJerseyNumber: jerseyNum }
          : { playerId: selectedPlayer!.id }),
        eventType,
        setNumber: currentSet,
        courtZone: selectedZone,
        rotationNumber: selectedRotation,
      });
      if (isOpponentMode) {
        showFlash(`OPP: ${meta.label}${jerseyNum != null ? ` #${jerseyNum}` : ''}`, true);
      } else {
        // Push onto the recently-used history (dedupe, most-recent-first, cap 3).
        const usedId = selectedPlayer!.id;
        setRecentPlayerIds((prev) => [usedId, ...prev.filter((id) => id !== usedId)].slice(0, 3));
        showFlash(`${meta.label} → #${selectedPlayer!.jerseyNumber}`, true);
      }
      setTimeout(() => setJustRecorded(null), 300);
      if (!keepZone) setSelectedZone(null);
    } catch {
      showFlash("Couldn't save that event", false);
      setJustRecorded(null);
    }
  }

  async function handleUndo() {
    try {
      await undoEvent.mutateAsync();
      showFlash('Undone', true);
    } catch {
      showFlash('Nothing to undo', false);
    }
  }

  // Destructive — zeroes the current set's score and clears its manual
  // adjustment history, so confirm before doing it (consistent with the
  // Delete confirm in MatchesPage.tsx).
  function handleResetSetScore() {
    if (confirm(`Reset the score for Set ${currentSet} to 0–0? This cannot be undone.`)) {
      resetSetScore.mutate();
    }
  }

  // The scoreboard reports a delta; the score API takes absolutes.
  function handleScore(side: ScoreSide, delta: number) {
    const current = (side === 'home' ? match?.homeScore : match?.awayScore) ?? 0;
    const next = Math.max(0, current + delta);
    updateScore.mutate(side === 'home' ? { homeScore: next } : { awayScore: next });
  }

  // The most destructive action on this screen — wipes every set and the whole
  // score history, not just the current set. Same confirm pattern as above.
  async function handleResetMatch() {
    if (!confirm('Reset the ENTIRE match? Every set score and set won will be cleared. Recorded stats are kept. This cannot be undone.')) return;
    try {
      await resetMatch.mutateAsync();
      setCurrentSet(1);
      showFlash('Match reset', true);
    } catch {
      showFlash("Couldn't reset the match", false);
    }
  }

  // A plain one-event button. Shared by every category and by the two ends of
  // the Pass row, so the split button in the middle is the only special case.
  function renderEventButton(eventType: EventType) {
    const meta = getMeta(eventType);
    const cls =
      meta.outcome === 'positive'
        ? 'btn-event-positive'
        : meta.outcome === 'negative'
        ? 'btn-event-negative'
        : 'btn-event-neutral';
    return (
      <button
        key={eventType}
        className={clsx(cls, justRecorded === eventType && 'scale-95 btn-event-just-recorded')}
        onClick={() => handleRecord(eventType)}
        disabled={recordEvent.isPending}
      >
        {meta.label}
      </button>
    );
  }

  if (isLoading) return <p className="text-grey-600">Loading match…</p>;

  if (!match) {
    return (
      <p className="text-grey-600">Match not found. <Link to="/teams" className="text-navy-700 font-medium">Go back</Link></p>
    );
  }

  // Live tracking is only for in-progress matches (Iteration 3 Task 6). A
  // scheduled/completed/cancelled match can't be live-edited — send the viewer
  // to the read-only Events changelog instead.
  if (match.status !== 'IN_PROGRESS') {
    return <Navigate to={`/matches/${matchId}/events`} replace />;
  }

  const recentEvents = [...(events ?? [])].reverse().slice(0, 5);
  const players = match.team?.players ?? [];

  // One in-flight score mutation is enough to freeze the board's controls —
  // double-tapping End Set or Reset Match while a request lands would apply twice.
  const scoreboardBusy =
    updateScore.isPending ||
    resetSetScore.isPending ||
    resetMatch.isPending ||
    undoEvent.isPending;

  // Undo reaches into both action logs, so the button has to account for both:
  // a manual score tap writes a ScoreAdjustment, not an Event, and a match can
  // have adjustments with no stat events recorded yet.
  const canUndo =
    (events?.length ?? 0) > 0 || (match._count?.scoreAdjustments ?? 0) > 0;

  // Focus mode re-sorts the roster so the most relevant positions surface first
  // (stable — everyone else keeps their original order and stays tappable) and
  // filters which event-button groups render.
  const orderedPlayers =
    focusMode === 'all'
      ? players
      : [...players].sort((a, b) => {
          const priority = FOCUS_POSITION_PRIORITY[focusMode];
          const ra = priority.indexOf(a.position);
          const rb = priority.indexOf(b.position);
          return (ra === -1 ? priority.length : ra) - (rb === -1 ? priority.length : rb);
        });

  const visibleCategories =
    focusMode === 'all'
      ? CATEGORIES
      : CATEGORIES.filter((cat) =>
          FOCUS_CATEGORIES[focusMode].includes(getMeta(cat.events[0]).category)
        );

  // Quick-switch chips: recent players minus the one already selected (shown as
  // selected in the grid). Only meaningful in own-team recording mode.
  const recentPlayers = recentPlayerIds
    .filter((id) => id !== selectedPlayer?.id)
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => p != null);

  return (
    <div className="space-y-6 select-none">
      <MatchPageHeader
        matchId={match.id}
        teamId={match.teamId}
        teamName={match.team?.name}
        opponent={match.opponent}
        matchDate={match.matchDate}
        competition={match.competition}
        venue={match.venue}
        status={match.status}
        canTrack={canTrack}
      />

      {/* ── Live Scoreboard + controls ── */}
      <LiveScoreboard
        homeName={match.team?.name ?? 'Home'}
        awayName={match.opponent}
        homeScore={match.homeScore ?? 0}
        awayScore={match.awayScore ?? 0}
        homeSetsWon={match.homeSetsWon ?? 0}
        awaySetsWon={match.awaySetsWon ?? 0}
        status={match.status}
        currentSet={currentSet}
        onSelectSet={setCurrentSet}
        onScore={handleScore}
        onResetSet={handleResetSetScore}
        onResetMatch={handleResetMatch}
        onUndoEvent={handleUndo}
        canUndoEvent={canUndo}
        busy={scoreboardBusy}
      />

      {/* ── Main ── */}
      <div className="space-y-4">
        {/* Flash feedback overlay */}
        {flash && (
          <div
            className={clsx(
              'fixed top-[calc(var(--vv-safe-top)+5rem)] left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl font-semibold text-sm shadow-xl transition-all',
              flash.ok ? 'bg-success text-white' : 'bg-error text-white'
            )}
          >
            {flash.text}
          </div>
        )}

        {/* ── Recording mode toggle ── */}
        {/* Both toggles sit on a 44px (h-11) button height — the minimum tap
            target at courtside, on a phone, with a glove or a shaky hand. They
            read as one banner, so Us/Opponent and Focus stay sized to match. */}
        <div className="flex items-center gap-3 flex-wrap card p-3">
          {/* Each label is grouped with the toggle it labels, so when the row
              wraps they travel together rather than the label being orphaned on
              the line above its own buttons. */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-grey-600 font-medium shrink-0">Recording for:</span>
            <div className="flex rounded-lg overflow-hidden border border-grey-200 text-sm font-semibold">
              <button
                onClick={() => setIsOpponentMode(false)}
                className={clsx(
                  'h-11 px-5 transition-colors',
                  !isOpponentMode ? 'bg-gold-500 text-navy-900' : 'bg-grey-50 text-grey-600 hover:bg-grey-200'
                )}
              >
                Us
              </button>
              <button
                onClick={() => setIsOpponentMode(true)}
                className={clsx(
                  'h-11 px-5 transition-colors',
                  isOpponentMode ? 'bg-error text-white' : 'bg-grey-50 text-grey-600 hover:bg-grey-200'
                )}
              >
                Opponent
              </button>
            </div>
          </div>
          {isOpponentMode && (
            <input
              type="number"
              min={1}
              max={99}
              placeholder="Jersey # (opt.)"
              value={opponentJerseyNumber}
              onChange={(e) => setOpponentJerseyNumber(e.target.value)}
              // .input's own py-2.5 would fight a fixed height; py-0 lets h-11 win,
              // matching the h-11 buttons beside it.
              className="input h-11 py-0 text-sm w-36 shrink-0"
            />
          )}

          {/* Focus mode — filters which event groups render and re-sorts the
              roster by relevant position. Roster/score/zone stay visible. */}
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-grey-600 font-medium shrink-0">Focus:</span>
            <div className="flex rounded-lg overflow-hidden border border-grey-200 text-sm font-semibold">
              {([
                ['all', 'All'],
                ['attack', 'Attack'],
                ['defense', 'Defense'],
              ] as [FocusMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => setFocusMode(mode)}
                  className={clsx(
                    'h-11 px-5 transition-colors',
                    focusMode === mode ? 'bg-gold-500 text-navy-900' : 'bg-grey-50 text-grey-600 hover:bg-grey-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Player roster (hidden in opponent mode) ── */}
        {!isOpponentMode && <div className="card p-3">
          <div className="text-xs text-grey-600 font-medium mb-2 px-1">
            Select Player — Set {currentSet}
          </div>

          {/* Recently-used quick strip — fast switching between the 2–3 players
              trading a stat, without hunting the full grid. Hidden until there
              is history to show. */}
          {recentPlayers.length > 0 && (
            <div className="flex items-center gap-2 mb-3 px-1 overflow-x-auto">
              <span className="text-[10px] text-grey-600 font-medium shrink-0">Recent:</span>
              {recentPlayers.map((player) => (
                <button
                  key={player.id}
                  onClick={() => setSelectedPlayer(player)}
                  className="flex items-center gap-1.5 shrink-0 rounded-lg min-h-[44px] py-1.5 px-2.5 border bg-grey-50 border-grey-200 text-grey-900 hover:border-navy-500 transition-colors"
                >
                  <span className="tabular-nums font-bold text-sm leading-none">
                    #{player.jerseyNumber}
                  </span>
                  <span className="text-xs font-medium leading-none truncate max-w-[6rem]">
                    {player.lastName}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {orderedPlayers.map((player) => (
              <button
                key={player.id}
                onClick={() => setSelectedPlayer(player)}
                className={clsx(
                  'flex flex-col items-center justify-center rounded-xl py-2 px-1 transition-all border',
                  selectedPlayer?.id === player.id
                    ? 'bg-gold-500 border-gold-500 text-navy-900'
                    : 'bg-grey-50 border-grey-200 text-grey-900 hover:border-navy-500'
                )}
              >
                <span className="tabular-nums font-bold text-base leading-tight">
                  {player.jerseyNumber}
                </span>
                <span className="text-xs font-medium leading-tight mt-0.5 truncate w-full text-center">
                  {player.lastName}
                </span>
                <span
                  className={clsx(
                    'text-[10px] font-semibold mt-0.5',
                    selectedPlayer?.id === player.id ? 'text-navy-900/70' : 'text-grey-600'
                  )}
                >
                  {POSITION_LABELS[player.position]}
                </span>
              </button>
            ))}
          </div>
        </div>}

        {/* ── Selected player banner (own events only) ── */}
        {!isOpponentMode && <div
          className={clsx(
            'rounded-2xl px-5 py-3 flex items-center justify-between transition-colors border',
            selectedPlayer ? 'bg-navy-100 border-navy-500' : 'bg-white border-grey-200'
          )}
        >
          {selectedPlayer ? (
            <>
              <div>
                <span className="text-navy-700 tabular-nums font-bold text-lg">
                  #{selectedPlayer.jerseyNumber}
                </span>
                <span className="text-grey-900 font-semibold ml-2">
                  {selectedPlayer.firstName} {selectedPlayer.lastName}
                </span>
                <span className="text-grey-600 text-sm ml-2">
                  {POSITION_FULL_LABELS[selectedPlayer.position]}
                </span>
              </div>
              <div className="text-xs text-grey-600">
                Tap an event button to record
              </div>
            </>
          ) : (
            <span className="text-grey-600 text-sm">← Select a player above</span>
          )}
        </div>}

        {/* ── Opponent mode banner ── */}
        {isOpponentMode && (
          <div className="rounded-2xl px-5 py-3 flex items-center justify-between bg-error/15 border border-error/30">
            <span className="text-error-strong font-semibold text-sm">Recording opponent actions</span>
            <span className="text-xs text-grey-600">Tap an event to record for opponent</span>
          </div>
        )}

        {/* ── Event buttons ── */}
        <div className="space-y-3">
          {visibleCategories.map((cat) => {
            // Pass collapses its two middle grades into one split button, so it
            // occupies 3 slots rather than one per event.
            const isPass = getMeta(cat.events[0]).category === 'pass';
            const slots = isPass ? 3 : cat.events.length;
            return (
              <div key={cat.label}>
                <div className="text-xs font-semibold text-grey-600 mb-2 px-1">
                  {cat.label}
                </div>
                {/* Below sm (640px) every category caps at 2 columns regardless of
                    slot count — 5-wide at 360px crushes labels unreadable.
                    Tailwind can't take a runtime column count, so --slots feeds
                    the sm:+ grid-template-columns directly. */}
                <div
                  className="grid gap-2 grid-cols-2 sm:[grid-template-columns:repeat(var(--slots),minmax(0,1fr))]"
                  style={{ '--slots': slots } as CSSProperties}
                >
                  {isPass ? (
                    <>
                      {renderEventButton('PASS_3')}
                      <SplitPassButton
                        justRecorded={justRecorded}
                        disabled={recordEvent.isPending}
                        onRecord={handleRecord}
                      />
                      {renderEventButton('PASS_0')}
                    </>
                  ) : (
                    cat.events.map(renderEventButton)
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Court zone + Rotation selectors ── */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-3">
            <label className="flex items-center gap-2 min-h-[44px] text-xs text-grey-600 mb-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepZone}
                onChange={(e) => setKeepZone(e.target.checked)}
                className="accent-gold-500 w-4 h-4"
              />
              Keep Selected Zone after recording
            </label>
            <CourtZoneSelector value={selectedZone} onChange={setSelectedZone} />
          </div>

          <div className="card p-3">
            <div className="text-xs text-grey-600 mb-3">Rotation (optional)</div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRotation(selectedRotation === r ? null : r)}
                  className={clsx(
                    'py-3 rounded-xl text-sm font-bold tabular-nums transition-all border',
                    selectedRotation === r
                      ? 'bg-gold-500 border-gold-500 text-navy-900'
                      : 'bg-grey-50 border-grey-200 text-grey-900 hover:border-navy-500'
                  )}
                >
                  R{r}
                </button>
              ))}
            </div>
            {selectedRotation && (
              <p className="text-xs text-navy-700 mt-2 text-center">
                Rotation {selectedRotation} selected — tap again to deselect
              </p>
            )}
          </div>
        </div>

        {/* ── Recent events feed ── */}
        {recentEvents.length > 0 && (
          <div className="card overflow-hidden mt-2">
            {/* The feed is only the last handful — the Events tab is the full log.
                Sized to the brand's h3 role (§3: 1.125rem / Inter 600, for
                sub-sections), so it reads as a section header rather than a caption. */}
            <Link
              to={`/matches/${matchId}/events`}
              className="flex items-center justify-between gap-2 px-4 py-3 border-b border-grey-200 text-grey-900 hover:bg-grey-50 transition-colors group"
            >
              <span className="text-lg font-semibold group-hover:text-navy-700 transition-colors">
                Recent Events
              </span>
              {/* Secondary to the label itself — smaller and quieter. */}
              <span className="flex items-center gap-1 text-xs font-medium text-grey-400 group-hover:text-navy-700 transition-colors">
                View all
                <span aria-hidden="true">›</span>
              </span>
            </Link>
            <div className="divide-y divide-grey-200">
              {recentEvents.map((event) => {
                const meta = getMeta(event.eventType);
                return (
                  // min-h matches an avatar row's height so opponent events —
                  // which have no player, and so no avatar — don't sit visibly
                  // shorter than the rows around them.
                  <div key={event.id} className="flex items-center gap-3 px-4 py-3 min-h-[60px]">
                    <span
                      className={clsx(
                        'w-2 h-2 rounded-full shrink-0',
                        meta.outcome === 'positive'
                          ? 'bg-success'
                          : meta.outcome === 'negative'
                          ? 'bg-error'
                          : 'bg-grey-400'
                      )}
                    />
                    <span className="tabular-nums text-xs text-grey-600 shrink-0">
                      S{event.setNumber}
                    </span>
                    <span className="text-sm font-medium text-grey-900 flex-1 min-w-0 truncate">
                      {meta.label}
                    </span>
                    {event.player && (
                      // Same jersey-in-a-circle placeholder as the Player
                      // Statistics table (StatsOverview.tsx), scaled down for a
                      // list row — structured so a real photoUrl can drop an
                      // <img> in here later without restructuring. It carries
                      // the jersey number, so the name beside it doesn't repeat it.
                      <div className="w-9 h-9 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center shrink-0">
                        <span className="tabular-nums font-bold text-xs">
                          {event.player.jerseyNumber}
                        </span>
                      </div>
                    )}
                    {/* The two text spans give way first (min-w-0 lets a flex
                        item shrink past its content); the badges, time and
                        avatar hold their size. Without this a long full name
                        pushes the row wider than the card on narrow screens. */}
                    {event.player && (
                      <span className="text-xs text-grey-600 min-w-0 truncate">
                        {event.player.firstName} {event.player.lastName}
                      </span>
                    )}
                    {event.courtZone != null && (
                      <span className="badge shrink-0 bg-grey-50 text-navy-700 border border-grey-200">
                        Z{event.courtZone}
                      </span>
                    )}
                    {event.rotationNumber != null && (
                      <span className="badge shrink-0 bg-grey-50 text-navy-700 border border-grey-200">
                        R{event.rotationNumber}
                      </span>
                    )}
                    <span className="text-xs text-grey-600 shrink-0">
                      {format(new Date(event.recordedAt), 'HH:mm:ss')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
