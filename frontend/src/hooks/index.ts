import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { cacheMatch, cachedMatch, forgetMatch } from '../lib/offlineCache';
import { clearUndoHistory, deviceKeys, discardRejected, discardTap, enqueueTap, getQueue, hasLocalUndo, isOffline, queueCanPersist, retryTap, serverFailureCount, STUCK_AFTER, subscribeQueue, undoTap } from '../lib/eventQueue';
import type { QueuedEventPayload, QueueItem } from '../lib/eventQueueCore';
import { teamsApi, playersApi, matchesApi, eventsApi, analyticsApi, membershipsApi, invitationsApi, joinCodesApi, profileApi, playerPortalApi, coachPortalApi, permissionsApi, approvalApi, feedbackApi, authApi } from '../lib/api';
import type { TeamJoinCodeKind } from '../lib/api';
import type { CreateTeamInput, ScoreUpdate } from '../lib/api';
import type { Player, Match, TeamRole, TeamMember, ApprovalStatus, DateRange } from '../types';
import type { FeedbackStatus } from '../types/feedback';

// ─── Email verification ──────────────────────────────────────────────────────

export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
  });
}

// ─── Feedback tab ─────────────────────────────────────────────────────────────

export function useMyFeedback() {
  return useInfiniteQuery({
    queryKey: ['feedback', 'mine'],
    queryFn: ({ pageParam }) => feedbackApi.listMine(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useCreateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: feedbackApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'mine'] }),
  });
}

/** Admin panel only — the endpoint 403s for non-admins. */
export function useAllFeedback(filters: { status?: string; type?: string }, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['feedback', 'all', filters],
    queryFn: ({ pageParam }) => feedbackApi.listAll(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function useUpdateFeedbackStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { status?: FeedbackStatus; adminNotes?: string | null } }) =>
      feedbackApi.updateStatus(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'all'] }),
  });
}

// ─── Approval queue (Stabilization Pass 2) ───────────────────────────────────
export function useApprovalRequests(teamId: string, status?: ApprovalStatus, enabled = true) {
  return useQuery({
    queryKey: ['approvals', teamId, status],
    queryFn: () => approvalApi.listByTeam(teamId, status),
    enabled: enabled && !!teamId,
  });
}

export function useApproveRequest(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalApi.approve(id),
    onSuccess: () => {
      // The approved change was applied — refresh everything it could have touched.
      qc.invalidateQueries({ queryKey: ['approvals', teamId] });
      qc.invalidateQueries({ queryKey: ['players', teamId] });
      qc.invalidateQueries({ queryKey: ['matches', teamId] });
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
      qc.invalidateQueries({ queryKey: ['invitations', 'team', teamId] });
    },
  });
}

export function useRejectRequest(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvalApi.reject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals', teamId] }),
  });
}

// ─── Teams ────────────────────────────────────────────────────────────────────
/**
 * Every team the current user owns or belongs to. The backend scopes this to
 * the caller's memberships — there are no public teams — so any picker built on
 * it (see PlayerTeamLinksCard, MyStats) is membership-scoped for free.
 */
export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: teamsApi.list });
}

export function useTeam(id: string) {
  return useQuery({ queryKey: ['teams', id], queryFn: () => teamsApi.get(id), enabled: !!id });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTeamInput) => teamsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['coach', 'dashboard'] }); // the home page's team cards
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => teamsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['coach', 'dashboard'] }); // the home page's team cards
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateTeamInput> }) =>
      teamsApi.update(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', vars.id] });
    },
  });
}

// ─── Players ──────────────────────────────────────────────────────────────────
export function usePlayers(teamId: string) {
  return useQuery({
    queryKey: ['players', teamId],
    queryFn: () => playersApi.listByTeam(teamId),
    enabled: !!teamId,
  });
}

export function useCreatePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Player, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) =>
      playersApi.create(data),
    // Invalidate both the roster and the approval queue — a non-head-coach add
    // shows up as pending rather than in the roster.
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['players', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', vars.teamId] });
    },
  });
}

export function useDeletePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; teamId: string }) => playersApi.delete(vars.id),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['players', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', vars.teamId] });
    },
  });
}

export function useUpdatePlayer(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Player> }) =>
      playersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
      qc.invalidateQueries({ queryKey: ['players', teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', teamId] });
    },
  });
}

