import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import type { CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useMatch, useEvents, useRecordEvent, useUndoEvent, useUpdateScore, useResetSetScore, useResetMatch, useTeamRole, useEventQueue } from '../hooks';
import { useSyncTrackWatchRoute } from '../hooks/useSyncTrackWatchRoute';
import type { EventType, Player, Position } from '../types';
import { EVENT_META, POSITION_LABELS, POSITION_FULL_LABELS } from '../types';
import type { EventMeta } from '../types';
import clsx from 'clsx';
import CourtZoneSelector from '../components/tracking/CourtZoneSelector';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import LiveScoreboard from '../components/scoreboard/LiveScoreboard';
import type { ScoreSide } from '../components/scoreboard/LiveScoreboard';
import SyncBadge from '../components/tracking/SyncBadge';
import { QueueFullError } from '../lib/eventQueue';
import { provisionalScore, queueSummary } from '../lib/eventQueueCore';
import { scoringTeam } from '../lib/scoringRules';
import type { ServingSide } from '../types';
import type { QueueItem } from '../lib/eventQueueCore';
import { confirmLeave, leaveWarning, setLeaveGuard } from '../lib/leaveGuard';

// Another device's taps inside this window mean two people are tracking (6.11).
const OTHER_DEVICE_WINDOW_MS = 2 * 60 * 1000;

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

