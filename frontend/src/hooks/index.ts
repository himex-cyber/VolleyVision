import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamsApi, playersApi, matchesApi, eventsApi, analyticsApi, membershipsApi, invitationsApi, joinCodesApi, profileApi, playerPortalApi, coachPortalApi, permissionsApi, videosApi, leagueApi, approvalApi, feedbackApi } from '../lib/api';
import type { TeamJoinCodeKind } from '../lib/api';
import type { CreateTeamInput } from '../lib/api';
import type { Player, Match, TeamRole, TeamMember, ApprovalStatus } from '../types';
import type { FeedbackStatus } from '../types/feedback';
import { useViewMode } from '../context/ViewModeContext';
import { PLAYER_VIEW_PERMISSIONS } from '../lib/teamRoles';

// ─── Feedback tab ─────────────────────────────────────────────────────────────

export function useMyFeedback() {
  return useQuery({ queryKey: ['feedback', 'mine'], queryFn: feedbackApi.listMine });
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
  return useQuery({
    queryKey: ['feedback', 'all', filters],
    queryFn: () => feedbackApi.listAll(filters),
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
    mutationFn: (data: Omit<Player, 'id' | 'createdAt' | 'updatedAt'>) =>
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

export function usePlayerAnalytics(playerId: string) {
  return useQuery({
    queryKey: ['analytics', 'player', playerId],
    queryFn: () => analyticsApi.player(playerId),
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

export function useMatchHeatmap(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'heatmap', 'match', matchId],
    queryFn: () => analyticsApi.matchHeatmap(matchId),
    enabled: !!matchId,
  });
}

export function useTeamHeatmap(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'heatmap', 'team', teamId],
    queryFn: () => analyticsApi.teamHeatmap(teamId),
    enabled: !!teamId,
  });
}

export function usePlayerHeatmap(playerId: string) {
  return useQuery({
    queryKey: ['analytics', 'heatmap', 'player', playerId],
    queryFn: () => analyticsApi.playerHeatmap(playerId),
    enabled: !!playerId,
  });
}

export function useMatchZoneDetail(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'match', matchId],
    queryFn: () => analyticsApi.matchZoneDetail(matchId),
    enabled: !!matchId,
  });
}

export function useTeamZoneDetail(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'team', teamId],
    queryFn: () => analyticsApi.teamZoneDetail(teamId),
    enabled: !!teamId,
  });
}

export function usePlayerZoneDetail(playerId: string) {
  return useQuery({
    queryKey: ['analytics', 'zones', 'player', playerId],
    queryFn: () => analyticsApi.playerZoneDetail(playerId),
    enabled: !!playerId,
  });
}

export function useMatchMomentum(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'momentum', matchId],
    queryFn: () => analyticsApi.matchMomentum(matchId),
    enabled: !!matchId,
  });
}

export function useMatchReport(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'report', matchId],
    queryFn: () => analyticsApi.matchReport(matchId),
    enabled: !!matchId,
  });
}

export function useMatchReportNarrative(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'report', 'narrative', matchId],
    queryFn: () => analyticsApi.matchReportNarrative(matchId),
    enabled: !!matchId,
    retry: false,
  });
}

export function useTeamRecommendations(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'recommendations', 'team', teamId],
    queryFn: () => analyticsApi.teamRecommendations(teamId),
    enabled: !!teamId,
  });
}

export function usePlayerDevelopmentReport(playerId: string) {
  return useQuery({
    queryKey: ['analytics', 'development', 'player', playerId],
    queryFn: () => analyticsApi.playerDevelopmentReport(playerId),
    enabled: !!playerId,
  });
}

export function useSeasonIntelligence(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'season-intelligence', 'team', teamId],
    queryFn: () => analyticsApi.seasonIntelligence(teamId),
    enabled: !!teamId,
  });
}

export function useTeamTrainingRecommendations(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'training-recommendations', 'team', teamId],
    queryFn: () => analyticsApi.teamTrainingRecommendations(teamId),
    enabled: !!teamId,
  });
}

export function useAskAssistant(teamId: string) {
  return useMutation({
    mutationFn: (question: string) => analyticsApi.askAssistant(teamId, question),
  });
}

export function useOpponentScoutingReport(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'opponent-report', 'match', matchId],
    queryFn: () => analyticsApi.opponentScoutingReport(matchId),
    enabled: !!matchId,
  });
}

// ─── Videos (Phase 7) ─────────────────────────────────────────────────────────
export function useMatchVideos(matchId: string, includePending = false) {
  return useQuery({
    queryKey: ['videos', 'match', matchId, includePending],
    queryFn: () => videosApi.listByMatch(matchId, includePending),
    enabled: !!matchId,
  });
}

/**
 * Three-step upload (intent → direct-to-storage PUT → confirm). `onProgress`
 * reports the middle step, which is where all the time goes.
 *
 * Invalidates on settle, not just on success: a failed upload still leaves a
 * row (FAILED), and staff viewing pending uploads should see it.
 */