// ─── Player team links (Phase 7) ──────────────────────────────────────────────
export function usePlayerTeams(playerId: string) {
  return useQuery({
    queryKey: ['player-teams', playerId],
    queryFn: () => playersApi.getTeams(playerId),
    enabled: !!playerId,
  });
}

export function useAddPlayerTeamLink(playerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => playersApi.addTeamLink(playerId, teamId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-teams', playerId] }),
  });
}

export function useRemovePlayerTeamLink(playerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => playersApi.removeTeamLink(playerId, teamId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player-teams', playerId] }),
  });
}

// ─── Matches ──────────────────────────────────────────────────────────────────
export function useMatches(teamId: string, filters?: { opponent?: string; status?: string; from?: string; to?: string }) {
  return useQuery({
    queryKey: ['matches', teamId, filters],
    queryFn: () => matchesApi.listByTeam(teamId, filters),
    enabled: !!teamId,
    // A refusal (400 for a bad date range, 426 for an outdated app) comes back
    // the same every time; only a failure without an answer or a 5xx is retried.
    retry: (n, e) => !(axios.isAxiosError(e) && e.response && e.response.status < 500) && n < 1,
  });
}

/**
 * `offline` (the tracker): keep the last copy of this match on the device and
 * start from it, so a cold start with no signal still shows the roster
 * (6.6a). initialData, not placeholderData: it survives a failed refetch.
 */
export function useMatch(id: string, options?: { live?: boolean; offline?: boolean }) {
  return useQuery({
    queryKey: ['match', id],
    queryFn: options?.offline
      ? () => matchesApi.get(id).then(
          (m) => { cacheMatch(m); return m; },
          (err) => {
            // The server says no (removed from the team, match deleted): the
            // device's copy, roster included, goes too. The page treats the
            // error as not found rather than keep showing the old copy.
            if (axios.isAxiosError(err) && [403, 404].includes(err.response?.status ?? 0)) forgetMatch(id);
            throw err;
          },
        )
      : () => matchesApi.get(id),
    enabled: !!id,
    ...(options?.live ? { refetchInterval: 5000 } : {}),
    ...(options?.offline ? { initialData: () => cachedMatch(id), initialDataUpdatedAt: 0 } : {}),
  });
}

export function useCreateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Match, 'id' | 'createdAt' | 'updatedAt' | 'status'>) =>
      matchesApi.create(data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['matches', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', vars.teamId] });
    },
  });
}

export function useDeleteMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; teamId: string }) => matchesApi.delete(vars.id),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['matches', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', vars.teamId] });
    },
  });
}

export function useUpdateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Match> }) =>
      matchesApi.update(id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['match', vars.id] });
      qc.invalidateQueries({ queryKey: ['analytics', 'match', vars.id] });
      // Refresh any team's match-list cards so status/detail edits show at once.
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