function getMeta(type: EventType): EventMeta {
  // A queued tap comes from device storage, possibly written by another app
  // build: an unknown type shows as itself rather than crashing the tracker.
  return EVENT_META.find((m) => m.type === type) ?? { type, label: type, outcome: 'neutral', category: 'attack' } as EventMeta;
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
  onRecord,
}: {
  justRecorded: string | null;
  onRecord: (type: EventType) => void;
}) {
  return (
    <div className="btn-event-split">
      {SPLIT_PASS_HALVES.map(({ type, grade }, i) => (
        <button
          key={type}
          onClick={() => onRecord(type)}
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
  // offline: the last copy of the match stays on the device, so a cold start
  // with no signal still shows the roster (6.6a).
  const { data: cachedOrLive, isLoading, error: matchError } = useMatch(matchId!, { offline: true });
  // The server said no (403/404): never keep showing the device's old copy.
  const refused = axios.isAxiosError(matchError) && [403, 404].includes(matchError.response?.status ?? 0);
  const match = refused ? undefined : cachedOrLive;
  const { data: events, isFetchedAfterMount: eventsFresh } = useEvents(matchId!);
  const recordEvent = useRecordEvent(matchId!);
  const { undo, isPending: undoPending } = useUndoEvent(matchId!);
  const queue = useEventQueue(matchId!);

  const updateScore = useUpdateScore(matchId!);
  const resetSetScore = useResetSetScore(matchId!);
  const resetMatch = useResetMatch(matchId!);
  // Track is offered only to those who can track a live match (players never
  // can — Iteration 3 Task 6); the shared header uses this to render the Track tab.
  const { data: role } = useTeamRole(match?.teamId ?? '');
  const canTrack = role?.permissions.includes('TRACK_MATCH') ?? false;
  // A role change mid-session moves you to the matching route. Not while the
  // role is unknown: offline, it may never load.
  useSyncTrackWatchRoute(matchId, match?.status, canTrack, role !== undefined);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  // The set the tracker points at: the one being played (from the server, or
  // the provisional state while taps are queued, 6.10), unless the coach has
  // jumped to another with the set buttons.
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  // Who is serving (7.2): sent with every tap so side-out and break-point are
  // real. Page state only; the queue carries each tap's own value. null asks
  // "Who serves first?". servingFor is the set it was decided in.
  const [serving, setServing] = useState<ServingSide | null>(null);
  const [servingFor, setServingFor] = useState<number | null>(null);
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

  // The score, set and sets won shown on the board: the server's, plus taps
  // still queued on this device (6.8). Provisional until they're confirmed.
  const board = useMemo(
    () => provisionalScore(
      {
        homeScore: match?.homeScore ?? 0,
        awayScore: match?.awayScore ?? 0,
        homeSetsWon: match?.homeSetsWon ?? 0,
        awaySetsWon: match?.awaySetsWon ?? 0,
        setScores: match?.setScores ?? [],
      },
      (events ?? []).map((e) => ({ id: e.id, clientKey: e.clientKey, eventType: e.eventType, isOpponentEvent: !!e.isOpponentEvent })),
      queue.items,
    ),
    [match?.homeScore, match?.awayScore, match?.homeSetsWon, match?.awaySetsWon, match?.setScores, events, queue.items],
  );
  const playingSet = Math.min(5, board.homeSetsWon + board.awaySetsWon + 1);
  const currentSet = selectedSet ?? playingSet;
  // When a set closes, follow the match into the next one.
  useEffect(() => { setSelectedSet(null); }, [playingSet]);

  // Serving at the start of a set, or on (re)load: whoever won the last point
  // of this set serves (a point won is the serve won); with no point yet, ask.
  // Once decided for a set, taps and corrections own it.
  useEffect(() => {
    // The first decision waits for a fresh event list (a stale or missing one
    // would read as a fresh set) unless offline, where the queue is all there
    // is. A later set change decides at once: a new set has no server points.
    const firstDecision = servingFor === null;
    if (!match || servingFor === playingSet || (firstDecision && !eventsFresh && !queue.offline)) return;
    const scored = [
      ...(events ?? []).map((e) => ({ eventType: e.eventType as string, isOpponentEvent: !!e.isOpponentEvent, setNumber: e.setNumber, at: e.recordedAt })),
      ...queue.items
        .filter((i) => i.op === 'create' && i.state !== 'rejected' && !i.undoRequested)
        .map((i) => ({ eventType: i.payload!.eventType, isOpponentEvent: !!i.payload!.isOpponentEvent, setNumber: i.payload!.setNumber, at: i.recordedAt })),
    ]
      .filter((e) => e.setNumber === playingSet && scoringTeam(e.eventType, e.isOpponentEvent))
      .sort((a, b) => a.at.localeCompare(b.at));
    const last = scored[scored.length - 1];
    setServing(last ? (scoringTeam(last.eventType, last.isOpponentEvent) === 'home' ? 'US' : 'THEM') : null);
    setServingFor(playingSet);
  }, [match, events, eventsFresh, queue.offline, queue.items, playingSet, servingFor]);

  const { waiting, rejected } = queueSummary(queue.items);

  // Leaving with taps still queued or not saved: they're kept (and queued
  // ones keep sending from the root flusher), but say so first (6.9).
  useEffect(() => {
    if (waiting === 0 && rejected === 0) return;
    const warning = rejected > 0
      ? `${rejected} ${rejected === 1 ? "tap wasn't" : "taps weren't"} saved. They stay on this tracker until you retry or discard them. Leave anyway?`
      : waiting === 1
        ? "1 tap hasn't been sent yet. It's kept on this device and sends when you're back online. Leave anyway?"
        : `${waiting} taps haven't been sent yet. They're kept on this device and send when you're back online. Leave anyway?`;
    setLeaveGuard(() => warning);
    // Checks the guard, not a closure: the 401 redirect clears it first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!leaveWarning()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [waiting, rejected]);

  function handleRecord(eventType: EventType) {
    if (!isOpponentMode && !selectedPlayer) {
      showFlash('Select a player first', false);
      return;
    }

    try {
      setJustRecorded(eventType);
      const meta = getMeta(eventType);
      const jerseyNum = opponentJerseyNumber.trim() !== '' ? parseInt(opponentJerseyNumber, 10) : null;
      // Queued on the device and sent in the background: the buttons never
      // wait for the network (6.7).
      // Serving belongs to the set being played; a fix-up tap in an earlier
      // set (after a set jump) carries none and doesn't move it.
      const inPlayingSet = currentSet === playingSet;
      recordEvent({
        servingSide: inPlayingSet ? serving : null,
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
      // The side that won the point serves next.
      const won = scoringTeam(eventType, isOpponentMode);
      if (won && inPlayingSet) setServing(won === 'home' ? 'US' : 'THEM');
      setTimeout(() => setJustRecorded(null), 300);
      if (!keepZone) setSelectedZone(null);
    } catch (err) {
      showFlash(
        err instanceof QueueFullError
          ? '2,000 taps are waiting to send. Reconnect before recording more.'
          : "Couldn't save that event",
        false,
      );
      setJustRecorded(null);
    }
  }

  async function handleUndo() {
    try {
      const undone = await undo();
      // A tap of ours that scored in the set being played: serving goes back
      // to what it was when that tap was made (null too: ask again). After
      // the server's undo-last we can't know what it removed, so leave it.
      const tap = undone?.payload
        ?? (undone?.serverId ? (events ?? []).find((e) => e.id === undone.serverId) : undefined);
      if (tap && tap.setNumber === playingSet && scoringTeam(tap.eventType, !!tap.isOpponentEvent)) {
        setServing(tap.servingSide ?? null);
      }
      showFlash('Undone', true);
    } catch (err) {
      const noConnection = queue.offline || (axios.isAxiosError(err) && !err.response);
      showFlash(noConnection ? 'Undo needs a connection for that one' : 'Nothing to undo', false);
    }
  }

  // Destructive — zeroes the current set's score and clears its manual
  // adjustment history, so confirm before doing it (consistent with the
  // Delete confirm in MatchesPage.tsx).
  // Manual score changes and resets wait for queued taps, so they land after
  // this device's own points rather than between them. (Undo goes through the
  // queue, so it never waits.)
  function tapsStillSaving(): boolean {
    if (waiting === 0) return false;
    showFlash('Wait for your taps to finish saving', false);
    return true;
  }

  // A reset puts the match under manual scoring for good (8.0.2): late taps
  // from other devices only add points, in the order they arrive, and no
  // replay can put them back in time order. Say so before it happens.
  const RESET_NOTE = 'From now on, taps still syncing from other devices are added as they arrive, and momentum for this match follows sync order.';

  function handleResetSetScore() {
    if (tapsStillSaving()) return;
    if (confirm(`Reset Set ${currentSet} to 0–0? This can't be undone. ${RESET_NOTE}`)) {
      resetSetScore.mutate();
    }
  }

  // Sent as a delta: the server applies it to the score it holds, so points
  // another device added since this one last fetched aren't overwritten.
  function handleScore(side: ScoreSide, delta: number) {
    if (tapsStillSaving()) return;
    updateScore.mutate(side === 'home' ? { homeDelta: delta } : { awayDelta: delta }, {
      // A point added by hand was won by that side, so they serve next, once
      // the server has taken it.
      onSuccess: () => { if (delta > 0) setServing(side === 'home' ? 'US' : 'THEM'); },
    });
  }

  // The most destructive action on this screen — wipes every set and the whole
  // score history, not just the current set. Same confirm pattern as above.
  async function handleResetMatch() {
    if (tapsStillSaving()) return;
    if (!confirm(`Reset the ENTIRE match? Every set score and set won will be cleared. Recorded stats are kept. This can't be undone. ${RESET_NOTE}`)) return;
    try {
      await resetMatch.mutateAsync();
      setSelectedSet(null);
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
      >
        {meta.label}
      </button>
    );
  }

  if (isLoading) return <p className="text-grey-600">Loading match…</p>;

  if (!match) {
    return (
      <p className="text-grey-600">
        {queue.offline && !refused
          ? "This match isn't saved on this device yet. Connect to open it."
          : 'Match not found.'}{' '}
        <Link to="/teams" className="text-navy-700 font-medium">Go back</Link>
      </p>
    );
  }

  // Live tracking is only for in-progress matches (Iteration 3 Task 6). A
  // scheduled/completed/cancelled match can't be live-edited — send the viewer
  // to the read-only Events changelog instead.
  if (match.status !== 'IN_PROGRESS') {
    return <Navigate to={`/matches/${matchId}/events`} replace />;
  }

  const players = match.team?.players ?? [];

  // Recent taps: this device's queued ones first (with a waiting or not-saved
  // mark), then the server's. Anything being undone is left out, and every
  // rejected tap is shown, never hidden past the fifth row.
  const serverKeys = new Set((events ?? []).map((e) => e.clientKey).filter(Boolean));
  // Only live deletes hide their event: a refused one leaves it on the server.
  const deleting = new Set(queue.items.filter((i) => i.op === 'delete' && i.state !== 'rejected').map((i) => i.serverId));
  const undoneKeys = new Set(queue.items.filter((i) => i.undoRequested).map((i) => i.clientKey));
  const pendingRows = queue.items
    .filter((i) => i.op === 'create' && !i.undoRequested && !serverKeys.has(i.clientKey))
    .reverse();
  const serverRows = [...(events ?? [])]
    .reverse()
    .filter((e) => !deleting.has(e.id) && !(e.clientKey && undoneKeys.has(e.clientKey)));
  // Refused undos show too, so every "not saved" in the badge has a row.
  const rejectedRows = [
    ...pendingRows.filter((i) => i.state === 'rejected'),
    ...queue.items.filter((i) => i.op === 'delete' && i.state === 'rejected'),
  ];
  const liveRows = [...pendingRows.filter((i) => i.state !== 'rejected'), ...serverRows].slice(0, Math.max(0, 5 - rejectedRows.length));
  const recentRows: Array<QueueItem | NonNullable<typeof events>[number]> = [...rejectedRows, ...liveRows];

  // Someone else tapping this match in the last two minutes: a key this
  // device never made (or none: the web, an older app).
  const otherDevice = (events ?? []).some(
    (e) => Date.now() - new Date(e.recordedAt).getTime() < OTHER_DEVICE_WINDOW_MS && !(e.clientKey && queue.myKeys.has(e.clientKey)),
  );

  // One in-flight score mutation is enough to freeze the board's controls —
  // double-tapping End Set or Reset Match while a request lands would apply twice.
  const scoreboardBusy =
    updateScore.isPending ||
    resetSetScore.isPending ||
    resetMatch.isPending ||
    undoPending;

  // Undo reaches into both action logs, so the button has to account for both:
  // a manual score tap writes a ScoreAdjustment, not an Event, and a match can
  // have adjustments with no stat events recorded yet. Offline, only this
  // device's own taps can be undone (the server's undo-last needs a connection).
  const canUndo =
    queue.canUndoLocally ||
    (!queue.offline && ((events?.length ?? 0) > 0 || (match._count?.scoreAdjustments ?? 0) > 0));

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

      {/* ── Sync status (6.9) ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <SyncBadge waiting={waiting} rejected={rejected} offline={queue.offline} stuck={queue.stuck} />
        {board.provisional && <span className="text-xs text-grey-600">Score shown includes taps still syncing.</span>}
      </div>
      {rejected > 1 && (
        <div className="card p-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-error-strong flex-1 min-w-0">
            {rejected} taps weren't saved. Retry them below, or discard them all.
          </span>
          <button
            onClick={() => { if (window.confirm(`Discard all ${rejected} taps that weren't saved? This cannot be undone.`)) queue.discardAll(); }}
            className="btn-secondary text-sm min-h-[44px] px-3"
          >
            Discard all
          </button>
        </div>
      )}
      {!queue.canPersist && (
        <p className="card p-3 text-sm text-error-strong">This device can't save offline. Stay connected while tracking.</p>
      )}
      {otherDevice && (
        <p className="card p-3 text-sm text-grey-900">
          Someone else is also tracking this match. Check you're not both recording the same rallies.
        </p>
      )}

      {/* ── Serving: Us / Them (7.2) ── */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-grey-600 font-medium shrink-0">
          {serving ? 'Serving:' : 'Who serves first?'}
        </span>
        <div className="flex rounded-lg overflow-hidden border border-grey-200 text-sm font-semibold" role="group" aria-label="Serving">
          {(['US', 'THEM'] as const).map((side) => (
            <button
              key={side}
              onClick={() => setServing(side)}
              aria-pressed={serving === side}
              className={clsx(
                'h-11 px-5 transition-colors',
                serving === side
                  ? side === 'US' ? 'bg-gold-500 text-navy-900' : 'bg-navy-700 text-white'
                  : 'bg-grey-50 text-grey-600 hover:bg-grey-200',
              )}
            >
              {side === 'US' ? 'Us' : 'Them'}
            </button>
          ))}
        </div>
        {!serving && (
          <span className="text-xs text-grey-600 min-w-0">Side-out % needs it. It follows each point after that.</span>
        )}
      </div>

      {/* ── Live Scoreboard + controls ── */}
      {/* Offline, taps and undo still work; manual score changes and resets
          need the server, so their controls aren't offered. */}
      <LiveScoreboard
        homeName={match.team?.name ?? 'Home'}
        awayName={match.opponent}
        homeScore={board.homeScore}
        awayScore={board.awayScore}
        homeSetsWon={board.homeSetsWon}
        awaySetsWon={board.awaySetsWon}
        status={match.status}
        currentSet={currentSet}
        onSelectSet={setSelectedSet}
        onScore={queue.offline ? undefined : handleScore}
        onResetSet={queue.offline ? undefined : handleResetSetScore}
        onResetMatch={queue.offline ? undefined : handleResetMatch}
        onUndoEvent={handleUndo}
        canUndoEvent={canUndo}
        busy={scoreboardBusy}
      />
      {queue.offline && (
        <p className="text-sm text-grey-600 -mt-3">
          Offline: taps and Undo still save on this device. Score changes and resets need a connection.
        </p>
      )}

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
        {recentRows.length > 0 && (
          <div className="card overflow-hidden mt-2">
            {/* The feed is only the last handful — the Events tab is the full log.
                Sized to the brand's h3 role (§3: 1.125rem / Inter 600, for
                sub-sections), so it reads as a section header rather than a caption. */}
            <Link
              to={`/matches/${matchId}/events`}
              onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}
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
              {recentRows.map((row) => {
                // A queued tap (still on this device) or a saved event.
                const queued = 'op' in row ? row : null;
                const saved = 'op' in row ? null : row;
                if (queued?.op === 'delete') {
                  return (
                    <div key={queued.clientKey} className="px-4 py-3 min-h-[60px] flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-error-strong flex-1 min-w-0">Undo not saved: {queued.error}</span>
                      <button onClick={() => queue.retry(queued.clientKey)} className="btn-secondary text-sm min-h-[44px] px-3">
                        Retry
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Discard this undo? The event stays recorded.')) queue.discard(queued.clientKey); }}
                        className="btn-secondary text-sm min-h-[44px] px-3"
                      >
                        Discard
                      </button>
                    </div>
                  );
                }
                const meta = getMeta((queued ? queued.payload!.eventType : saved!.eventType) as EventType);
                const setNumber = queued ? queued.payload!.setNumber : saved!.setNumber;
                const player = queued
                  ? players.find((pl) => pl.id === queued.payload!.playerId) ?? null
                  : saved!.player ?? null;
                const zone = queued ? queued.payload!.courtZone : saved!.courtZone;
                const rotation = queued ? queued.payload!.rotationNumber : saved!.rotationNumber;
                const at = queued ? queued.recordedAt : saved!.recordedAt;
                return (
                  // min-h matches an avatar row's height so opponent events —
                  // which have no player, and so no avatar — don't sit visibly
                  // shorter than the rows around them.
                  <div key={queued ? queued.clientKey : saved!.id} className="px-4 py-3 min-h-[60px]">
                    <div className="flex items-center gap-3">
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
                        S{setNumber}
                      </span>
                      <span className="text-sm font-medium text-grey-900 flex-1 min-w-0 truncate">
                        {meta.label}
                      </span>
                      {player && (
                        // Same jersey-in-a-circle placeholder as the Player
                        // Statistics table (StatsOverview.tsx), scaled down for a
                        // list row — structured so a real photoUrl can drop an
                        // <img> in here later without restructuring. It carries
                        // the jersey number, so the name beside it doesn't repeat it.
                        <div className="w-9 h-9 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center shrink-0">
                          <span className="tabular-nums font-bold text-xs">
                            {player.jerseyNumber}
                          </span>
                        </div>
                      )}
                      {/* The two text spans give way first (min-w-0 lets a flex
                          item shrink past its content); the badges, time and
                          avatar hold their size. Without this a long full name
                          pushes the row wider than the card on narrow screens. */}
                      {player && (
                        <span className="text-xs text-grey-600 min-w-0 truncate">
                          {player.firstName} {player.lastName}
                        </span>
                      )}
                      {zone != null && (
                        <span className="badge shrink-0 bg-grey-50 text-navy-700 border border-grey-200">
                          Z{zone}
                        </span>
                      )}
                      {rotation != null && (
                        <span className="badge shrink-0 bg-grey-50 text-navy-700 border border-grey-200">
                          R{rotation}
                        </span>
                      )}
                      {queued && queued.state !== 'rejected' && (
                        <span className="badge shrink-0 bg-gold-500/15 text-navy-900 border border-gold-500/40">waiting</span>
                      )}
                      <span className="text-xs text-grey-600 shrink-0">
                        {format(new Date(at), 'HH:mm:ss')}
                      </span>
                    </div>
                    {queued?.state === 'rejected' && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-error-strong flex-1 min-w-0">Not saved: {queued.error}</span>
                        <button
                          onClick={() => queue.retry(queued.clientKey)}
                          className="btn-secondary text-sm min-h-[44px] px-3"
                        >
                          Retry
                        </button>
                        <button
                          onClick={() => { if (window.confirm('Discard this tap? It was never saved, and this cannot be undone.')) queue.discard(queued.clientKey); }}
                          className="btn-secondary text-sm min-h-[44px] px-3"
                        >
                          Discard
                        </button>
                      </div>
                    )}
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
