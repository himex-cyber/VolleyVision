import axios from 'axios';
import * as tus from 'tus-js-client';
import { getToken } from './tokenStorage';
import type { Team, Player, Match, Event, MatchAnalytics, TeamAnalytics, PlayerAnalytics, HeatmapData, ZoneCounts, MomentumData, RotationData, AdvancedMetrics, MatchReport, User, AuthResponse, TeamOwner, TeamMember, TeamRole, UserTeamMembership, UserSearchResult, Invitation, UserProfile, PlayerBests, PlayerDashboard, CoachDashboard, DetailedHeatmapData, Recommendation, PlayerDevelopmentReport, SeasonIntelligenceReport, TrainingRecommendation, AssistantAnswer, PlayerTeamsResponse, Video, VideoUploadIntent, VideoUploadTarget, VideoPlaybackSource, VideoClip, CalibrationResult, ClipGenerationResult, PendingApproval, ApprovalRequest, ApprovalStatus } from '../types';
export interface TeamTrend {
  matchId: string;
  opponent: string;
  matchDate: string;
  kills: number;
  aces: number;
  blocks: number;
  digs: number;
  hittingPercentage: number | null;
}

// Base URL is env-configurable for non-proxied deployments (e.g. the future
// mobile client); defaults to /api/v1 so the Vite dev proxy keeps working.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

// Attach stored JWT to every request automatically
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { email: string; password: string; firstName: string; lastName: string; signupIntent?: string | null }) =>
    api.post<AuthResponse>('/auth/register', data).then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', data).then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  me: () => api.get<User>('/auth/me').then((r) => r.data),
  forgotPassword: (data: { email: string }) =>
    api.post<{ message: string }>('/auth/forgot-password', data).then((r) => r.data),
  resetPassword: (data: { token: string; password: string }) =>
    api.post<{ message: string }>('/auth/reset-password', data).then((r) => r.data),
};

// ─── Teams ────────────────────────────────────────────────────────────────────
/** Ownership is assigned server-side from the authenticated caller. */
export type CreateTeamInput = {
  name: string;
  season: string;
  division?: string;
  /** The team's current league season (Iteration 3). `null` clears it. */
  leagueSeasonId?: string | null;
};

export const teamsApi = {
  list: () => api.get<Team[]>('/teams').then((r) => r.data),
  get: (id: string) => api.get<Team>(`/teams/${id}`).then((r) => r.data),
  create: (data: CreateTeamInput) =>
    api.post<Team>('/teams', data).then((r) => r.data),
  update: (id: string, data: Partial<CreateTeamInput>) =>
    api.patch<Team>(`/teams/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/teams/${id}`),
  // Phase 5 Sprint 2 — ownership
  myTeams: () => api.get<Team[]>('/teams/my-teams').then((r) => r.data),
  owner: (id: string) => api.get<TeamOwner | null>(`/teams/${id}/owner`).then((r) => r.data),
  transfer: (id: string, newOwnerId: string) =>
    api.post<Team>(`/teams/${id}/transfer`, { newOwnerId }).then((r) => r.data),
};

// ─── Players ──────────────────────────────────────────────────────────────────
export const playersApi = {
  listByTeam: (teamId: string) =>
    api.get<Player[]>(`/players/by-team/${teamId}`).then((r) => r.data),
  get: (id: string) => api.get<Player>(`/players/${id}`).then((r) => r.data),
  // Mutations may return a 202 PendingApproval body when the actor is not a head coach.
  create: (data: Omit<Player, 'id' | 'createdAt' | 'updatedAt'>) =>
    api.post<Player | PendingApproval>('/players', data).then((r) => r.data),
  update: (id: string, data: Partial<Player>) =>
    api.patch<Player | PendingApproval>(`/players/${id}`, data).then((r) => r.data),
  delete: (id: string) =>
    api.delete<PendingApproval | ''>(`/players/${id}`).then((r) => r.data),
  // Phase 7 — multi-team links
  getTeams: (playerId: string) =>
    api.get<PlayerTeamsResponse>(`/players/${playerId}/teams`).then((r) => r.data),
  addTeamLink: (playerId: string, teamId: string) =>
    api.post(`/players/${playerId}/team-links`, { teamId }).then((r) => r.data),
  removeTeamLink: (playerId: string, teamId: string) =>
    api.delete(`/players/${playerId}/team-links/${teamId}`),
};