export function useUpdateScore(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ScoreUpdate) =>
      matchesApi.updateScore(matchId, data),
    onSuccess: () => {
      // Undo must now reach this adjustment first: only the server's
      // undo-last knows about it (see clearUndoHistory).
      clearUndoHistory(matchId);
      qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

export function useResetSetScore(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => matchesApi.resetSetScore(matchId),
    onSuccess: () => {
      clearUndoHistory(matchId);
      qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

// Unlike a plain score tap, a match reset reopens the match and wipes its set
// history, so it also refreshes the analytics and match-list caches the way
// useUpdateMatch does.
export function useResetMatch(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => matchesApi.resetMatch(matchId),
    onSuccess: () => {
      clearUndoHistory(matchId);
      qc.invalidateQueries({ queryKey: ['match', matchId] });
      qc.invalidateQueries({ queryKey: ['analytics', 'match', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────
export function useEvents(matchId: string, setNumber?: number) {
  return useQuery({
    queryKey: ['events', matchId, setNumber],
    queryFn: () => eventsApi.listByMatch(matchId, setNumber),
    enabled: !!matchId,
    refetchInterval: 5000, // Live polling every 5s during a match
  });
}

/**
 * After a sync (not after each tap): the match, its events and every
 * analytics view of it. Keys like ['analytics','report',id] and
 * ['analytics','zones','match',id] don't start with ['analytics','match'],
 * so the whole prefix goes. Resolves once the score and events are fresh
 * (the queue waits for that); analytics refetch in the background, or a
 * backlog flush would wait on every dashboard query per batch.
 */
export function invalidateMatchData(qc: QueryClient, matchId: string) {
  void qc.invalidateQueries({ queryKey: ['analytics'] });
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['events', matchId] }),
    qc.invalidateQueries({ queryKey: ['match', matchId] }),
  ]);
}

const NO_ITEMS: QueueItem[] = [];

/** This user's queued taps for a match, and whether the device is offline. */
export function useEventQueue(matchId: string) {
  const { user } = useAuth();
  const items = useSyncExternalStore(subscribeQueue, () => (user ? getQueue(user.id, matchId) : NO_ITEMS));
  const offline = useSyncExternalStore(subscribeQueue, isOffline);
  const stuck = useSyncExternalStore(subscribeQueue, () => serverFailureCount(matchId)) >= STUCK_AFTER;
  const retry = useCallback((clientKey: string) => { if (user) retryTap(user.id, matchId, clientKey); }, [user, matchId]);
  const discard = useCallback((clientKey: string) => { if (user) discardTap(user.id, matchId, clientKey); }, [user, matchId]);
  const discardAll = useCallback(() => { if (user) discardRejected(user.id, matchId); }, [user, matchId]);
  return {
    items,
    offline,
    /** Five or more server errors in a row: the queue is retrying but not getting through. */
    stuck,
    canPersist: queueCanPersist(),
    /** Undo has a tap of ours to take back without the network. */
    canUndoLocally: user ? hasLocalUndo(user.id, matchId) : false,
    /** This device's keys on this match, for the two-device warning (6.11). */
    myKeys: user ? deviceKeys(user.id, matchId) : new Set<string>(),
    retry,
    discard,
    discardAll,
  };
}

/**
 * Record a tap. Always through the queue, online or offline (one code path);
 * it returns at once and the flush sends it. Throws QueueFullError at the cap.
 */
export function useRecordEvent(matchId: string) {
  const { user } = useAuth();
  return useCallback(
    (payload: QueuedEventPayload) => {
      if (!user) throw new Error('Sign in to record events.');
      enqueueTap(user.id, matchId, payload);
    },
    [user, matchId],
  );
}

/**
 * Undo this device's last tap through the queue (6.7). Only when this device
 * has nothing of its own to undo does it fall back to the server's undo-last,
 * which needs a connection.
 */
export function useUndoEvent(matchId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const online = useMutation({
    mutationFn: () => eventsApi.undoLast(matchId),
    onSuccess: () => invalidateMatchData(qc, matchId),
  });
  const { mutateAsync } = online;
  /** The tap taken back through the queue, or null after the server's undo-last. */
  const undo = useCallback(async (): Promise<{ payload?: QueuedEventPayload; serverId?: string } | null> => {
    const local = user ? undoTap(user.id, matchId) : null;
    if (local) return local;
    await mutateAsync();
    return null;
  }, [user, matchId, mutateAsync]);
  return { undo, isPending: online.isPending };
}

export function useMatchAnalytics(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'match', matchId],
    queryFn: () => analyticsApi.match(matchId),
    enabled: !!matchId,
  });
}

// The date range is the LAST key element (8.4), so ['analytics', 'team', id]
// still prefixes every range of that team (the sync flusher invalidates by
// ['analytics']).
const rangeKey = (range?: DateRange) => ({ from: range?.from ?? null, to: range?.to ?? null });

/**
 * A ranged query with the last result kept on screen while a new range loads:
 * the range is in the key, so `data` would go undefined and the dashboard
 * (with the date input being typed into) unmount on every change. Kept only
 * when nothing but the range changed: never another team's or player's data.
 */
function rangedQuery<T>(queryKey: unknown[], queryFn: () => Promise<T>, enabled: boolean) {
  const sameButRange = (key: readonly unknown[]) => JSON.stringify(key.slice(0, -1)) === JSON.stringify(queryKey.slice(0, -1));
  return {
    queryKey,
    queryFn,
    enabled,
    placeholderData: (prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }) =>
      (prevQuery && sameButRange(prevQuery.queryKey) ? prev : undefined),
  };
}

export function useTeamAnalytics(teamId: string, range?: DateRange) {
  return useQuery(rangedQuery(['analytics', 'team', teamId, rangeKey(range)], () => analyticsApi.team(teamId, range), !!teamId));
}

export function usePlayerAnalytics(playerId: string, teamId?: string, range?: DateRange) {
  return useQuery(rangedQuery(
    ['analytics', 'player', playerId, teamId ?? null, rangeKey(range)], () => analyticsApi.player(playerId, teamId, range), !!playerId,
  ));
}

