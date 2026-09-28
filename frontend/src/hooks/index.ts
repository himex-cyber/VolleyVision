import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamsApi, playersApi, matchesApi, eventsApi, analyticsApi, membershipsApi, invitationsApi, joinCodesApi, profileApi, playerPortalApi, coachPortalApi, permissionsApi, approvalApi, feedbackApi, authApi } from '../lib/api';
import type { TeamJoinCodeKind } from '../lib/api';
import type { CreateTeamInput } from '../lib/api';
import type { Player, Match, TeamRole, TeamMember, ApprovalStatus } from '../types';
import type { FeedbackStatus } from '../types/feedback';
import { useViewMode } from '../context/ViewModeContext';
import { PLAYER_VIEW_PERMISSIONS } from '../lib/teamRoles';

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
 * it (see PlayerTeamLinksCard, PlayerPortalPage) is membership-scoped for free.
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => teamsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
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
  });
}

export function useMatch(id: string, options?: { live?: boolean }) {
  return useQuery({
    queryKey: ['match', id],
    queryFn: () => matchesApi.get(id),
    enabled: !!id,
    ...(options?.live ? { refetchInterval: 5000 } : {}),
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
    mutationFn: (data: Partial<Pick<Match, 'homeScore' | 'awayScore' | 'homeSetsWon' | 'awaySetsWon'>>) =>
      matchesApi.updateScore(matchId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match', matchId] }),
  });
}

export function useResetSetScore(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => matchesApi.resetSetScore(matchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match', matchId] }),
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

export function useRecordEvent(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: eventsApi.record,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', matchId] });
      qc.invalidateQueries({ queryKey: ['analytics', 'match', matchId] });
      // Scoring events increment homeScore/awayScore server-side; without this,
      // the live scoreboard (which reads useMatch) shows a stale score until
      // something else happens to trigger a refetch.
      qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

export function useUndoEvent(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => eventsApi.undoLast(matchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', matchId] });
      qc.invalidateQueries({ queryKey: ['analytics', 'match', matchId] });
      qc.invalidateQueries({ queryKey: ['match', matchId] });
    },
  });
}

export function useMatchAnalytics(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'match', matchId],
    queryFn: () => analyticsApi.match(matchId),
    enabled: !!matchId,
  });
}

export function useTeamAnalytics(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'team', teamId],
    queryFn: () => analyticsApi.team(teamId),
    enabled: !!teamId,
  });
}

export function usePlayerAnalytics(playerId: string, teamId?: string) {
  return useQuery({
    queryKey: ['analytics', 'player', playerId, teamId ?? null],
    queryFn: () => analyticsApi.player(playerId, teamId),
    enabled: !!playerId,
  });
}

export function useTeamTrends(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'trends', teamId],
    queryFn: () => analyticsApi.trends(teamId),
    enabled: !!teamId,
  });
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

export function useTeamZones(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'team', teamId],
    queryFn: () => analyticsApi.teamZones(teamId),
    enabled: !!teamId,
  });
}

export function usePlayerZones(playerId: string, teamId?: string, matchId?: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'player', playerId, teamId ?? null, matchId ?? null],
    queryFn: () => analyticsApi.playerZones(playerId, teamId, matchId),
    enabled: !!playerId,
  });
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
      qc.invalidateQueries({ queryKey: ['player', 'dashboard'] });
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
      qc.invalidateQueries({ queryKey: ['player', 'dashboard'] });
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
  const { viewMode } = useViewMode();
  const query = useQuery({
    queryKey: ['permissions', 'team', teamId],
    queryFn: () => permissionsApi.myTeamRole(teamId),
    enabled: !!teamId,
    staleTime: 60_000, // role changes are infrequent
  });

  // Presentation-only lens: while the Coach/Player toggle is set to "Player",
  // clamp the permissions the UI offers to TeamRole.PLAYER's real set. Every
  // gate (useHasPermission, PermissionGuard, TeamMembersCard) reads this hook,
  // so they all go read-only from one place. This never grants a permission
  // the user lacks — the backend remains the real authorization boundary.
  const data = useMemo(() => {
    if (!query.data || viewMode !== 'player') return query.data;
    return {
      ...query.data,
      permissions: query.data.permissions.filter((p) => PLAYER_VIEW_PERMISSIONS.has(p)),
    };
  }, [query.data, viewMode]);

  return { ...query, data };
}

/**
 * Ids of the roster entries linked to the signed-in user - their own player
 * records, whose individual stats they may open. Shares the player-portal
 * dashboard query (and its cache); `enabled` lets staff, who can open every
 * player anyway, skip the request.
 */
export function useMyPlayerIds(enabled = true) {
  const { data } = useQuery({ queryKey: ['player', 'dashboard'], queryFn: playerPortalApi.dashboard, enabled });
  return useMemo(() => new Set((data?.players ?? []).map((p) => p.id)), [data]);
}

/** Convenience: returns true if the user has the given permission on teamId */
export function useHasPermission(teamId: string, permission: string) {
  const { data } = useTeamRole(teamId);
  return data?.permissions.includes(permission) ?? false;
}

