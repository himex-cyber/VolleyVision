import axios from 'axios';
import { getToken, clearToken } from './tokenStorage';
import { clearOfflineCache } from './offlineCache';
import { setLeaveGuard } from './leaveGuard';
import { isNative, nativePlatform } from './native';
import type { Team, Player, Match, Event, MatchAnalytics, TeamAnalytics, PlayerAnalytics, MatchReport, ZoneMap, RotationData, MomentumData, AdvancedMetrics, DateRange, User, AuthResponse, TeamOwner, TeamMember, TeamRole, UserTeamMembership, Invitation, UserProfile, PlayerBests, PlayerDashboard, PlayerRecord, CoachDashboard, PlayerTeamsResponse, PendingApproval, ApprovalRequest, ApprovalStatus } from '../types';
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

// Credential endpoints never get the stored JWT. Otherwise a mistyped password
// on /auth/login, sent while a valid session is stored, comes back 401 *with*
// an Authorization header, and the interceptor below mistakes it for a revoked
// session and logs the user out.
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email'];

// Attach stored JWT to every other request automatically
api.interceptors.request.use((config) => {
  // Which app build is calling: the API tags Sentry events with it and refuses
  // builds below its minimum version (426, backend lib/clientVersion).
  if (isNative()) config.headers['X-Client'] = `${nativePlatform()}/${import.meta.env.VITE_APP_VERSION ?? 'unknown'}`;
  const token = getToken();
  const isPublicAuth = PUBLIC_AUTH_PATHS.some((p) => config.url?.startsWith(p));
  if (token && !isPublicAuth) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Tokens are now revoked server-side after a password change, so a 401 can
// happen mid-session on any authenticated request, not just at login. Only
// treat it as a session revocation when the request actually carried a
// token; credential endpoints never do (see PUBLIC_AUTH_PATHS), so a bad
// password stays a normal per-form error instead of forcing a logout.
// The offline queue listens for any answer from the API: the device is
// reachable again (eventQueue.ts can't import from here the other way round).
let responseHook: (() => void) | null = null;
export function onApiResponse(fn: () => void): void {
  responseHook = fn;
}

api.interceptors.response.use(
  (res) => { responseHook?.(); return res; },
  (error) => {
    if (error.response) responseHook?.();
    const hadAuth = !!error.config?.headers?.Authorization;
    if (error.response?.status === 401 && hadAuth) {
      clearToken();
      // The offline queue (vv_queue:*) is kept: it flushes once the same user
      // signs back in. The cached user and rosters go.
      clearOfflineCache();
      // The tracker's "taps still waiting" prompt would otherwise stop this
      // redirect and leave the user signed out on the page.
      setLeaveGuard(null);
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);

/** True when a request failed because the caller's email isn't verified yet
 *  (join-team endpoints: accept invitation, redeem join code, claim player). */
export function isEmailNotVerifiedError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.data?.code === 'EMAIL_NOT_VERIFIED';
}

/** True when a request failed because of our own rate limiting (429) —
 *  used by resend-verification-email flows to show a distinct message. */
export function isRateLimitedError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

/** 426: this app build is below the API's minimum version (backend lib/clientVersion). */
export function isAppOutdatedError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 426;
}

/** Every mutation in this app surfaces backend errors the same way: the
 *  Express error middleware puts a user-facing string at response.data.error.
 *  One shared extractor instead of an `any`-typed destructure at every call site. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (isAppOutdatedError(err)) return 'This version of VolleyVision is out of date. Please update the app to keep going.';
  if (axios.isAxiosError(err)) {
    return (err.response?.data as { error?: string } | undefined)?.error ?? fallback;
  }
  return fallback;
}

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
  verifyEmail: (data: { token: string }) =>
    api.post<{ verified: true }>('/auth/verify-email', data).then((r) => r.data),
  // 204 (sent) comes back with empty body; 200 means already verified.
  resendVerification: () =>
    api.post<{ verified: true } | ''>('/auth/resend-verification').then((r) => r.data),
};

// ─── Teams ────────────────────────────────────────────────────────────────────
/** Ownership is assigned server-side from the authenticated caller. */
export type CreateTeamInput = {
  name: string;
  season: string;
  division?: string;
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
  transfer: (id: string, newOwnerEmail: string) =>
    api.post<Team>(`/teams/${id}/transfer`, { newOwnerEmail }).then((r) => r.data),
  // Phase 4 — staff-only player record linking (players can no longer self-link/unlink).
  linkPlayerRecord: (teamId: string, playerId: string, userId: string) =>
    api.post<Player>(`/teams/${teamId}/players/${playerId}/link`, { userId }).then((r) => r.data),
  unlinkPlayerRecord: (teamId: string, playerId: string) =>
    api.delete<Player>(`/teams/${teamId}/players/${playerId}/link`).then((r) => r.data),
};

// ─── Players ──────────────────────────────────────────────────────────────────
export const playersApi = {
  listByTeam: (teamId: string) =>
    api.get<Player[]>(`/players/by-team/${teamId}`).then((r) => r.data),
  get: (id: string) => api.get<Player>(`/players/${id}`).then((r) => r.data),
  // Mutations may return a 202 PendingApproval body when the actor is not a head coach.
  // userId is set later, via the player-portal link flow, not on creation.
  create: (data: Omit<Player, 'id' | 'createdAt' | 'updatedAt' | 'userId'>) =>
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
/** Absolutes are what installed apps send; the tracker sends deltas (8.0.1). */
export type ScoreUpdate = Partial<Pick<Match, 'homeScore' | 'awayScore' | 'homeSetsWon' | 'awaySetsWon'>> & {
  homeDelta?: number;
  awayDelta?: number;
};

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
  updateScore: (id: string, data: ScoreUpdate) =>
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
  // The queue's requests time out: a request hung on a wifi handoff would
  // hold the flush lock (the function itself is capped at 10 s).
  delete: (id: string) => api.delete(`/events/${id}`, { timeout: 30_000 }),
  /** The offline queue's sender (6.4): items run in order, each with its own outcome. */
  batch: (matchId: string, events: Array<Record<string, unknown> & { clientKey: string }>) =>
    api
      .post<{ results: Array<{ clientKey: string; status: 'created' | 'duplicate' | 'rejected' | 'retry'; event?: Event; error?: string }> }>(
        '/events/batch',
        { matchId, events },
        { timeout: 30_000 },
      )
      .then((r) => r.data.results),
};

// Only the sides that are set: no params at all means today's behaviour.
const rangeParams = (range?: DateRange) => ({
  ...(range?.from ? { from: range.from } : {}),
  ...(range?.to ? { to: range.to } : {}),
});

export const analyticsApi = {
  match: (matchId: string) =>
    api.get<MatchAnalytics>(`/analytics/matches/${matchId}`).then((r) => r.data),

  team: (teamId: string, range?: DateRange) =>
    api.get<TeamAnalytics>(`/analytics/teams/${teamId}`, { params: rangeParams(range) }).then((r) => r.data),

  // teamId scopes stats to that team's matches; defaults server-side to the
  // player's home team when omitted.
  player: (playerId: string, teamId?: string, range?: DateRange) =>
  api
    .get<PlayerAnalytics>(`/analytics/players/${playerId}`, { params: { ...(teamId ? { teamId } : {}), ...rangeParams(range) } })
    .then((r) => r.data),
    
  trends: (teamId: string, range?: DateRange) =>
    api.get<TeamTrend[]>(`/analytics/teams/${teamId}/trends`, { params: rangeParams(range) }).then((r) => r.data),

  matchReport: (matchId: string) =>
    api.get<MatchReport>(`/analytics/matches/${matchId}/report`).then((r) => r.data),

  matchZones: (matchId: string) =>
    api.get<ZoneMap>(`/analytics/matches/${matchId}/zones`).then((r) => r.data),

  teamZones: (teamId: string, range?: DateRange) =>
    api.get<ZoneMap>(`/analytics/teams/${teamId}/zones`, { params: rangeParams(range) }).then((r) => r.data),

  // Point flow (7.9): team-level, every member.
  matchRotations: (matchId: string) =>
    api.get<RotationData>(`/analytics/matches/${matchId}/rotations`).then((r) => r.data),
  teamRotations: (teamId: string, range?: DateRange) =>
    api.get<RotationData>(`/analytics/teams/${teamId}/rotations`, { params: rangeParams(range) }).then((r) => r.data),
  matchMomentum: (matchId: string) =>
    api.get<MomentumData>(`/analytics/matches/${matchId}/momentum`).then((r) => r.data),
  matchAdvanced: (matchId: string) =>
    api.get<AdvancedMetrics>(`/analytics/matches/${matchId}/advanced`).then((r) => r.data),
  teamAdvanced: (teamId: string, range?: DateRange) =>
    api.get<AdvancedMetrics>(`/analytics/teams/${teamId}/advanced`, { params: rangeParams(range) }).then((r) => r.data),

  // Staff, admin or the player themself; same team/match scoping as player().
  playerZones: (playerId: string, teamId?: string, matchId?: string, range?: DateRange) =>
    api
      .get<ZoneMap>(`/analytics/players/${playerId}/zones`, { params: { ...(teamId ? { teamId } : {}), ...(matchId ? { matchId } : { ...rangeParams(range) }) } })
      .then((r) => r.data),
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
  // Admin-only, and it always fails with a 500. That's the point: it's the
  // backend half of the Sentry check in components/feedback/SentryTestCard.
  // Body is {} not null: axios serialises null to the literal "null" under the
  // JSON content type, and express.json() (strict) rejects it with a 400
  // before the route runs, so the check never reached Sentry.
  sentryTest: (probe: string) => api.post('/feedback/sentry-test', {}, { params: { probe } }),
};

// ─── Memberships (Phase 5 Sprint 3) ──────────────────────────────────────────
export const membershipsApi = {
  listByTeam: (teamId: string) =>
    api.get<TeamMember[]>(`/teams/${teamId}/members`).then((r) => r.data),
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
  teams: () => api.get<PlayerRecord[]>('/player/teams').then((r) => r.data),
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
  /** Absent unless the caller has FULL_ACCESS on invitations; null = not generated yet. */
  staffJoinCode?: string | null;
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

export default api;