export function useTeamTrends(teamId: string, range?: DateRange) {
  return useQuery(rangedQuery(['analytics', 'trends', teamId, rangeKey(range)], () => analyticsApi.trends(teamId, range), !!teamId));
}

export function useMatchReport(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'report', matchId],
    queryFn: () => analyticsApi.matchReport(matchId),
    enabled: !!matchId,
  });
}

export function useMatchZones(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'match', matchId],
    queryFn: () => analyticsApi.matchZones(matchId),
    enabled: !!matchId,
  });
}

// ─── Point flow (7.9) ─────────────────────────────────────────────────────────

// The range applies to the team scope only: a match has its one date.
export function useRotations(scope: 'match' | 'team', id: string, range?: DateRange) {
  return useQuery(rangedQuery(
    ['analytics', 'rotations', scope, id, scope === 'team' ? rangeKey(range) : null],
    () => (scope === 'match' ? analyticsApi.matchRotations(id) : analyticsApi.teamRotations(id, range)),
    !!id,
  ));
}

export function useMomentum(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'momentum', 'match', matchId],
    queryFn: () => analyticsApi.matchMomentum(matchId),
    enabled: !!matchId,
  });
}

export function useAdvancedMetrics(scope: 'match' | 'team', id: string, range?: DateRange) {
  return useQuery(rangedQuery(
    ['analytics', 'advanced', scope, id, scope === 'team' ? rangeKey(range) : null],
    () => (scope === 'match' ? analyticsApi.matchAdvanced(id) : analyticsApi.teamAdvanced(id, range)),
    !!id,
  ));
}

export function useTeamZones(teamId: string, range?: DateRange) {
  return useQuery(rangedQuery(['analytics', 'zones', 'team', teamId, rangeKey(range)], () => analyticsApi.teamZones(teamId, range), !!teamId));
}

// A matchId wins over the range, here as on the server.
export function usePlayerZones(playerId: string, teamId?: string, matchId?: string, range?: DateRange) {
  return useQuery(rangedQuery(
    ['analytics', 'zones', 'player', playerId, teamId ?? null, matchId ?? null, matchId ? null : rangeKey(range)],
    () => analyticsApi.playerZones(playerId, teamId, matchId, range),
    !!playerId,
  ));
}

// ─── Memberships (Phase 5 Sprint 3) ──────────────────────────────────────────

export function useTeamMembers(teamId: string, enabled = true) {
  return useQuery({
    queryKey: ['members', teamId],
    queryFn: () => membershipsApi.listByTeam(teamId),
    enabled: enabled && !!teamId,
  });
}

export function useUpdateMemberAccess(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, tiers }: {
      memberId: string;
      tiers: Partial<Pick<TeamMember, 'rosterAccess' | 'invitationAccess' | 'matchAccess'>>;
    }) => membershipsApi.updateAccess(teamId, memberId, tiers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', teamId] });
      // A tier change alters the member's effective permissions.
      qc.invalidateQueries({ queryKey: ['permissions', 'team', teamId] });
    },
  });
}

export function useUpdateMemberRole(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: TeamRole }) =>
      membershipsApi.updateRole(teamId, memberId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', teamId] });
      // Promoting to PLAYER also creates their roster row server-side.
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
      // A role change (e.g. the coach editing their own role) must be
      // reflected at once — useTeamRole/PermissionGuard read this key.
      qc.invalidateQueries({ queryKey: ['permissions', 'team', teamId] });
    },
  });
}

export function useRemoveMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => membershipsApi.remove(teamId, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', teamId] }),
  });
}

export function useMyMemberships() {
  return useQuery({
    queryKey: ['memberships', 'me'],
    queryFn: membershipsApi.myTeams,
  });
}

// ─── Ownership (Phase 5 Sprint 2) ────────────────────────────────────────────

export function useMyTeams() {
  return useQuery({ queryKey: ['teams', 'my-teams'], queryFn: teamsApi.myTeams });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, newOwnerEmail }: { teamId: string; newOwnerEmail: string }) =>
      teamsApi.transfer(teamId, newOwnerEmail),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['teams', 'my-teams'] });
      qc.invalidateQueries({ queryKey: ['coach', 'dashboard'] }); // the home page's team cards
    },
  });
}

