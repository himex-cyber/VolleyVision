// Types mirror the Prisma schema. Keeping them in sync manually is fine for
// Phase 1. Phase 2 can introduce tRPC or OpenAPI codegen to automate this.

// ─── Auth (Phase 5 Sprint 1) ──────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'COACH' | 'PLAYER' | 'VIEWER';

export type TeamRole = 'HEAD_COACH' | 'MANAGER' | 'ASSISTANT_COACH' | 'STATISTICIAN' | 'PLAYER' | 'VIEWER';

// Iteration 3 — per-member access tier for the three tiered mutation categories.
export type AccessTier = 'VIEW_ONLY' | 'APPROVAL_REQUIRED' | 'FULL_ACCESS';
export type AccessCategory = 'rosterAccess' | 'invitationAccess' | 'matchAccess';

export interface TeamMember {
  id: string; // membership id
  role: TeamRole;
  joinedAt: string;
  rosterAccess: AccessTier;
  invitationAccess: AccessTier;
  matchAccess: AccessTier;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
    profileImage: string | null;
  };
}

export interface UserTeamMembership {
  id: string;
  role: TeamRole;
  joinedAt: string;
  team: {
    id: string;
    name: string;
    division?: string;
    season: string;
    ownerId?: string | null;
    leagueSeasonId?: string | null;
    _count?: { players: number; matches: number };
  };
}

// No `role`: the add-member lookup deliberately does not disclose a
// stranger's platform role, and nothing rendered it.
export interface UserSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

// ─── Profile (Phase 5 Sprint 5) ───────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  profileImage: string | null;
  bio: string | null;
  phoneNumber: string | null;
  dateOfBirth: string | null;
  city: string | null;
  country: string | null;
  heightCm: number | null;
  weightKg: number | null;
  preferredPosition: Position | null;
  createdAt: string;
}

// Career-best single-match performances (GET /player/bests)
export interface PlayerBestEntry {
  value: number;
  matchId: string;
  opponent: string;
  matchDate: string;
}

export interface PlayerBests {
  kills: PlayerBestEntry | null;
  aces: PlayerBestEntry | null;
  blocks: PlayerBestEntry | null;
  digs: PlayerBestEntry | null;
  hittingPercentage: PlayerBestEntry | null;
}

export interface PlayerRecord {
  id: string;
  firstName: string;
  lastName: string;
  jerseyNumber: number;
  position: Position;
  teamId: string;
  userId: string | null;
  team: { id: string; name: string; division: string | null; season: string };
}

// CareerStats mirrors StatLine — same shape, defined here so it can be referenced
// before StatLine is declared later in the file
export interface CareerStats {
  kills: number;
  attackAttempts: number;
  attackErrors: number;
  hittingPercentage: number | null;
  tips?: number;
  freeBalls?: number;
  aces: number;
  serviceErrors: number;
  serveAttempts: number;
  serveInPercentage: number | null;
  passAttempts: number;
  passingRating: number | null;
  soloBlocks: number;
  blockAssists: number;
  totalBlocks: number;
  blockErrors: number;
  digs: number;
  digErrors: number;
  assists: number;
  settingErrors: number;
  totalEvents: number;
}

export interface MatchSummaryItem {
  id: string;
  matchDate: string;
  opponent: string;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
  homeSetsWon: number;
  awaySetsWon: number;
  competition: string | null;
  team: { id: string; name: string };
}

export interface DevelopmentPoint extends CareerStats {
  matchId: string;
  opponent: string;
  matchDate: string;
}

export interface UpcomingMatchItem {
  id: string;
  matchDate: string;
  opponent: string;
  competition: string | null;
  venue: string | null;
  team: { id: string; name: string };
}

export interface TeamStatsBreakdown {
  playerId: string;
  team: { id: string; name: string; season: string };
  stats: CareerStats;
}

export interface PlayerDashboard {
  players: PlayerRecord[];
  careerStats: CareerStats | null;
  recentMatches: MatchSummaryItem[];
  developmentMetrics: DevelopmentPoint[];
  upcomingMatches: UpcomingMatchItem[];
  statsByTeam: TeamStatsBreakdown[];
}

export interface TeamSummary {
  id: string;
  name: string;
  division: string | null;
  season: string;
  _count: { players: number; matches: number };
  memberRole?: string;
}

