// YouTube as a video source: linking, calibration, and clip generation.
//
// A YouTube video is NOT storage. Nothing here presigns, verifies, or deletes
// bytes — YouTube owns the file, the transcoding, the CDN and the seeking. That
// is the whole point: it removes the storage ceiling, the egress bill, and the
// 6 MB Netlify/TUS collision in one move. The upload path in
// services/videoStorage/ is untouched and remains the private-storage option.
//
// The tradeoff that shapes everything downstream: an embed is a cross-origin
// iframe, so JavaScript can never read its pixels. Clips are therefore time
// RANGES, never files. Nothing is cut, stored, or served.

import { ClipOrigin, EventType, Prisma, VideoSource, VideoStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../lib/audit';
import { ownEventsOnly } from '../lib/eventFilters';
import { isEnumValue } from '../lib/feedbackValidation';
import { parseYouTubeVideoId, youtubeOEmbedUrl } from '../lib/youtubeUrl';
import {
  clipRangeForEvent,
  eventToVideoSeconds,
  formatTimecode,
  validateClipRange,
} from '../lib/videoClips';

/** oEmbed is a courtesy check, not a gate — never let it hold up a coach for long. */
const OEMBED_TIMEOUT_MS = 5000;

// ─── Linking ──────────────────────────────────────────────────────────────────

/**
 * Ask YouTube whether this video exists and can be embedded.
 *
 * Three outcomes, deliberately distinguished:
 *   - 200            → exists and is embeddable; the title is worth keeping.
 *   - 401/403/404    → private, deleted, or embedding disabled. A definite no,
 *                      and worth blocking on: the coach can fix it in seconds
 *                      by switching Private to Unlisted.
 *   - network failure → we learned nothing. Allow the link with a null title
 *                      rather than blocking a coach because of our own
 *                      connectivity.
 */
async function checkEmbeddable(videoId: string): Promise<{ ok: boolean; title: string | null; conclusive: boolean }> {
  try {
    const response = await fetch(youtubeOEmbedUrl(videoId), {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });

    if (response.ok) {
      const body = (await response.json()) as { title?: unknown };
      return {
        ok: true,
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : null,
        conclusive: true,
      };
    }

    if ([401, 403, 404].includes(response.status)) {
      return { ok: false, title: null, conclusive: true };
    }

    // 5xx or anything unexpected — YouTube's problem, not the coach's.
    console.warn(`YouTube oEmbed returned ${response.status} for ${videoId}; allowing the link.`);
    return { ok: true, title: null, conclusive: false };
  } catch (err) {
    console.warn(`YouTube oEmbed check failed for ${videoId}:`, err instanceof Error ? err.message : err);
    return { ok: true, title: null, conclusive: false };
  }
}

export async function linkYouTubeVideo(input: { matchId: string; url: string; userId: string }) {
  const videoId = parseYouTubeVideoId(input.url ?? '');
  if (!videoId) throw new AppError(400, "That doesn't look like a YouTube link.");

  const match = await prisma.match.findUnique({ where: { id: input.matchId }, select: { id: true } });
  if (!match) throw new AppError(404, 'Match not found.');

  // The same video on a different match is fine — a coach may film two matches
  // in one recording. The same video twice on one match is a mistake.
  const existing = await prisma.video.findFirst({
    where: { matchId: input.matchId, youtubeVideoId: videoId },
    select: { id: true },
  });
  if (existing) throw new AppError(409, 'That video is already linked to this match.');

  const check = await checkEmbeddable(videoId);
  if (!check.ok) {
    throw new AppError(400, "That video is private or unavailable. Unlisted works; private doesn't.");
  }

  const video = await prisma.video.create({
    data: {
      matchId: input.matchId,
      source: VideoSource.YOUTUBE,
      // PENDING/FAILED describe an upload lifecycle that does not apply: there
      // are no bytes of ours in flight, so the row is usable immediately.
      status: VideoStatus.READY,
      youtubeVideoId: videoId,
      title: check.title,
      filename: null,
      mimeType: null,
      uploadedByUserId: input.userId,
    },
  });

  logAudit(input.userId, 'video.link_youtube', 'video', video.id, {
    matchId: input.matchId,
    youtubeVideoId: videoId,
    titleResolved: check.conclusive,
  });

  return video;
}

// ─── Calibration ──────────────────────────────────────────────────────────────

/**
 * Anchor video time to match time.
 *
 * The client passes the playhead position at the moment the coach marks the
 * first tracked event. Subtracting gives the real-world instant of video time
 * 0:00, and from there every event maps to a point in the footage.
 *
 * Anchoring on a real event rather than wall-clock assumptions is the whole
 * trick: if the tracking device's clock is off by two minutes, the offset is
 * present in BOTH the event's recordedAt and the derived anchor, so it cancels
 * out. A wall-clock approach would bake the skew in.
 */
export async function setRecordingStart(input: { videoId: string; videoSeconds: number; userId: string }) {
  if (!Number.isFinite(input.videoSeconds) || input.videoSeconds < 0) {
    throw new AppError(400, 'Playhead position must be a positive number of seconds.');
  }

  const video = await prisma.video.findUnique({
    where: { id: input.videoId },
    select: { id: true, matchId: true, durationSeconds: true },
  });
  if (!video) throw new AppError(404, 'Video not found.');

  const firstEvent = await prisma.event.findFirst({
    where: { matchId: video.matchId, ...ownEventsOnly },
    orderBy: { recordedAt: 'asc' },
    select: { recordedAt: true },
  });
  if (!firstEvent) {
    throw new AppError(400, 'This match has no tracked events yet, so there is nothing to sync to.');
  }

  const recordingStartedAt = new Date(firstEvent.recordedAt.getTime() - Math.floor(input.videoSeconds) * 1000);

  const updated = await prisma.video.update({
    where: { id: video.id },
    data: { recordingStartedAt },
    select: { id: true, recordingStartedAt: true, durationSeconds: true },
  });

  const { matched, outside } = await countEventsInRange(video.matchId, recordingStartedAt, video.durationSeconds);

  logAudit(input.userId, 'video.calibrate', 'video', video.id, {
    matchId: video.matchId,
    recordingStartedAt: recordingStartedAt.toISOString(),
    matchedEvents: matched,
  });

  return { video: updated, matchedEvents: matched, eventsOutsideVideo: outside };
}

/** How many of the match's own events land inside this video's footage. */
async function countEventsInRange(matchId: string, recordingStartedAt: Date, durationSeconds: number | null) {
  const events = await prisma.event.findMany({
    where: { matchId, ...ownEventsOnly },
    select: { recordedAt: true },
  });

  let matched = 0;
  for (const event of events) {
    const seconds = eventToVideoSeconds(event.recordedAt, recordingStartedAt);
    if (clipRangeForEvent(seconds, durationSeconds) !== null) matched++;
  }
  return { matched, outside: events.length - matched };
}

// ─── Clip generation ──────────────────────────────────────────────────────────

const EVENT_SELECT = {
  id: true,
  eventType: true,
  setNumber: true,
  recordedAt: true,
  player: { select: { firstName: true, lastName: true, jerseyNumber: true } },
} satisfies Prisma.EventSelect;

type GeneratableEvent = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/** `Kill — #7 Hennings, Set 2` — readable in a list without opening anything. */
function buildClipLabel(event: GeneratableEvent): string {
  const type = titleCase(event.eventType);
  const player = event.player
    ? ` — #${event.player.jerseyNumber} ${event.player.lastName}`
    : '';
  return `${type}${player}, Set ${event.setNumber}`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Create a clip per tracked event, using the calibration anchor.
 *
 * Idempotent: an event that already has a GENERATED clip on this video is
 * skipped, so pressing the button twice does not double the list.
 *
 * Events outside this video's footage are skipped and counted, never errored —
 * a match filmed across three set-videos will have most of its events outside
 * any given one, and that is normal.
 */
export async function generateClipsFromEvents(input: {
  videoId: string;
  userId: string;
  filter?: { eventType?: string; playerId?: string; setNumber?: number };
}) {
  const video = await prisma.video.findUnique({
    where: { id: input.videoId },
    select: { id: true, matchId: true, recordingStartedAt: true, durationSeconds: true },
  });
  if (!video) throw new AppError(404, 'Video not found.');
  if (!video.recordingStartedAt) {
    throw new AppError(409, 'Sync this video to the match before generating clips.');
  }

  const filter = input.filter ?? {};
  // Checked, not cast: an unknown value reaching Prisma's enum filter throws a
  // validation error that is not an AppError, which errorHandler turns into a
  // 500 for what is plainly a bad request.
  if (filter.eventType !== undefined && !isEnumValue(EventType, filter.eventType)) {
    throw new AppError(400, `Unknown event type: ${filter.eventType}.`);
  }

  const events = await prisma.event.findMany({
    where: {
      matchId: video.matchId,
      ...ownEventsOnly,
      ...(filter.eventType ? { eventType: filter.eventType as EventType } : {}),
      ...(filter.playerId ? { playerId: filter.playerId } : {}),
      ...(filter.setNumber ? { setNumber: filter.setNumber } : {}),
    },
    orderBy: { recordedAt: 'asc' },
    select: EVENT_SELECT,
  });

  // One query for every already-generated event on this video, rather than a
  // per-event existence check.
  const alreadyGenerated = new Set(
    (
      await prisma.videoClip.findMany({
        where: { videoId: video.id, origin: ClipOrigin.GENERATED, eventId: { not: null } },
        select: { eventId: true },
      })
    ).map((c) => c.eventId as string),
  );

  const rows: Prisma.VideoClipCreateManyInput[] = [];
  let skippedExisting = 0;
  let skippedOutside = 0;

  for (const event of events) {
    if (alreadyGenerated.has(event.id)) { skippedExisting++; continue; }

    const range = clipRangeForEvent(
      eventToVideoSeconds(event.recordedAt, video.recordingStartedAt),
      video.durationSeconds,
    );
    if (!range) { skippedOutside++; continue; }

    rows.push({
      videoId: video.id,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      label: buildClipLabel(event),
      eventId: event.id,
      origin: ClipOrigin.GENERATED,
      createdByUserId: input.userId,
    });
  }

  if (rows.length > 0) await prisma.videoClip.createMany({ data: rows });

  logAudit(input.userId, 'video.generate_clips', 'video', video.id, {
    matchId: video.matchId,
    created: rows.length,
    skippedExisting,
    skippedOutside,
  });

  return { created: rows.length, skippedExisting, eventsOutsideVideo: skippedOutside };
}

/**
 * Drop every GENERATED clip on a video, keeping MANUAL ones.
 *
 * Recalibration invalidates generated ranges — they were computed from the old
 * anchor — but a clip a coach dragged by eye is still correct, so it survives.
 */
export async function clearGeneratedClips(input: { videoId: string; userId: string }) {
  const video = await prisma.video.findUnique({ where: { id: input.videoId }, select: { id: true } });
  if (!video) throw new AppError(404, 'Video not found.');

  const { count } = await prisma.videoClip.deleteMany({
    where: { videoId: video.id, origin: ClipOrigin.GENERATED },
  });

  logAudit(input.userId, 'video.clear_generated_clips', 'video', video.id, { deleted: count });
  return { deleted: count };
}

// ─── Clip CRUD ────────────────────────────────────────────────────────────────

export async function listClips(videoId: string) {
  return prisma.videoClip.findMany({
    where: { videoId },
    orderBy: { startSeconds: 'asc' },
    include: { event: { select: { id: true, eventType: true, setNumber: true } } },
  });
}

export async function createManualClip(input: {
  videoId: string;
  startSeconds: unknown;
  endSeconds: unknown;
  label?: string;
  userId: string;
}) {
  const video = await prisma.video.findUnique({
    where: { id: input.videoId },
    select: { id: true, durationSeconds: true },
  });
  if (!video) throw new AppError(404, 'Video not found.');

  const range = validateClipRange({
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    durationSeconds: video.durationSeconds,
  });

  const label = input.label?.trim() || `Clip ${formatTimecode(range.startSeconds)}`;

  const clip = await prisma.videoClip.create({
    data: {
      videoId: video.id,
      ...range,
      label,
      origin: ClipOrigin.MANUAL,
      createdByUserId: input.userId,
    },
  });

  logAudit(input.userId, 'clip.create', 'clip', clip.id, { videoId: video.id, ...range });
  return clip;
}

export async function updateClip(input: {
  clipId: string;
  startSeconds?: unknown;
  endSeconds?: unknown;
  label?: string;
  userId: string;
}) {
  const clip = await prisma.videoClip.findUnique({
    where: { id: input.clipId },
    include: { video: { select: { durationSeconds: true } } },
  });
  if (!clip) throw new AppError(404, 'Clip not found.');

  const data: Prisma.VideoClipUpdateInput = {};

  // Validate the range as a whole even when only one end moved — a new start
  // must still be checked against the existing end.
  if (input.startSeconds !== undefined || input.endSeconds !== undefined) {
    const range = validateClipRange({
      startSeconds: input.startSeconds ?? clip.startSeconds,
      endSeconds: input.endSeconds ?? clip.endSeconds,
      durationSeconds: clip.video.durationSeconds,
    });
    data.startSeconds = range.startSeconds;
    data.endSeconds = range.endSeconds;
  }

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) throw new AppError(400, 'A clip needs a label.');
    data.label = label;
  }

  if (Object.keys(data).length === 0) return clip;

  const updated = await prisma.videoClip.update({ where: { id: clip.id }, data });
  logAudit(input.userId, 'clip.update', 'clip', clip.id, { videoId: clip.videoId });
  return updated;
}

export async function deleteClip(input: { clipId: string; userId: string }) {
  const clip = await prisma.videoClip.findUnique({ where: { id: input.clipId }, select: { id: true, videoId: true } });
  if (!clip) throw new AppError(404, 'Clip not found.');

  await prisma.videoClip.delete({ where: { id: clip.id } });
  logAudit(input.userId, 'clip.delete', 'clip', clip.id, { videoId: clip.videoId });
}

// ─── Duration ─────────────────────────────────────────────────────────────────

/**
 * Persist the duration the player discovered. The IFrame API returns 0 until
 * metadata loads, so this arrives after the fact and only once — it is what
 * lets clip generation clamp at the end of the footage.
 */
export async function setVideoDuration(input: { videoId: string; durationSeconds: unknown; userId: string }) {
  const { durationSeconds } = input;
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AppError(400, 'Duration must be a positive number of seconds.');
  }

  const video = await prisma.video.findUnique({ where: { id: input.videoId }, select: { id: true } });
  if (!video) throw new AppError(404, 'Video not found.');

  return prisma.video.update({
    where: { id: video.id },
    data: { durationSeconds: Math.floor(durationSeconds) },
  });
}