// ─── Matches ──────────────────────────────────────────────────────────────────
export const matchesApi = {
  listByTeam: (teamId: string, filters?: { opponent?: string; status?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (filters?.opponent) params.set('opponent', filters.opponent);
    if (filters?.status)   params.set('status', filters.status);
    if (filters?.from)     params.set('from', filters.from);
    if (filters?.to)       params.set('to', filters.to);
    const qs = params.toString();
    return api.get<Match[]>(`/matches/by-team/${teamId}${qs ? `?${qs}` : ''}`).then((r) => r.data);
  },
  get: (id: string) => api.get<Match>(`/matches/${id}`).then((r) => r.data),
  // Mutations may return a 202 PendingApproval body when the actor is not a head coach.
  create: (data: Omit<Match, 'id' | 'createdAt' | 'updatedAt' | 'status'>) =>
    api.post<Match | PendingApproval>('/matches', data).then((r) => r.data),
  update: (id: string, data: Partial<Match>) =>
    api.patch<Match | PendingApproval>(`/matches/${id}`, data).then((r) => r.data),
  delete: (id: string) =>
    api.delete<PendingApproval | ''>(`/matches/${id}`).then((r) => r.data),
  updateScore: (id: string, data: Partial<Pick<Match, 'homeScore' | 'awayScore' | 'homeSetsWon' | 'awaySetsWon'>>) =>
    api.patch<Match>(`/matches/${id}/score`, data).then((r) => r.data),
  resetSetScore: (id: string) =>
    api.post<Match>(`/matches/${id}/score/reset`).then((r) => r.data),
  // Clears sets won and the whole set history, unlike resetSetScore which only
  // zeroes the current set.
  resetMatch: (id: string) =>
    api.post<Match>(`/matches/${id}/score/reset-match`).then((r) => r.data),
};

// ─── Events ───────────────────────────────────────────────────────────────────
export const eventsApi = {
  listByMatch: (matchId: string, setNumber?: number) =>
    api
      .get<Event[]>(`/events/by-match/${matchId}`, {
        params: setNumber ? { setNumber } : {},
      })
      .then((r) => r.data),
  record: (data: {
    matchId: string;
    playerId?: string;
    eventType: string;
    setNumber: number;
    rallyNumber?: number;
    courtZone?: number | null;
    rotationNumber?: number | null;
    notes?: string;
    isOpponentEvent?: boolean;
    opponentJerseyNumber?: number | null;
  }) => api.post<Event>('/events', data).then((r) => r.data),
  undoLast: (matchId: string) =>
    api.delete<{ deleted: string }>(`/events/undo/${matchId}`).then((r) => r.data),
  delete: (id: string) => api.delete(`/events/${id}`),
};

export const analyticsApi = {
  match: (matchId: string) =>
    api.get<MatchAnalytics>(`/analytics/matches/${matchId}`).then((r) => r.data),

  team: (teamId: string) =>
    api.get<TeamAnalytics>(`/analytics/teams/${teamId}`).then((r) => r.data),

  player: (playerId: string) =>
  api
    .get<PlayerAnalytics>(`/analytics/players/${playerId}`)
    .then((r) => r.data),
    
  trends: (teamId: string) =>
    api.get<TeamTrend[]>(`/analytics/teams/${teamId}/trends`).then((r) => r.data),

  matchZones: (matchId: string, category?: string) =>
    api.get<ZoneCounts>(`/analytics/matches/${matchId}/zones`, {
      params: category ? { category } : {},
    }).then((r) => r.data),

  matchHeatmap: (matchId: string) =>
    api.get<HeatmapData>(`/analytics/matches/${matchId}/heatmap`).then((r) => r.data),

  teamHeatmap: (teamId: string) =>
    api.get<HeatmapData>(`/analytics/teams/${teamId}/heatmap`).then((r) => r.data),

  playerHeatmap: (playerId: string) =>
    api.get<HeatmapData>(`/analytics/players/${playerId}/heatmap`).then((r) => r.data),

  matchMomentum: (matchId: string) =>
    api.get<MomentumData>(`/analytics/matches/${matchId}/momentum`).then((r) => r.data),

  matchRotations: (matchId: string) =>
    api.get<RotationData>(`/analytics/matches/${matchId}/rotations`).then((r) => r.data),

  teamRotations: (teamId: string) =>
    api.get<RotationData>(`/analytics/teams/${teamId}/rotations`).then((r) => r.data),

  matchAdvanced: (matchId: string) =>
    api.get<AdvancedMetrics>(`/analytics/matches/${matchId}/advanced`).then((r) => r.data),

  teamAdvanced: (teamId: string) =>
    api.get<AdvancedMetrics>(`/analytics/teams/${teamId}/advanced`).then((r) => r.data),

  matchReport: (matchId: string) =>
    api.get<MatchReport>(`/analytics/matches/${matchId}/report`).then((r) => r.data),

  matchZoneDetail: (matchId: string) =>
    api.get<DetailedHeatmapData>(`/analytics/matches/${matchId}/heatmap/zones`).then((r) => r.data),

  teamZoneDetail: (teamId: string) =>
    api.get<DetailedHeatmapData>(`/analytics/teams/${teamId}/heatmap/zones`).then((r) => r.data),

  playerZoneDetail: (playerId: string) =>
    api.get<DetailedHeatmapData>(`/analytics/players/${playerId}/heatmap/zones`).then((r) => r.data),

  matchReportNarrative: (matchId: string) =>
    api.get<string>(`/analytics/matches/${matchId}/report/narrative`).then((r) => r.data),

  teamRecommendations: (teamId: string) =>
    api.get<Recommendation[]>(`/analytics/teams/${teamId}/recommendations`).then((r) => r.data),

  playerDevelopmentReport: (playerId: string) =>
    api.get<PlayerDevelopmentReport>(`/analytics/players/${playerId}/development`).then((r) => r.data),

  seasonIntelligence: (teamId: string) =>
    api.get<SeasonIntelligenceReport>(`/analytics/teams/${teamId}/season-intelligence`).then((r) => r.data),

  teamTrainingRecommendations: (teamId: string) =>
    api.get<TrainingRecommendation[]>(`/analytics/teams/${teamId}/training-recommendations`).then((r) => r.data),

  askAssistant: (teamId: string, question: string) =>
    api.post<AssistantAnswer>(`/analytics/teams/${teamId}/ask`, { question }).then((r) => r.data),

  opponentScoutingReport: (matchId: string) =>
    api.get<import('../types').OpponentScoutingResult>(`/analytics/matches/${matchId}/opponent-report`).then((r) => r.data),
};

// ─── Videos (Phase 7) ─────────────────────────────────────────────────────────
const UPLOAD_FAILED_MESSAGE = "Upload didn't finish. Check your connection and try again.";

/** Absolute endpoints go to a vendor; relative ones are our own proxy. */
function resolveUploadEndpoint(endpoint: string): string {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `${api.defaults.baseURL ?? ''}${endpoint}`;
}

/**
 * PUT the file straight to the storage vendor. Deliberately raw XHR, not the
 * axios instance: this request leaves our origin, so it must NOT carry the
 * Authorization interceptor's JWT — the presigned URL is its own credential.
 * XHR (not fetch) because only XHR reports upload progress, which is the whole
 * UX win of uploading direct.
 */
function uploadToPresignedUrl(
  upload: Extract<VideoUploadTarget, { protocol: 'http' }>,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.uploadUrl, true);
    for (const [k, v] of Object.entries(upload.headers ?? {})) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage rejected the upload (${xhr.status}).`));
    xhr.onerror = () => reject(new Error(UPLOAD_FAILED_MESSAGE));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());

    // Providers that need multipart (S3 POST policies) send `fields`; the
    // PUT providers we have today take the raw file body.
    if (upload.fields) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(upload.fields)) fd.append(k, v);
      fd.append('file', file);
      xhr.send(fd);
    } else {
      xhr.send(file);
    }
  });
}

/**
 * Resumable upload (tus.io). Supabase's single-request upload path is only
 * documented as reliable to 6 MB; TUS is what makes a match recording work at
 * all, and it means a dropped connection resumes at the last committed offset
 * instead of restarting from zero.
 *
 * When `endpoint` is relative it points at this app's own TUS proxy, which
 * exists so the storage credential never reaches the browser. That proxy
 * authorizes on our JWT, so it is attached here — tus-js-client issues raw XHRs
 * and does not go through the axios interceptor.
 */
async function uploadViaTus(
  upload: Extract<VideoUploadTarget, { protocol: 'tus' }>,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const tusUpload = new tus.Upload(file, {
    endpoint: resolveUploadEndpoint(upload.endpoint),
    chunkSize: upload.chunkSizeBytes,
    metadata: upload.metadata,
    headers: { ...upload.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    // Persists the fingerprint so an upload interrupted by a crash, a closed
    // tab, or a lost connection can be picked up later instead of restarted.
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    // Keyed on the object this upload was issued for, NOT on tus-js-client's
    // default (file name/type/size/mtime + endpoint). Every upload goes to the
    // same proxy endpoint, so the default fingerprint collides whenever the same
    // file is uploaded twice — and findPreviousUploads below would then resume
    // the new video row into the PREVIOUS row's object. Scoping to objectName
    // makes a fresh intent start at zero and a genuine resume find its own
    // offset, without either path needing to know which one it is.
    fingerprint: async () => `vv-video-${upload.metadata.objectName}`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    onProgress: (bytesSent, bytesTotal) => {
      if (onProgress && bytesTotal > 0) onProgress(Math.round((bytesSent / bytesTotal) * 100));
    },
  });

  // Resume rather than restart when this exact file was uploaded before.
  const previous = await tusUpload.findPreviousUploads();
  if (previous.length > 0) tusUpload.resumeFromPreviousUpload(previous[0]);

  return new Promise<void>((resolve, reject) => {
    tusUpload.options.onSuccess = () => resolve();
    tusUpload.options.onError = (err) => reject(err);
    signal?.addEventListener('abort', () => {
      void tusUpload.abort();
      reject(new Error('Upload cancelled.'));
    });
    tusUpload.start();
  });
}

/**
 * True when a TUS failure looks like an expired or rejected credential rather
 * than a network problem. Supabase's resumable token has a fixed two-hour
 * server-side life the API cannot extend, so a long upload on a slow line can
 * genuinely outlive it — that case is recoverable by re-crediting, and only
 * that case is worth an automatic retry.
 */
function isUploadCredentialError(err: unknown): boolean {
  const status = (err as { originalResponse?: { getStatus?: () => number } })?.originalResponse?.getStatus?.();
  return status === 401 || status === 403 || status === 410;
}

export const videosApi = {
  // includePending surfaces in-flight and failed uploads; the server ignores it
  // for anyone without TRACK_MATCH.
  listByMatch: (matchId: string, includePending = false) =>
    api
      .get<Video[]>(`/matches/${matchId}/videos`, { params: includePending ? { includePending: true } : undefined })
      .then((r) => r.data),

  createUploadIntent: (matchId: string, meta: { filename: string; contentType: string; sizeBytes: number }) =>
    api.post<VideoUploadIntent>(`/matches/${matchId}/videos/upload-intent`, meta).then((r) => r.data),

  completeUpload: (videoId: string) =>
    api.post<Video>(`/videos/${videoId}/complete`).then((r) => r.data),

  /** Signed URL + kind. Re-fetch when it expires rather than caching the URL. */
  getPlaybackSource: (videoId: string) =>
    api.get<VideoPlaybackSource>(`/videos/${videoId}/playback`).then((r) => r.data),

  /** Fresh upload credential for a video still PENDING, reusing the same object. */
  refreshUpload: (videoId: string) =>
    api.post<VideoUploadIntent>(`/videos/${videoId}/refresh-upload`).then((r) => r.data),

  /**
   * The whole upload: intent → bytes direct to storage → server-side
   * confirmation. The middle step is the only one carrying the bytes.
   *
   * On a credential failure it re-credentials once via refresh-upload and
   * resumes from the last offset. Exactly once — a loop here would hammer the
   * API while looking, to the user, like nothing is happening.
   */
  upload: async (
    matchId: string,
    file: File,
    opts?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<Video> => {
    const { videoId, upload } = await videosApi.createUploadIntent(matchId, {
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });

    try {
      await videosApi.sendBytes(upload, file, opts);
    } catch (err) {
      if (!isUploadCredentialError(err)) throw err;
      const refreshed = await videosApi.refreshUpload(videoId);
      await videosApi.sendBytes(refreshed.upload, file, opts);
    }

    return videosApi.completeUpload(videoId);
  },

  /**
   * Resume a PENDING upload the user started earlier — after a reload the File
   * object is gone, so they re-select it and TUS matches it by fingerprint and
   * continues from the committed offset.
   */
  resumeUpload: async (
    videoId: string,
    file: File,
    opts?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<Video> => {
    const { upload } = await videosApi.refreshUpload(videoId);
    await videosApi.sendBytes(upload, file, opts);
    return videosApi.completeUpload(videoId);
  },

  /** Protocol dispatch. Branches on what the server said, never on vendor name. */
  sendBytes: (
    upload: VideoUploadTarget,
    file: File,
    opts?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<void> =>
    upload.protocol === 'tus'
      ? uploadViaTus(upload, file, opts?.onProgress, opts?.signal)
      : uploadToPresignedUrl(upload, file, opts?.onProgress, opts?.signal),

  delete: (videoId: string) => api.delete(`/videos/${videoId}`),

  // ── YouTube source ─────────────────────────────────────────────────────────
  // No presign, no upload, no bytes. The coach pastes a link; YouTube keeps the
  // file and we keep the id.
  linkYouTube: (matchId: string, url: string) =>
    api.post<Video>(`/matches/${matchId}/videos/youtube`, { url }).then((r) => r.data),

  /** Anchor video time 0:00 by marking the first tracked event's moment. */
  calibrate: (videoId: string, videoSeconds: number) =>
    api.post<CalibrationResult>(`/videos/${videoId}/calibrate`, { videoSeconds }).then((r) => r.data),

  /** Reported once by the player — the IFrame API returns 0 until metadata loads. */
  setDuration: (videoId: string, durationSeconds: number) =>
    api.patch<Video>(`/videos/${videoId}/duration`, { durationSeconds }).then((r) => r.data),

  // ── Clips (time ranges, never files) ───────────────────────────────────────
  listClips: (videoId: string) =>
    api.get<VideoClip[]>(`/videos/${videoId}/clips`).then((r) => r.data),
  createClip: (videoId: string, data: { startSeconds: number; endSeconds: number; label?: string }) =>
    api.post<VideoClip>(`/videos/${videoId}/clips`, data).then((r) => r.data),
  generateClips: (videoId: string, filter?: { eventType?: string; playerId?: string; setNumber?: number }) =>
    api.post<ClipGenerationResult>(`/videos/${videoId}/clips/generate`, filter ?? {}).then((r) => r.data),
  /** After recalibration: GENERATED ranges are stale, MANUAL ones are not. */
  clearGeneratedClips: (videoId: string) =>
    api.delete<{ deleted: number }>(`/videos/${videoId}/clips/generated`).then((r) => r.data),
  updateClip: (clipId: string, data: { startSeconds?: number; endSeconds?: number; label?: string }) =>
    api.patch<VideoClip>(`/clips/${clipId}`, data).then((r) => r.data),
  deleteClip: (clipId: string) => api.delete(`/clips/${clipId}`),
};

// ─── Team Chat (foundation) ───────────────────────────────────────────────────
import type { ChatChannel, ChatMessage } from '../types';

export const chatApi = {
  getChannel: (teamId: string) =>
    api.get<ChatChannel>(`/teams/${teamId}/channel`).then((r) => r.data),
  listMessages: (channelId: string, params?: { limit?: number; before?: string; after?: string }) =>
    api.get<ChatMessage[]>(`/channels/${channelId}/messages`, { params }).then((r) => r.data),
  // idempotencyKey: reused verbatim on retry so a resend after a network blip
  // returns the already-created message instead of a duplicate.
  postMessage: (channelId: string, body: string, idempotencyKey?: string) =>
    api
      .post<ChatMessage>(`/channels/${channelId}/messages`, { body }, {
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
      .then((r) => r.data),
  uploadMessage: (
    channelId: string,
    data: { body?: string; files: File[]; idempotencyKey?: string; onProgress?: (percent: number) => void },
  ) => {
    const fd = new FormData();
    if (data.body) fd.append('body', data.body);
    for (const file of data.files) fd.append('files', file);
    return api
      .post<ChatMessage>(`/channels/${channelId}/messages/upload`, fd, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(data.idempotencyKey ? { 'Idempotency-Key': data.idempotencyKey } : {}),
        },
        onUploadProgress: (e) => {
          if (data.onProgress && e.total) data.onProgress(Math.round((e.loaded / e.total) * 100));
        },
      })
      .then((r) => r.data);
  },
  editMessage: (messageId: string, body: string) =>
    api.patch<ChatMessage>(`/messages/${messageId}`, { body }).then((r) => r.data),
  deleteMessage: (messageId: string) =>
    api.delete<ChatMessage>(`/messages/${messageId}`).then((r) => r.data),
};

// ─── Feedback tab ─────────────────────────────────────────────────────────────
import type { Feedback, FeedbackPage, FeedbackStatus } from '../types/feedback';

export const feedbackApi = {
  create: (data: {
    type: string;
    severity?: string;
    subject: string;
    description: string;
    pageContext?: string;
    files: File[];
  }) => {
    const fd = new FormData();
    fd.append('type', data.type);
    if (data.severity) fd.append('severity', data.severity);
    fd.append('subject', data.subject);
    fd.append('description', data.description);
    if (data.pageContext) fd.append('pageContext', data.pageContext);
    for (const file of data.files) fd.append('files', file);
    return api
      .post<Feedback>('/feedback', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  listMine: (cursor?: string) =>
    api.get<FeedbackPage>('/feedback/mine', { params: cursor ? { cursor } : undefined }).then((r) => r.data),
  // Admin-only — 403 for everyone else.
  listAll: (filters?: { status?: string; type?: string }, cursor?: string) => {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.type) params.type = filters.type;
    if (cursor) params.cursor = cursor;
    return api.get<FeedbackPage>('/feedback', { params }).then((r) => r.data);
  },
  updateStatus: (id: string, data: { status?: FeedbackStatus; adminNotes?: string | null }) =>
    api.patch<Feedback>(`/feedback/${id}`, data).then((r) => r.data),
  // Signed URL round-trip — owner or admin only.
  getAttachmentUrl: (feedbackId: string, attachmentId: string) =>
    api.get<{ url: string }>(`/feedback/${feedbackId}/attachments/${attachmentId}/url`).then((r) => r.data.url),
};

// ─── Memberships (Phase 5 Sprint 3) ──────────────────────────────────────────
export const membershipsApi = {
  listByTeam: (teamId: string) =>
    api.get<TeamMember[]>(`/teams/${teamId}/members`).then((r) => r.data),
  add: (teamId: string, data: { userId: string; role: TeamRole }) =>
    api.post<TeamMember>(`/teams/${teamId}/members`, data).then((r) => r.data),
  updateRole: (teamId: string, memberId: string, role: TeamRole) =>
    api.patch<TeamMember>(`/teams/${teamId}/members/${memberId}`, { role }).then((r) => r.data),
  // Iteration 3 — patch one or more access tiers, leaving role untouched.
  updateAccess: (
    teamId: string,
    memberId: string,
    tiers: Partial<Pick<TeamMember, 'rosterAccess' | 'invitationAccess' | 'matchAccess'>>,
  ) => api.patch<TeamMember>(`/teams/${teamId}/members/${memberId}`, tiers).then((r) => r.data),
  remove: (teamId: string, memberId: string) =>
    api.delete(`/teams/${teamId}/members/${memberId}`),
  myTeams: () => api.get<UserTeamMembership[]>('/users/me/teams').then((r) => r.data),
  searchUsers: (q: string) =>
    api.get<UserSearchResult[]>('/users/search', { params: { q } }).then((r) => r.data),
};

// ─── Permissions (Phase 5 Sprint 6) ──────────────────────────────────────────
export interface TeamRoleInfo {
  role: string | null;
  isOwner: boolean;
  permissions: string[];
}

export const permissionsApi = {
  myTeamRole: (teamId: string) =>
    api.get<TeamRoleInfo>(`/teams/${teamId}/my-role`).then((r) => r.data),
};

// ─── Profile (Phase 5 Sprint 5) ──────────────────────────────────────────────
export const profileApi = {
  get: () => api.get<UserProfile>('/profile').then((r) => r.data),
  update: (data: Partial<UserProfile>) =>
    api.patch<UserProfile>('/profile', data).then((r) => r.data),
};

// ─── Player Portal (Phase 5 Sprint 5) ────────────────────────────────────────
export const playerPortalApi = {
  dashboard: () => api.get<PlayerDashboard>('/player/dashboard').then((r) => r.data),
  stats: () => api.get('/player/stats').then((r) => r.data),
  bests: () => api.get<PlayerBests | null>('/player/bests').then((r) => r.data),
  teams: () => api.get('/player/teams').then((r) => r.data),
  linkPlayer: (playerId: string) =>
    api.post('/player/link', { playerId }).then((r) => r.data),
  unlinkPlayer: (playerId: string) =>
    api.delete(`/player/link/${playerId}`).then((r) => r.data),
};

// ─── Coach Portal (Phase 5 Sprint 5) ─────────────────────────────────────────
export const coachPortalApi = {
  dashboard: () => api.get<CoachDashboard>('/coach/dashboard').then((r) => r.data),
  teams: () => api.get('/coach/teams').then((r) => r.data),
  stats: () => api.get('/coach/stats').then((r) => r.data),
};

// ─── Invitations (Phase 5 Sprint 4) ──────────────────────────────────────────
export const invitationsApi = {
  listByTeam: (teamId: string) =>
    api.get<Invitation[]>(`/teams/${teamId}/invitations`).then((r) => r.data),
  create: (teamId: string, data: { email: string; role: TeamRole }) =>
    api.post<Invitation | PendingApproval>(`/teams/${teamId}/invitations`, data).then((r) => r.data),
  accept: (token: string) =>
    api.post<Invitation>(`/invitations/${token}/accept`).then((r) => r.data),
  decline: (token: string) =>
    api.post<Invitation>(`/invitations/${token}/decline`).then((r) => r.data),
  redeem: (code: string) =>
    api.post<Invitation>('/invitations/redeem', { code }).then((r) => r.data),
  myInvitations: () =>
    api.get<Invitation[]>('/users/me/invitations').then((r) => r.data),
};

// ─── Team join codes — reusable player/staff codes ───────────────────────────
export type TeamJoinCodeKind = 'PLAYER' | 'STAFF';

export interface TeamJoinCodes {
  playerJoinCode: string | null;
  staffJoinCode: string | null;
}

export type CodeLookupKind = 'EMAIL_INVITE' | 'TEAM_PLAYER' | 'TEAM_STAFF' | null;

export interface CodeLookupResult {
  kind: CodeLookupKind;
  teamName?: string;
}

export interface TeamCodeRedeemResult {
  team: { id: string; name: string };
  kind: 'PLAYER' | 'STAFF';
  role: TeamRole;
}

export const joinCodesApi = {
  get: (teamId: string) =>
    api.get<TeamJoinCodes>(`/teams/${teamId}/join-codes`).then((r) => r.data),
  regenerate: (teamId: string, kind: TeamJoinCodeKind) =>
    api.post<{ kind: TeamJoinCodeKind; code: string }>(`/teams/${teamId}/join-codes/regenerate`, { kind }).then((r) => r.data),
  lookup: (code: string) =>
    api.get<CodeLookupResult>(`/invitations/lookup/${encodeURIComponent(code)}`).then((r) => r.data),
  redeemTeamCode: (data: { code: string; role?: TeamRole }) =>
    api.post<TeamCodeRedeemResult>('/invitations/redeem-team-code', data).then((r) => r.data),
};

// ─── Approval queue (Stabilization Pass 2) ───────────────────────────────────
export const approvalApi = {
  listByTeam: (teamId: string, status?: ApprovalStatus) =>
    api.get<ApprovalRequest[]>(`/teams/${teamId}/approval-requests`, {
      params: status ? { status } : {},
    }).then((r) => r.data),
  approve: (id: string) =>
    api.post<ApprovalRequest>(`/approval-requests/${id}/approve`).then((r) => r.data),
  reject: (id: string) =>
    api.post<ApprovalRequest>(`/approval-requests/${id}/reject`).then((r) => r.data),
};

// ─── League Intelligence (Phase 7 Sprints 1-3) ───────────────────────────────
import type { League, LeagueSeason, LeagueMatch, StandingsResult, FixtureFilters, LeagueTeamProfile, LeagueRankings, MatchCentreData } from '../types';

export const leagueApi = {
  list: () =>
    api.get<League[]>('/leagues').then((r) => r.data),
  listMy: () =>
    api.get<LeagueSeason[]>('/leagues/my').then((r) => r.data),
  create: (data: { name: string; division?: string }) =>
    api.post<League>('/leagues', data).then((r) => r.data),
  get: (leagueId: string) =>
    api.get<League>(`/leagues/${leagueId}`).then((r) => r.data),

  createSeason: (leagueId: string, data: { name: string; startDate: string; endDate?: string }) =>
    api.post<LeagueSeason>(`/leagues/${leagueId}/seasons`, data).then((r) => r.data),
  getSeason: (seasonId: string) =>
    api.get<LeagueSeason>(`/leagues/seasons/${seasonId}`).then((r) => r.data),

  addTeam: (seasonId: string, teamId: string) =>
    api.post(`/leagues/seasons/${seasonId}/teams`, { teamId }).then((r) => r.data),
  removeTeam: (seasonId: string, leagueTeamId: string) =>
    api.delete(`/leagues/seasons/${seasonId}/teams/${leagueTeamId}`),

  listFixtures: (seasonId: string, filters?: FixtureFilters) => {
    const params: Record<string, string> = {};
    if (filters?.teamId) params.teamId = filters.teamId;
    if (filters?.from)   params.from   = filters.from;
    if (filters?.to)     params.to     = filters.to;
    if (filters?.status) params.status = filters.status;
    return api.get<LeagueMatch[]>(`/leagues/seasons/${seasonId}/fixtures`, { params }).then((r) => r.data);
  },
  createFixture: (seasonId: string, data: { homeLeagueTeamId: string; awayLeagueTeamId: string; scheduledDate: string }) =>
    api.post<LeagueMatch>(`/leagues/seasons/${seasonId}/fixtures`, data).then((r) => r.data),
  getFixture: (fixtureId: string) =>
    api.get<LeagueMatch>(`/leagues/fixtures/${fixtureId}`).then((r) => r.data),

  linkMatch: (fixtureId: string, matchId: string, side: 'home' | 'away') =>
    api.patch<LeagueMatch>(`/leagues/fixtures/${fixtureId}/link`, { matchId, side }).then((r) => r.data),
  unlinkMatch: (fixtureId: string, side: 'home' | 'away') =>
    api.patch<LeagueMatch>(`/leagues/fixtures/${fixtureId}/unlink`, { side }).then((r) => r.data),

  getStandings: (seasonId: string) =>
    api.get<StandingsResult>(`/leagues/seasons/${seasonId}/standings`).then((r) => r.data),

  getTeamProfile: (leagueTeamId: string) =>
    api.get<LeagueTeamProfile>(`/leagues/league-teams/${leagueTeamId}/profile`).then((r) => r.data),

  getRankings: (seasonId: string) =>
    api.get<LeagueRankings>(`/leagues/seasons/${seasonId}/rankings`).then((r) => r.data),

  getMatchCentre: (seasonId: string) =>
    api.get<MatchCentreData>(`/leagues/seasons/${seasonId}/match-centre`).then((r) => r.data),
};

export default api;