// Phase 4 — staff-only player record linking, from the team roster
// (TeamDetailPage). Mirrors useUpdatePlayer's invalidation: the roster shown
// there comes from useTeam (['teams', teamId]), not usePlayers.
export function useLinkPlayerRecord(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playerId, userId }: { playerId: string; userId: string }) =>
      teamsApi.linkPlayerRecord(teamId, playerId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
      qc.invalidateQueries({ queryKey: ['players', teamId] });
      qc.invalidateQueries({ queryKey: ['player'] }); // records + portal
    },
  });
}

export function useUnlinkPlayerRecord(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => teamsApi.unlinkPlayerRecord(teamId, playerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
      qc.invalidateQueries({ queryKey: ['players', teamId] });
      qc.invalidateQueries({ queryKey: ['player'] }); // records + portal
    },
  });
}

// ─── Invitations (Phase 5 Sprint 4) ──────────────────────────────────────────

export function useTeamInvitations(teamId: string) {
  return useQuery({
    queryKey: ['invitations', 'team', teamId],
    queryFn: () => invitationsApi.listByTeam(teamId),
    enabled: !!teamId,
  });
}

export function useMyInvitations() {
  return useQuery({
    queryKey: ['invitations', 'me'],
    queryFn: invitationsApi.myInvitations,
  });
}

export function useCreateInvitation(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: TeamRole }) =>
      invitationsApi.create(teamId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations', 'team', teamId] });
      qc.invalidateQueries({ queryKey: ['approvals', teamId] });
    },
  });
}

// ─── Team join codes — reusable player/staff codes ───────────────────────────

export function useTeamJoinCodes(teamId: string) {
  return useQuery({
    queryKey: ['joinCodes', teamId],
    queryFn: () => joinCodesApi.get(teamId),
    enabled: !!teamId,
  });
}

export function useRegenerateJoinCode(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: TeamJoinCodeKind) => joinCodesApi.regenerate(teamId, kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['joinCodes', teamId] }),
  });
}

export function useLookupCode() {
  return useMutation({
    mutationFn: (code: string) => joinCodesApi.lookup(code),
  });
}

export function useRedeemTeamCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { code: string; role?: TeamRole }) => joinCodesApi.redeemTeamCode(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations', 'me'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['memberships', 'me'] });
    },
  });
}

export function useRedeemInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => invitationsApi.redeem(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations', 'me'] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['memberships', 'me'] });
    },
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => invitationsApi.accept(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitations', 'me'] });
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['memberships', 'me'] });
    },
  });
}

export function useDeclineInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => invitationsApi.decline(token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', 'me'] }),
  });
}

// ─── Profile (Phase 5 Sprint 5) ───────────────────────────────────────────────

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: profileApi.get });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: profileApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

// ─── Player Portal (Phase 5 Sprint 5) ────────────────────────────────────────

export function usePlayerDashboard() {
  return useQuery({ queryKey: ['player', 'dashboard'], queryFn: playerPortalApi.dashboard });
}

export function usePlayerBests() {
  return useQuery({ queryKey: ['player', 'bests'], queryFn: playerPortalApi.bests });
}

// ─── Coach Portal (Phase 5 Sprint 5) ─────────────────────────────────────────

export function useCoachDashboard() {
  return useQuery({ queryKey: ['coach', 'dashboard'], queryFn: coachPortalApi.dashboard });
}

// ─── Permissions (Phase 5 Sprint 6) ──────────────────────────────────────────

export function useTeamRole(teamId: string) {
  return useQuery({
    queryKey: ['permissions', 'team', teamId],
    queryFn: () => permissionsApi.myTeamRole(teamId),
    enabled: !!teamId,
    staleTime: 60_000, // role changes are infrequent
  });
}

/** The caller's linked player records only (GET /player/teams), without the portal's stats. */
export function useMyPlayerRecords(enabled = true) {
  return useQuery({ queryKey: ['player', 'records'], queryFn: playerPortalApi.teams, enabled });
}

export function useMyPlayerIds(enabled = true) {
  const { data } = useMyPlayerRecords(enabled);
  return useMemo(() => new Set((data ?? []).map((p) => p.id)), [data]);
}

/** Convenience: returns true if the user has the given permission on teamId */
export function useHasPermission(teamId: string, permission: string) {
  const { data } = useTeamRole(teamId);
  return data?.permissions.includes(permission) ?? false;
}