export function useUploadVideo(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress, signal }: { file: File; onProgress?: (p: number) => void; signal?: AbortSignal }) =>
      videosApi.upload(matchId, file, { onProgress, signal }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] }),
  });
}

/**
 * Resume a PENDING upload. The browser no longer holds the original File after
 * a reload, so the user re-selects it and TUS matches it by fingerprint and
 * continues from the committed offset rather than starting over.
 */
export function useResumeUpload(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, file, onProgress, signal }: { videoId: string; file: File; onProgress?: (p: number) => void; signal?: AbortSignal }) =>
      videosApi.resumeUpload(videoId, file, { onProgress, signal }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] }),
  });
}

// ─── YouTube source, calibration, clips ───────────────────────────────────────

export function useLinkYouTubeVideo(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => videosApi.linkYouTube(matchId, url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] }),
  });
}

/**
 * Sync a video to match time. Invalidates clips too: recalibrating makes every
 * GENERATED clip's range stale, so the list the coach is looking at is no
 * longer trustworthy.
 */
export function useCalibrateVideo(matchId: string, videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (videoSeconds: number) => videosApi.calibrate(videoId, videoSeconds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] });
      qc.invalidateQueries({ queryKey: ['clips', videoId] });
    },
  });
}

/** Fire-and-forget: the player learns the duration once, and we persist it once. */
export function useSetVideoDuration(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ videoId, durationSeconds }: { videoId: string; durationSeconds: number }) =>
      videosApi.setDuration(videoId, durationSeconds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] }),
  });
}

export function useVideoClips(videoId: string | null) {
  return useQuery({
    queryKey: ['clips', videoId],
    queryFn: () => videosApi.listClips(videoId!),
    enabled: !!videoId,
  });
}

export function useGenerateClips(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filter?: { eventType?: string; playerId?: string; setNumber?: number }) =>
      videosApi.generateClips(videoId, filter),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', videoId] }),
  });
}

export function useClearGeneratedClips(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => videosApi.clearGeneratedClips(videoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', videoId] }),
  });
}

export function useCreateClip(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { startSeconds: number; endSeconds: number; label?: string }) =>
      videosApi.createClip(videoId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', videoId] }),
  });
}

export function useUpdateClip(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clipId, ...data }: { clipId: string; startSeconds?: number; endSeconds?: number; label?: string }) =>
      videosApi.updateClip(clipId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', videoId] }),
  });
}

export function useDeleteClip(videoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clipId: string) => videosApi.deleteClip(clipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clips', videoId] }),
  });
}

/**
 * Signed playback source, fetched per video rather than derived from a path.
 * The URL expires, so it is not cached beyond its own TTL and is never written
 * into a list payload.
 */
export function useVideoPlayback(videoId: string | null) {
  return useQuery({
    queryKey: ['videos', 'playback', videoId],
    queryFn: () => videosApi.getPlaybackSource(videoId!),
    enabled: !!videoId,
    // A signed URL is a wasting asset — don't serve a stale one from cache.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function useDeleteVideo(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) => videosApi.delete(videoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['videos', 'match', matchId] }),
  });
}

export function useMatchAdvanced(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'advanced', 'match', matchId],
    queryFn: () => analyticsApi.matchAdvanced(matchId),
    enabled: !!matchId,
  });
}

export function useTeamAdvanced(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'advanced', 'team', teamId],
    queryFn: () => analyticsApi.teamAdvanced(teamId),
    enabled: !!teamId,
  });
}

export function useMatchRotations(matchId: string) {
  return useQuery({
    queryKey: ['analytics', 'rotations', 'match', matchId],
    queryFn: () => analyticsApi.matchRotations(matchId),
    enabled: !!matchId,
  });
}

export function useTeamRotations(teamId: string) {
  return useQuery({
    queryKey: ['analytics', 'rotations', 'team', teamId],
    queryFn: () => analyticsApi.teamRotations(teamId),
    enabled: !!teamId,
  });
}

// ─── Memberships (Phase 5 Sprint 3) ──────────────────────────────────────────

export function useTeamMembers(teamId: string) {
  return useQuery({
    queryKey: ['members', teamId],
    queryFn: () => membershipsApi.listByTeam(teamId),
    enabled: !!teamId,
  });
}

export function useAddMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId: string; role: TeamRole }) =>
      membershipsApi.add(teamId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', teamId] });
      // Adding someone as PLAYER also creates their roster row server-side —
      // refresh the team so the Roster card picks it up without a reload.
      qc.invalidateQueries({ queryKey: ['teams', teamId] });
    },
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

export function useUserSearch(q: string) {
  return useQuery({
    queryKey: ['users', 'search', q],
    queryFn: () => membershipsApi.searchUsers(q),
    enabled: q.trim().length >= 2,
  });
}

