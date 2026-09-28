import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { useMatch, useEvents, useHasPermission, useMyPlayerIds } from '../hooks';
import { EVENT_META, type Event, type EventMeta } from '../types';
import MatchPageHeader from '../components/ui/MatchPageHeader';
import { ChevronIcon, SearchIcon, SortIcon } from '../components/ui/icons';

// Light-mode, read-only changelog of a match's recorded events (Task 6).
// Available for a match in any status — unlike Track, which is live-only.
// Iteration: search + category filtering and a newest/oldest sort toggle,
// so a long match log is easy to scan instead of one big scroll (Task 7).

const META = new Map(EVENT_META.map((m) => [m.type, m]));

const OUTCOME_DOT: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'bg-success',
  negative: 'bg-error',
  neutral: 'bg-grey-400',
};

const CATEGORY_LABELS: Record<EventMeta['category'], string> = {
  attack: 'Attack',
  serve: 'Serve',
  pass: 'Pass',
  block: 'Block',
  defence: 'Defence',
  set: 'Set',
};

function actorLabel(e: Event, teamName?: string): string {
  if (e.player) return `#${e.player.jerseyNumber} ${e.player.firstName} ${e.player.lastName}`;
  if (e.isOpponentEvent) return e.opponentJerseyNumber != null ? `Opponent #${e.opponentJerseyNumber}` : 'Opponent';
  // Own-team event with the player redacted for a non-staff viewer (per-player
  // privacy rule) — attribute it to the team instead of showing a blank dash.
  return teamName ?? '—';
}