export interface CoachingStats {
  teamsOwned: number;
  teamsCoached: number;
  totalMatches: number;
  wins: number;
  losses: number;
  winPercentage: number | null;
}

export interface CoachDashboard {
  ownedTeams: TeamSummary[];
  memberTeams: TeamSummary[];
  coachingStats: CoachingStats;
  recentMatches: MatchSummaryItem[];
  upcomingMatches: UpcomingMatchItem[];
}

// Phase 7 Sprint 0 — onboarding hint only. Never used for permission checks.
export type SignupIntent = 'COACH' | 'PLAYER' | 'UNSURE';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  profileImage: string | null;
  signupIntent?: SignupIntent | null;
  createdAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ─── Team Chat (foundation) ───────────────────────────────────────────────────

export interface ChatChannel {
  id: string;
  type: 'TEAM' | 'DIRECT';
  teamId: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSender {
  id: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
}

export interface ChatAttachment {
  id: string;
  kind: 'IMAGE' | 'FILE';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** Short-lived download URL minted per read; null = signing failed. On an
   *  optimistic (uploading) message this is a local object URL preview. */
  signedUrl: string | null;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string | null; // null = former member
  sender: ChatSender | null;
  body: string | null; // null = tombstone ("message deleted")
  attachments: ChatAttachment[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Client-only delivery state for optimistic sends; absent on server messages. */
  sendState?: 'sending' | 'failed';
  /** Client-only upload progress (0–100) while an attachment message sends. */
  uploadProgress?: number;
  /** Client-only server rejection message for a failed send (e.g. rate limit). */
  sendError?: string;
}

export type Position =
  | 'SETTER'
  | 'OUTSIDE_HITTER'
  | 'OPPOSITE'
  | 'MIDDLE_BLOCKER'
  | 'LIBERO'
  | 'DEFENSIVE_SPECIALIST';

export type EventType =
  // Attacking
  | 'KILL'
  | 'ATTACK_ERROR'
  | 'ATTACK_ATTEMPT'
  | 'TIP'
  | 'FREE_BALL'
  // Serving
  | 'ACE'
  | 'SERVICE_ERROR'
  | 'SERVE_IN'
  // Passing
  | 'PASS_3'
  | 'PASS_2'
  | 'PASS_1'
  | 'PASS_0'
  // Blocking
  | 'SOLO_BLOCK'
  | 'BLOCK_ASSIST'
  | 'BLOCK_ERROR'
  // Defence
  | 'DIG'
  | 'DIG_ERROR'
  // Setting
  | 'ASSIST'
  | 'SETTING_ERROR';

export type MatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface TeamOwner {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface Team {
  id: string;
  name: string;
  division?: string;
  season: string;
  // Every team has an owner — a team is only ever visible to its owner, its
  // accepted members, or a global ADMIN. There is no public-team concept.
  ownerId: string;
  owner?: TeamOwner | null;
  // Iteration 3 — the team's current league season (nullable). New matches
  // default their competition from it.
  leagueSeasonId?: string | null;
  leagueSeason?: TeamLeagueSeason | null;
  createdAt: string;
  updatedAt: string;
  _count?: { players: number; matches: number };
  players?: Player[];
  matches?: Match[];
}

export interface TeamLeagueSeason {
  id: string;
  name: string;
  league: { id: string; name: string; division: string | null };
}

/** Display label for a team's current league, e.g. "Coastal League · Div 1". */
export function leagueLabel(ls: TeamLeagueSeason | null | undefined): string | null {
  if (!ls) return null;
  return ls.league.division ? `${ls.league.name} · ${ls.league.division}` : ls.league.name;
}

// ─── Approval queue (Stabilization Pass 2) ───────────────────────────────────
// A non-head-coach mutation returns this 202 body instead of the created/updated
// resource — the change is queued for the head coach to approve.
export interface PendingApproval {
  status: 'pending_approval';
  requestId: string;
}

export function isPendingApproval(x: unknown): x is PendingApproval {
  return typeof x === 'object' && x !== null && (x as { status?: unknown }).status === 'pending_approval';
}

export type ApprovalAction =
  | 'PLAYER_CREATE' | 'PLAYER_UPDATE' | 'PLAYER_DELETE'
  | 'MATCH_CREATE' | 'MATCH_UPDATE' | 'MATCH_DELETE'
  | 'INVITATION_CREATE';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  id: string;
  teamId: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  targetId: string | null;
  requestedBy: { id: string; firstName: string; lastName: string; email: string };
  team: { id: string; name: string };
  resolvedAt: string | null;
  createdAt: string;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  jerseyNumber: number;
  position: Position;
  teamId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Match {
  id: string;
  matchDate: string;
  opponent: string;
  competition?: string;
  venue?: string;
  status: MatchStatus;
  teamId: string;
  team?: Team;
  setScores?: SetScore[];
  // Phase 4 Sprint 1 — live scoring (default 0 on new matches)
  homeScore?: number;
  awayScore?: number;
  homeSetsWon?: number;
  awaySetsWon?: number;
  createdAt: string;
  updatedAt: string;
  // scoreAdjustments (manual score taps) only comes back from GET /matches/:id;
  // list endpoints count events alone.
  _count?: { events: number; scoreAdjustments?: number };
}

export interface SetScore {
  set: number;
  home: number;
  away: number;
}

export type HeatmapData = Record<'attack' | 'serve' | 'pass' | 'block' | 'defence' | 'all', Record<string, number>>;
export type ZoneCounts = Record<string, number>;

export interface ZoneAttack  { kills: number; errors: number; attempts: number; hittingPct: number | null }
export interface ZoneServe   { aces: number; errors: number; serveIn: number; attempts: number; efficiency: number | null }
export interface ZonePass    { pass3: number; pass2: number; pass1: number; pass0: number; attempts: number; rating: number | null }
export interface ZoneDefence { digs: number; soloBlocks: number; blockAssists: number; total: number }
export interface DetailedHeatmapData {
  attack:  Record<string, ZoneAttack>;
  serve:   Record<string, ZoneServe>;
  pass:    Record<string, ZonePass>;
  defence: Record<string, ZoneDefence>;
}

export interface MatchReport {
  generatedAt: string;
  result: {
    teamName: string;
    opponent: string;
    homeSetsWon: number;
    awaySetsWon: number;
    winner: 'home' | 'away' | 'in_progress';
    resultText: string;
    setScores: { set: number; home: number; away: number }[];
  };
  topPerformer: {
    player: Pick<Player, 'firstName' | 'lastName' | 'jerseyNumber' | 'position'>;
    kills: number;
    aces: number;
    blocks: number;
    digs: number;
    assists: number;
  } | null;
  momentum: {
    longestRun: number;
    longestRunTeam: string;
    leadChanges: number;
    largestHomeLead: number;
    largestAwayLead: number;
  } | null;
  attack: {
    killRate: number | null;
    hittingPct: number | null;
    kills: number;
    errors: number;
    attempts: number;
  };
  serve: {
    aceRate: number | null;
    aces: number;
    attempts: number;
  };
  heatMapHighlight: string | null;
  bestRotation: {
    rotation: number;
    won: number;
    lost: number;
    net: number;
    efficiency: number | null;
  } | null;
}

export interface AdvancedMetrics {
  sideOut: {
    attempts: number;
    qualityPasses: number;
    efficiencyPct: number | null;
    perfectPassRate: number | null;
    pass3: number;
    pass2: number;
    pass1: number;
    pass0: number;
  };
  serve: {
    attempts: number;
    aces: number;
    errors: number;
    aceRate: number | null;
    errorRate: number | null;
    positiveRate: number | null;
  };
  attack: {
    attempts: number;
    kills: number;
    errors: number;
    killRate: number | null;
    hittingPct: number | null;
  };
  blocking: {
    soloBlocks: number;
    blockAssists: number;
    totalBlocks: number;
    blocksPerSet: number | null;
  };
  setsPlayed: number;
}

export interface RotationStat {
  rotation: number;
  won: number;
  lost: number;
  total: number;
  net: number;
  efficiency: number | null;
}

export interface RotationData {
  rotations: RotationStat[];
  insights: {
    best: RotationStat | null;
    worst: RotationStat | null;
    highestSideOut: RotationStat | null;
    lowestSideOut: RotationStat | null;
  };
}

export interface MomentumPoint {
  pointNumber: number;
  scorer: 'home' | 'away';
  homeScore: number;
  awayScore: number;
  lead: number;
  setNumber: number;
  runLength: number;
}

export interface MomentumData {
  timeline: MomentumPoint[];
  stats: {
    totalPoints: number;
    longestHomeRun: number;
    longestAwayRun: number;
    longestRun: number;
    leadChanges: number;
    largestHomeLead: number;
    largestAwayLead: number;
  };
  significantRuns: { team: 'home' | 'away'; length: number; startPoint: number }[];
}

export interface Event {
  id: string;
  eventType: EventType;
  setNumber: number;
  rallyNumber?: number;
  courtZone?: number | null;
  rotationNumber?: number | null;
  notes?: string;
  matchId: string | null;
  playerId: string | null;
  player?: Pick<Player, 'firstName' | 'lastName' | 'jerseyNumber'> | null;
  isOpponentEvent?: boolean;
  opponentJerseyNumber?: number | null;
  recordedAt: string;
}

export interface StatLine {
  totalEvents: number;
  kills: number;
  attackErrors: number;
  attackAttempts: number;
  hittingPercentage: number | null;
  tips?: number;
  freeBalls?: number;
  aces: number;
  serviceErrors: number;
  serveAttempts: number;
  serveInPercentage: number | null;
  passAttempts: number;
  passingRating: number | null;
  soloBlocks: number;
  blockAssists: number;
  totalBlocks: number;
  blockErrors: number;
  digs: number;
  digErrors: number;
  assists: number;
  settingErrors: number;
}

export interface PlayerStatLine extends StatLine {
  player: Pick<Player, 'id' | 'firstName' | 'lastName' | 'jerseyNumber' | 'position'>;
}

export interface MatchAnalytics {
  match: Pick<
    Match,
    'id' | 'matchDate' | 'opponent' | 'competition' | 'venue' | 'status' | 'setScores' | 'teamId'
  > & {
    teamName: string;
    homeScore: number;
    awayScore: number;
    homeSetsWon: number;
    awaySetsWon: number;
  };
  teamStats: StatLine;
  playerStats: PlayerStatLine[];
  setStats: Array<StatLine & { setNumber: number }>;
}

export interface TeamAnalytics {
  team: Pick<Team, 'id' | 'name' | 'division' | 'season'>;
  matchSummary: {
    total: number;
    completed: number;
    inProgress: number;
    scheduled: number;
  };
  teamStats: StatLine;
  playerStats: PlayerStatLine[];
}

export interface PlayerAnalytics {
  player: Pick<
    Player,
    'id' | 'firstName' | 'lastName' | 'jerseyNumber' | 'position' | 'teamId'
  >;

  matchId: string | null;

  stats: StatLine;

  setStats: Array<StatLine & { setNumber: number }>;
}

export interface TeamInsight {
  type: 'positive' | 'warning' | 'neutral';
  message: string;
}

// ─── Coaching Recommendations (Phase 6 Sprint 1) ─────────────────────────────

export interface Recommendation {
  category: 'attack' | 'serve' | 'pass' | 'defence' | 'rotation';
  priority: 'high' | 'medium' | 'low';
  message: string;
}

// ─── Player Development (Phase 6 Sprint 2) ───────────────────────────────────

export interface PlayerDevelopmentReport {
  strengths:      string[];
  weaknesses:     string[];
  mostImproved:   { category: string; change: string } | null;
  needsAttention: { category: string; change: string } | null;
  trend:          'improving' | 'declining' | 'stable' | 'insufficient_data';
}

// ─── Season Intelligence (Phase 6 Sprint 4) ──────────────────────────────────

export interface SeasonInsight {
  category: 'kills' | 'aces' | 'blocks' | 'digs' | 'hittingPercentage';
  message: string;
  direction: 'positive' | 'negative';
}

export interface SeasonIntelligenceReport {
  seasonAverages: {
    kills: number;
    aces: number;
    blocks: number;
    digs: number;
    hittingPercentage: number | null;
  };
  insights: SeasonInsight[];
  trajectory: 'improving' | 'declining' | 'mixed' | 'insufficient_data';
}

// ─── Phase 7 — Video upload & timestamp tagging ──────────────────────────────

/**
 * PENDING — presigned URL issued, bytes not yet confirmed by the server.
 * READY   — upload verified against the storage provider; playable.
 * FAILED  — the object never arrived, or came in over the size cap.
 */
export type VideoStatus = 'PENDING' | 'READY' | 'FAILED';

/**
 * UPLOAD  — presigned direct-to-storage; we own the bytes. Dormant.
 * YOUTUBE — a coach-provided link, embedded. YouTube owns everything.
 */
export type VideoSource = 'UPLOAD' | 'YOUTUBE';

export interface Video {
  id:               string;
  matchId:          string;
  source:           VideoSource;
  /** Upload-only; null on a YouTube row, which has no file. */
  filename:         string | null;
  /** Legacy on-disk path; null for everything uploaded since presigned storage. */
  filePath:         string | null;
  /** Upload-only; null on a YouTube row. */
  mimeType:         string | null;
  status:           VideoStatus;
  sizeBytes:        number | null;
  durationSeconds:  number | null;
  /** YouTube-only. Never render this as a link — embed it. */
  youtubeVideoId:   string | null;
  /** YouTube title at link time, or a coach-supplied label. */
  title:            string | null;
  /**
   * Real-world instant of video time 0:00. Null until the coach syncs the video
   * to the match; without it, tracked events cannot be placed in the footage.
   */
  recordingStartedAt: string | null;
  uploadedAt:       string;
  uploadedByUserId: string;
}

/** MANUAL survives recalibration; GENERATED does not — its range came from the old anchor. */
export type ClipOrigin = 'MANUAL' | 'GENERATED';

/**
 * A time range in a video. Never a file — a YouTube embed is a cross-origin
 * iframe, so nothing can be cut or exported. Playing a clip means seeking
 * between two numbers.
 */
export interface VideoClip {
  id:              string;
  videoId:         string;
  startSeconds:    number;
  endSeconds:      number;
  label:           string;
  eventId:         string | null;
  origin:          ClipOrigin;
  createdByUserId: string;
  createdAt:       string;
  event?: { id: string; eventType: string; setNumber: number } | null;
}

/** Result of syncing a video to match time. */
export interface CalibrationResult {
  video:             { id: string; recordingStartedAt: string | null; durationSeconds: number | null };
  matchedEvents:     number;
  eventsOutsideVideo: number;
}

/** Result of generating clips from tracked events. */
export interface ClipGenerationResult {
  created:            number;
  skippedExisting:    number;
  eventsOutsideVideo: number;
}

/**
 * Step 1 of the upload. `upload.uploadUrl` points at the storage vendor, not at
 * our API — the browser PUTs the bytes there directly, because a Netlify
 * Function caps a request payload at ~6 MB and a match video is far larger.
 * The provider's storage key is deliberately absent; it stays server-side.
 */
export interface VideoUploadIntent {
  videoId: string;
  upload: VideoUploadTarget;
}

/**
 * How to deliver the bytes. A discriminated union so the client branches on the
 * protocol the server states, never on which vendor is configured.
 */
export type VideoUploadTarget =
  /** One request, no resume. Small files and S3 POST-policy providers. */
  | {
      protocol:  'http';
      uploadUrl: string;
      method:    'PUT' | 'POST';
      headers?:  Record<string, string>;
      fields?:   Record<string, string>;
      expiresAt: string;
    }
  /**
   * Resumable and chunked (tus.io). `endpoint` may be relative, in which case
   * it is a same-origin proxy on this API — the arrangement that keeps a
   * server-only storage credential off the client.
   */
  | {
      protocol:       'tus';
      endpoint:       string;
      headers:        Record<string, string>;
      metadata:       Record<string, string>;
      chunkSizeBytes: number;
      expiresAt:      string;
    };

/**
 * Where and how to play a video. `kind` is what lets an adaptive-bitrate
 * provider (Cloudflare Stream, Mux) drop in later without reshaping the player:
 * 'file' is a direct MP4/WebM, 'hls' is a manifest needing an HLS player.
 */
export interface VideoPlaybackSource {
  url:        string;
  kind:       'file' | 'hls';
  expiresAt:  string;
  posterUrl?: string;
}

// ─── Phase 7 — Multi-team player links ───────────────────────────────────────

export interface TeamSummary {
  id:       string;
  name:     string;
  division: string | null;
  season:   string;
}

export interface PlayerTeamLink {
  linkId:   string;
  team:     TeamSummary;
  linkedAt: string;
}

export interface PlayerTeamsResponse {
  homeTeam:    TeamSummary;
  linkedTeams: PlayerTeamLink[];
}

// ─── Phase 6 Sprint 5 — Training Recommendations ─────────────────────────────

export interface TrainingRecommendation {
  focus:         string;
  category:      'attack' | 'serve' | 'pass' | 'defence' | 'rotation' | 'player_development';
  allocationPct: number;
  rationale:     string;
}

export interface AssistantAnswer {
  matchedIntent: string | null;
  answer:        string;
}

// ─── Event metadata (UI helpers) ─────────────────────────────────────────────

export interface EventMeta {
  type: EventType;
  label: string;
  category: 'attack' | 'serve' | 'pass' | 'block' | 'defence' | 'set';
  // positive = adds a point / good outcome; negative = error; neutral = attempt
  outcome: 'positive' | 'negative' | 'neutral';
}

export const EVENT_META: EventMeta[] = [
  // Attacking
  { type: 'KILL', label: 'Kill', category: 'attack', outcome: 'positive' },
  { type: 'ATTACK_ERROR', label: 'Attack Error', category: 'attack', outcome: 'negative' },
  { type: 'ATTACK_ATTEMPT', label: 'Attempt', category: 'attack', outcome: 'neutral' },
  { type: 'TIP', label: 'Tip', category: 'attack', outcome: 'neutral' },
  { type: 'FREE_BALL', label: 'Free Ball', category: 'attack', outcome: 'neutral' },
  // Serving
  { type: 'ACE', label: 'Ace', category: 'serve', outcome: 'positive' },
  { type: 'SERVICE_ERROR', label: 'Service Error', category: 'serve', outcome: 'negative' },
  { type: 'SERVE_IN', label: 'Serve In', category: 'serve', outcome: 'neutral' },
  // Passing. The 0–3 rating scale is what the passing analytics are built on
  // (ZonePass in backend/src/lib/heatmap.ts counts each grade separately), so
  // these stay four distinct values.
  //
  // Grades 2 and 1 keep their numbered labels HERE on purpose: this label is
  // what the Events log, Watch page, Recent Events feed and the post-record
  // flash all render, and collapsing both to "Pass" would make the two grades
  // indistinguishable in every one of them. The tracker presents them as one
  // split button labelled "Pass" with a corner grade tag — that is a button
  // presentation concern, handled in TrackingPage, not a data one.
  { type: 'PASS_3', label: 'Dime Pass', category: 'pass', outcome: 'positive' },
  { type: 'PASS_2', label: 'Pass 2', category: 'pass', outcome: 'neutral' },
  { type: 'PASS_1', label: 'Pass 1', category: 'pass', outcome: 'neutral' },
  { type: 'PASS_0', label: 'Shank Pass', category: 'pass', outcome: 'negative' },
  // Blocking
  { type: 'SOLO_BLOCK', label: 'Roof', category: 'block', outcome: 'positive' },
  { type: 'BLOCK_ASSIST', label: 'Block Assist', category: 'block', outcome: 'positive' },
  { type: 'BLOCK_ERROR', label: 'Block Error', category: 'block', outcome: 'negative' },
  // Defence
  { type: 'DIG', label: 'Dig', category: 'defence', outcome: 'positive' },
  { type: 'DIG_ERROR', label: 'Dig Error', category: 'defence', outcome: 'negative' },
  // Setting
  { type: 'ASSIST', label: 'Assist', category: 'set', outcome: 'positive' },
  // "Setting Error" rather than "Set Error" — this screen already uses "Set"
  // for the match set, so the short form reads ambiguously.
  { type: 'SETTING_ERROR', label: 'Setting Error', category: 'set', outcome: 'negative' },
];

/** Abbreviations — for genuinely tight spaces only (tracking screen, stat table columns). */
export const POSITION_LABELS: Record<Position, string> = {
  SETTER: 'S',
  OUTSIDE_HITTER: 'OH',
  OPPOSITE: 'OPP',
  MIDDLE_BLOCKER: 'MB',
  LIBERO: 'L',
  DEFENSIVE_SPECIALIST: 'DS',
};

/** Full names — preferred anywhere there's room to spell the position out. */
export const POSITION_FULL_LABELS: Record<Position, string> = {
  SETTER: 'Setter',
  OUTSIDE_HITTER: 'Outside Hitter',
  OPPOSITE: 'Opposite',
  MIDDLE_BLOCKER: 'Middle Blocker',
  LIBERO: 'Libero',
  DEFENSIVE_SPECIALIST: 'Defensive Specialist',
};

/**
 * Categorical badge styling — one distinct colour per position, so a roster is
 * scannable at a glance. Previously three groups shared by six positions, which
 * made Opposite/Middle Blocker/Outside Hitter indistinguishable.
 *
 * A position is not a judgement, so success/error/warning stay out — those read
 * as good/bad. `info` is used purely as the categorical blue from the brand
 * doc's 6-colour chart sequence (§2), not with its semantic meaning; violet and
 * steel come from that same sequence.
 */
export const POSITION_BADGE: Record<Position, string> = {
  SETTER: 'badge-brand',
  OUTSIDE_HITTER: 'badge-accent',
  OPPOSITE: 'badge-steel',
  MIDDLE_BLOCKER: 'badge-violet',
  LIBERO: 'badge-info',
  DEFENSIVE_SPECIALIST: 'badge-neutral',
};

// ─── Invitations (Phase 5 Sprint 4) ──────────────────────────────────────────

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export interface Invitation {
  id: string;
  email: string;
  teamId: string;
  invitedById: string;
  role: TeamRole;
  status: InvitationStatus;
  token: string;
  // Stabilization Pass 2 — join code + email-delivery status (present on newly created invitations)
  joinCode?: string | null;
  emailSent?: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  team?: { id: string; name: string; division?: string; season: string };
  invitedBy?: { id: string; firstName: string; lastName: string; email: string };
}

// ─── Opponent Scouting (Phase 6 Sprint 3) ────────────────────────────────────

export interface JerseyTally {
  jerseyNumber: number;
  kills: number;
  aces: number;
  errors: number;
}

export interface OpponentScoutingReport {
  insufficientData: false;
  totalEvents: number;
  zoneBreakdown: {
    attack: Record<string, { kills: number; errors: number; attempts: number; hittingPct: number | null }>;
    serve: Record<string, { aces: number; errors: number; serveIn: number; attempts: number; efficiency: number | null }>;
    pass: Record<string, { pass3: number; pass2: number; pass1: number; pass0: number; attempts: number; rating: number | null }>;
    defence: Record<string, { digs: number; soloBlocks: number; blockAssists: number; total: number }>;
  };
  dominantErrorType: string | null;
  dominantErrorCount: number;
  jerseyTallies: JerseyTally[] | null;
}

export interface OpponentScoutingInsufficient {
  insufficientData: true;
  totalEvents: number;
}

export type OpponentScoutingResult = OpponentScoutingReport | OpponentScoutingInsufficient;

// ─── Phase 7 Sprint 1 — League Intelligence ───────────────────────────────────

export interface LeagueTeamSummary {
  id: string;
  teamId: string;
  team: { id: string; name: string; division?: string; season: string };
}

export interface MatchSummary {
  id: string;
  matchDate: string;
  homeScore: number;
  awayScore: number;
  homeSetsWon: number;
  awaySetsWon: number;
  status: MatchStatus;
}

export interface LeagueMatch {
  id: string;
  leagueSeasonId: string;
  scheduledDate: string;
  homeLeagueTeam: LeagueTeamSummary;
  awayLeagueTeam: LeagueTeamSummary;
  homeMatchId: string | null;
  awayMatchId: string | null;
  homeMatch: MatchSummary | null;
  awayMatch: MatchSummary | null;
  createdAt: string;
}

export interface LeagueSeasonSummary {
  id: string;
  leagueId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  _count: { teams: number; fixtures: number };
}

export interface League {
  id: string;
  name: string;
  division: string | null;
  createdByUserId: string;
  createdAt: string;
  seasons: LeagueSeasonSummary[];
}

// Resolved result for a single fixture — encapsulates the home/away-naming translation.
export interface ResolvedFixtureResult {
  fixtureId: string;
  played: boolean;
  /** Sets won by the *fixture's* home LeagueTeam (not the Match owner) */
  homeSetsWon: number;
  /** Sets won by the *fixture's* away LeagueTeam */
  awaySetsWon: number;
  hasDiscrepancy: boolean;
}

export interface FixtureFilters {
  teamId?: string;
  from?: string;
  to?: string;
  status?: 'upcoming' | 'pending' | 'completed';
}

export interface StandingsRow {
  leagueTeamId: string;
  teamId: string;
  teamName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  setDifferential: number;
  points: number;
}

export interface LeagueTeamRecentResult {
  fixtureId: string;
  scheduledDate: string;
  opponentName: string;
  result: 'W' | 'L';
  homeSetsWon: number;
  awaySetsWon: number;
  isHome: boolean;
  hasDiscrepancy: boolean;
}

export interface LeagueTeamUpcomingFixture {
  fixtureId: string;
  scheduledDate: string;
  opponentName: string;
  isHome: boolean;
}

export interface PrivateIntel {
  heatmapUrl: string;
  recentMatchReports: Array<{
    matchId: string;
    matchDate: string;
    opponent: string;
    reportUrl: string;
    narrativeUrl: string;
  }>;
}

export interface LeagueTeamProfile {
  leagueTeamId: string;
  teamId: string;
  teamName: string;
  division: string | null;
  season: string;
  standing: StandingsRow | null;
  winLossTrend: ('W' | 'L')[];
  recentResults: LeagueTeamRecentResult[];
  upcomingFixtures: LeagueTeamUpcomingFixture[];
  privateIntel?: PrivateIntel;
}

// ─── Match Centre ──────────────────────────────────────────────────────────────

export interface LiveFixture {
  fixtureId: string;
  isLive: true;
  scheduledDate: string;
  homeTeam: string;
  awayTeam: string;
  homeLeagueTeamId: string;
  awayLeagueTeamId: string;
  currentSet: number;
  homeSetScore: number;
  awaySetScore: number;
  homeSetsWon: number;
  awaySetsWon: number;
  sourceMatchId: string | null;
}

export interface RecentlyFinishedFixture {
  fixtureId: string;
  scheduledDate: string;
  homeTeam: string;
  awayTeam: string;
  homeLeagueTeamId: string;
  awayLeagueTeamId: string;
  homeSetsWon: number;
  awaySetsWon: number;
  hasDiscrepancy: boolean;
}

export interface UpcomingFixtureSummary {
  fixtureId: string;
  scheduledDate: string;
  homeTeam: string;
  awayTeam: string;
  homeLeagueTeamId: string;
  awayLeagueTeamId: string;
}

export interface MatchCentreData {
  live: LiveFixture[];
  recentlyFinished: RecentlyFinishedFixture[];
  upcoming: UpcomingFixtureSummary[];
}

export interface TeamRankingEntry {
  leagueTeamId: string;
  teamName: string;
  value: number;
  matchesPlayed: number;
}

export interface PlayerLeaderboardEntry {
  playerId: string;
  playerName: string;
  teamName: string;
  value: number;
}

export interface LeagueRankings {
  teamRankings: {
    attackEfficiency: TeamRankingEntry[];
    serveEfficiency: TeamRankingEntry[];
    blocking: TeamRankingEntry[];
    defense: TeamRankingEntry[];
  };
  playerLeaderboards: {
    kills: PlayerLeaderboardEntry[];
    aces: PlayerLeaderboardEntry[];
    blocks: PlayerLeaderboardEntry[];
    digs: PlayerLeaderboardEntry[];
    assists: PlayerLeaderboardEntry[];
  };
}

export interface StandingsResult {
  standings: StandingsRow[];
  fixtureResults: Array<{
    fixtureId: string;
    played: boolean;
    homeSetsWon: number;
    awaySetsWon: number;
    hasDiscrepancy: boolean;
  }>;
}

export interface LeagueSeason {
  id: string;
  leagueId: string;
  league: { id: string; name: string; division: string | null };
  name: string;
  startDate: string;
  endDate: string | null;
  teams: LeagueTeamSummary[];
  _count: { fixtures: number; teams: number };
  createdAt: string;
}