// ─── Ownership (Phase 5 Sprint 2) ────────────────────────────────────────────

export function useMyTeams() {
  return useQuery({ queryKey: ['teams', 'my-teams'], queryFn: teamsApi.myTeams });
}

export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, newOwnerId }: { teamId: string; newOwnerId: string }) =>
      teamsApi.transfer(teamId, newOwnerId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['teams', vars.teamId] });
      qc.invalidateQueries({ queryKey: ['teams', 'my-teams'] });
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

export function useLinkPlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => playerPortalApi.linkPlayer(playerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player', 'dashboard'] }),
  });
}

export function useUnlinkPlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (playerId: string) => playerPortalApi.unlinkPlayer(playerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['player', 'dashboard'] }),
  });
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

/** Convenience: returns true if the user has the given permission on teamId */
export function useHasPermission(teamId: string, permission: string) {
  const { data } = useTeamRole(teamId);
  return data?.permissions.includes(permission) ?? false;
}

// ─── League Intelligence (Phase 7 Sprint 1) ───────────────────────────────────

export function useLeagues() {
  return useQuery({ queryKey: ['leagues'], queryFn: leagueApi.list });
}

export function useMyLeagueSeasons() {
  return useQuery({ queryKey: ['leagues', 'my'], queryFn: leagueApi.listMy });
}

export function useLeague(leagueId: string) {
  return useQuery({ queryKey: ['leagues', leagueId], queryFn: () => leagueApi.get(leagueId), enabled: !!leagueId });
}

export function useLeagueSeason(seasonId: string) {
  return useQuery({ queryKey: ['leagues', 'seasons', seasonId], queryFn: () => leagueApi.getSeason(seasonId), enabled: !!seasonId });
}

export function useSeasonFixtures(seasonId: string, filters?: import('../types').FixtureFilters) {
  return useQuery({
    queryKey: ['leagues', 'seasons', seasonId, 'fixtures', filters ?? {}],
    queryFn: () => leagueApi.listFixtures(seasonId, filters),
    enabled: !!seasonId,
  });
}

export function useCreateLeague() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; division?: string }) => leagueApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leagues'] }),
  });
}

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leagueId, ...data }: { leagueId: string; name: string; startDate: string; endDate?: string }) =>
      leagueApi.createSeason(leagueId, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['leagues', vars.leagueId] });
      qc.invalidateQueries({ queryKey: ['leagues'] });
    },
  });
}

export function useAddTeamToSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seasonId, teamId }: { seasonId: string; teamId: string }) => leagueApi.addTeam(seasonId, teamId),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['leagues', 'seasons', vars.seasonId] }),
  });
}

export function useCreateFixture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seasonId, ...data }: { seasonId: string; homeLeagueTeamId: string; awayLeagueTeamId: string; scheduledDate: string }) =>
      leagueApi.createFixture(seasonId, data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['leagues', 'seasons', vars.seasonId, 'fixtures'] }),
  });
}

export function useLinkMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fixtureId, matchId, side }: { fixtureId: string; matchId: string; side: 'home' | 'away' }) =>
      leagueApi.linkMatch(fixtureId, matchId, side),
    onSuccess: (data) => qc.invalidateQueries({ queryKey: ['leagues', 'seasons', data.leagueSeasonId, 'fixtures'] }),
  });
}

export function useLeagueTeamProfile(leagueTeamId: string) {
  return useQuery({
    queryKey: ['leagues', 'team-profile', leagueTeamId],
    queryFn: () => leagueApi.getTeamProfile(leagueTeamId),
    enabled: !!leagueTeamId,
  });
}

export function useMatchCentre(seasonId: string) {
  return useQuery({
    queryKey: ['leagues', 'seasons', seasonId, 'match-centre'],
    queryFn: () => leagueApi.getMatchCentre(seasonId),
    enabled: !!seasonId,
    refetchInterval: 20_000, // Poll every 20s — responsive without hammering the backend
  });
}

export function useSeasonRankings(seasonId: string) {
  return useQuery({
    queryKey: ['leagues', 'seasons', seasonId, 'rankings'],
    queryFn: () => leagueApi.getRankings(seasonId),
    enabled: !!seasonId,
  });
}

export function useSeasonStandings(seasonId: string) {
  return useQuery({
    queryKey: ['leagues', 'seasons', seasonId, 'standings'],
    queryFn: () => leagueApi.getStandings(seasonId),
    enabled: !!seasonId,
  });
}

export function useUnlinkMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fixtureId, side }: { fixtureId: string; side: 'home' | 'away' }) =>
      leagueApi.unlinkMatch(fixtureId, side),
    onSuccess: (data) => qc.invalidateQueries({ queryKey: ['leagues', 'seasons', data.leagueSeasonId, 'fixtures'] }),
  });
}