export default function MatchEventsPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const { data: match, isLoading: matchLoading } = useMatch(matchId!);
  const { data: events, isLoading: eventsLoading } = useEvents(matchId!);
  const canTrack = useHasPermission(match?.teamId ?? '', 'TRACK_MATCH');
  const myPlayerIds = useMyPlayerIds(!canTrack);
  const [openSets, setOpenSets] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<EventMeta['category'] | 'all'>('all');
  const [sort, setSort] = useState<'asc' | 'desc'>('asc');

  const hasActiveFilter = search.trim() !== '' || category !== 'all';

  // Filter first, then group — so a set with no matches simply disappears
  // instead of showing as an empty accordion.
  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (events ?? []).filter((e) => {
      const meta = META.get(e.eventType);
      if (category !== 'all' && meta?.category !== category) return false;
      if (q && !(meta?.label ?? e.eventType).toLowerCase().includes(q) && !actorLabel(e, match?.team?.name).toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [events, search, category, match?.team?.name]);

  if (matchLoading) return <p className="text-grey-600">Loading…</p>;
  if (!match) return <p className="text-error">Match not found.</p>;

  // Group events by set for readable section headers.
  const bySet = new Map<number, Event[]>();
  for (const e of filteredEvents) {
    if (!bySet.has(e.setNumber)) bySet.set(e.setNumber, []);
    bySet.get(e.setNumber)!.push(e);
  }
  for (const list of bySet.values()) {
    list.sort((a, b) => {
      const diff = new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime();
      return sort === 'asc' ? diff : -diff;
    });
  }
  const setNumbers = [...bySet.keys()].sort((a, b) => (sort === 'asc' ? a - b : b - a));
  const totalEventCount = events?.length ?? 0;
  const clearFilters = () => { setSearch(''); setCategory('all'); };
  // Every set starts collapsed so the changelog doesn't open as a wall of
  // history. Any active search/filter forces every matching set open so
  // results are visible without extra clicks.
  const isOpen = (setNo: number) => hasActiveFilter || (openSets[setNo] ?? false);
  const toggleSet = (setNo: number) => setOpenSets((prev) => ({ ...prev, [setNo]: !isOpen(setNo) }));
  // Mirrors PlayerStatsTable: clicking a player's row goes to that player's
  // game-day stats for this match. Opponent events have no player page, so
  // those fall back to the match dashboard. The player dashboard is for staff
  // and the player themself, so a player-linked row is clickable only for them.
  const canOpenEventTarget = (e: Event) => canTrack || !e.playerId || myPlayerIds.has(e.playerId);
  const goToEventTarget = (e: Event) =>
    navigate(e.playerId ? `/players/${e.playerId}/dashboard?matchId=${matchId}&teamId=${match.teamId}` : `/matches/${matchId}/dashboard`);

  return (
    <div className="space-y-6">
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

      {/* Total count — moved here off the match card (it's detail, not something
          the matches list needs to carry on every row). */}
      {!eventsLoading && totalEventCount > 0 && (
        <p className="text-xs text-grey-500 tabular-nums text-right">{totalEventCount} events total</p>
      )}

      {/* Filter + sort toolbar — only worth showing once there's something to sift through. */}
      {!eventsLoading && totalEventCount > 0 && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-grey-600 mb-1">Search</label>
            <div className="relative">
              <SearchIcon className="w-4 h-4 text-grey-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input text-sm pl-9"
                placeholder="Player or event type…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-40">
            <label className="block text-xs text-grey-600 mb-1">Type</label>
            <select className="input text-sm" value={category} onChange={(e) => setCategory(e.target.value as EventMeta['category'] | 'all')}>
              <option value="all">All types</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'asc' ? 'desc' : 'asc'))}
            className="btn-secondary text-sm py-2 px-3 flex items-center gap-1.5 shrink-0"
            title="Toggle chronological order"
          >
            <SortIcon className="w-4 h-4" />
            {sort === 'asc' ? 'Oldest first' : 'Newest first'}
          </button>
          {hasActiveFilter && (
            <button type="button" onClick={clearFilters} className="text-xs text-grey-600 hover:text-grey-900 transition-colors shrink-0">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Changelog */}
      {eventsLoading ? (
        <p className="text-grey-600 text-sm">Loading events…</p>
      ) : totalEventCount === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-grey-600">No events recorded for this match yet.</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <p className="text-grey-600">No events match your filters.</p>
          <button type="button" onClick={clearFilters} className="text-sm text-navy-700 hover:underline">Clear filters</button>
        </div>
      ) : (
        <div className="space-y-5">
          {setNumbers.map((setNo) => {
            const open = isOpen(setNo);
            return (
              <div key={setNo} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSet(setNo)}
                  aria-expanded={open}
                  className="w-full px-5 py-2.5 border-b border-grey-200 bg-grey-50 flex items-center justify-between hover:bg-grey-200 transition-colors"
                >
                  <h2 className="font-display font-semibold text-grey-900">Set {setNo}</h2>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-grey-600 tabular-nums">{bySet.get(setNo)!.length} events</span>
                    <ChevronIcon className={`w-4 h-4 text-grey-600 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </span>
                </button>
                {open && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="bg-grey-50 text-grey-600 text-xs border-b border-grey-200">
                        <tr>
                          <th className="text-left px-4 py-3">Player</th>
                          <th className="text-left px-4 py-3">Event</th>
                          <th className="text-center px-3 py-3">Rally</th>
                          <th className="text-center px-3 py-3">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-grey-200">
                        {bySet.get(setNo)!.map((e) => {
                          const meta = META.get(e.eventType);
                          const outcome = meta?.outcome ?? 'neutral';
                          const canOpen = canOpenEventTarget(e);
                          return (
                            <tr
                              key={e.id}
                              tabIndex={canOpen ? 0 : undefined}
                              onClick={canOpen ? () => goToEventTarget(e) : undefined}
                              onKeyDown={canOpen ? (ev) => { if (ev.key === 'Enter') goToEventTarget(e); } : undefined}
                              className={`transition-colors ${canOpen ? 'hover:bg-grey-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500' : ''}`}
                            >
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-3">
                                  {/* Same placeholder avatar as PlayerStatsTable — jersey
                                      number in a circle, greyed for opponent events. Kept
                                      even when there's no number so row height is uniform. */}
                                  <div
                                    className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                                      e.player ? 'bg-navy-100 text-navy-700' : 'bg-grey-200 text-grey-500'
                                    }`}
                                  >
                                    <span className="tabular-nums font-bold text-base">
                                      {e.player?.jerseyNumber ?? e.opponentJerseyNumber ?? '—'}
                                    </span>
                                  </div>
                                  <span className="font-medium text-grey-900 min-w-0">
                                    {e.player ? `${e.player.firstName} ${e.player.lastName}` : actorLabel(e, match.team?.name)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${OUTCOME_DOT[outcome]}`} aria-hidden />
                                  <span className="font-medium text-grey-900">{meta?.label ?? e.eventType}</span>
                                </div>
                              </td>
                              <td className="stat-cell text-grey-500">{e.rallyNumber ?? '—'}</td>
                              <td className="stat-cell text-grey-500">{format(new Date(e.recordedAt), 'HH:mm')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
