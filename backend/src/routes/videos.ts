import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireMatchPermission } from '../middleware/permissions';
import { Permission } from '../services/permission.service';
import { prisma } from '../lib/prisma';
import { hasTeamPermission } from '../services/permission.service';
import { VideoStatus } from '@prisma/client';
import {
  createUploadIntent,
  completeUpload,
  refreshUpload,
  listVideos,
  getPlaybackSource,
  deleteVideo,
  linkYouTube,
  calibrateVideo,
  updateVideoDuration,
  listClips,
  createClip,
  generateClips,
  clearGeneratedClips,
  updateClip,
  deleteClip,
} from '../controllers/videos';
import { storageKeyFromTusRequest } from '../lib/tusUpload';
import { getVideoStorageProvider } from '../services/videoStorage';
import { AppError } from '../middleware/errorHandler';

// Video bytes never pass through this router. Uploads are presigned
// direct-to-storage (intent → browser PUT → complete) and playback is a signed
// URL the browser fetches from the storage vendor, so there is no multer here
// and no request body larger than a small JSON object.

// ─── Permission middleware for video-level operations ─────────────────────────
// Resolves teamId from the video's match so we can use hasTeamPermission.

function requireVideoPermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const video = await prisma.video.findUnique({
      where: { id: req.params.videoId },
      select: { match: { select: { teamId: true } } },
    });
    if (!video) { res.status(404).json({ error: 'Video not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, video.match.teamId, permission);
    if (!allowed) { res.status(403).json({ error: 'You do not have permission to perform this action.' }); return; }
    next();
  };
}

/** Resolves teamId from the clip's video's match, mirroring requireVideoPermission. */
function requireClipPermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const clip = await prisma.videoClip.findUnique({
      where: { id: req.params.clipId },
      select: { video: { select: { match: { select: { teamId: true } } } } },
    });
    if (!clip) { res.status(404).json({ error: 'Clip not found.' }); return; }
    const allowed = await hasTeamPermission(req.user.userId, clip.video.match.teamId, permission);
    if (!allowed) { res.status(403).json({ error: 'You do not have permission to perform this action.' }); return; }
    next();
  };
}

/**
 * Guard for the TUS proxy. An unguarded proxy is the same credential leak as
 * returning the key, with extra steps — so every chunk is authorized against
 * the video row that owns the object it is writing to.
 *
 * The object is identified by Upload-Metadata on creation and by the opaque
 * upload id on every request after that; both routes are parsed in
 * lib/tusUpload.ts, and an unparseable request is refused, never allowed.
 */
async function requireTusUploadPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) { res.status(401).json({ error: 'Authentication required.' }); return; }

  // Capability discovery: no object reference, no bytes. requireAuth has already
  // run. Narrowed to the collection endpoint — an OPTIONS carrying a path
  // segment is not a capability probe, and letting it through unauthorized would
  // proxy an arbitrary path upstream with the service-role key attached.
  if (req.method === 'OPTIONS' && !req.params[0]) { next(); return; }

  const storageKey = storageKeyFromTusRequest({
    metadataHeader: typeof req.headers['upload-metadata'] === 'string' ? req.headers['upload-metadata'] : null,
    uploadId: req.params[0] ?? null,
  });
  if (!storageKey) { res.status(403).json({ error: 'You do not have permission to perform this action.' }); return; }

  const video = await prisma.video.findFirst({
    where: { storageKey },
    select: { status: true, match: { select: { teamId: true } } },
  });
  // 403 rather than 404: a caller with no permission must not learn whether a
  // given storage key exists.
  if (!video) { res.status(403).json({ error: 'You do not have permission to perform this action.' }); return; }

  // Only an in-flight upload may be written to. Without this, a replayed URL
  // could overwrite footage that has already been confirmed READY.
  if (video.status !== VideoStatus.PENDING) {
    res.status(409).json({ error: 'This upload is already finished.' });
    return;
  }

  const allowed = await hasTeamPermission(req.user.userId, video.match.teamId, Permission.TRACK_MATCH);
  if (!allowed) { res.status(403).json({ error: 'You do not have permission to perform this action.' }); return; }
  next();
}

/**
 * Delegates to the configured provider's upload proxy.
 *
 * Resolved per request, never at module load: getVideoStorageProvider() reads
 * env lazily so the API boots fully unconfigured, and capturing the handler at
 * import time would undo that. A provider that issues browser-safe upload URLs
 * (R2 presigned, Stream, Mux) has no proxy at all, which is the better shape —
 * hence 501 rather than an error, since nothing is broken.
 */
function uploadProxy(req: Request, res: Response, next: NextFunction): void {
  const handler = getVideoStorageProvider().uploadProxyHandler;
  if (!handler) {
    next(new AppError(501, 'This storage provider does not use a proxied upload.'));
    return;
  }
  handler(req, res, next);
}

const router = Router();

// ─── Resumable upload proxy ───────────────────────────────────────────────────
// Mounted before the video-level routes so `upload-tus` is never captured by
// `:videoId`. The handler itself comes from whichever provider is configured —
// routing knows only that a provider MAY need a proxy, never which one does.
router.all(
  ['/videos/upload-tus', '/videos/upload-tus/*'],
  requireAuth,
  requireTusUploadPermission,
  uploadProxy,
);

// ─── Match-scoped video routes ────────────────────────────────────────────────
// Step 1 of the upload. TRACK_MATCH is the permission the old multer upload
// route used — uploading footage is a match-recording act, not team admin.
router.post(
  '/matches/:matchId/videos/upload-intent',
  requireAuth,
  requireMatchPermission(Permission.TRACK_MATCH, 'matchId'),
  createUploadIntent,
);
// Reads are team-scoped like every other resource: match footage is no less
// private than the match it belongs to. VIEW_TEAM is the read permission every
// member holds, so this only excludes non-members.
// Link a coach-provided YouTube video. Same permission as starting an upload —
// both are "put footage against this match".
router.post('/matches/:matchId/videos/youtube', requireAuth, requireMatchPermission(Permission.TRACK_MATCH, 'matchId'), linkYouTube);
// Returns both sources: uploads and YouTube links.
router.get('/matches/:matchId/videos', requireAuth, requireMatchPermission(Permission.VIEW_TEAM, 'matchId'), listVideos);

// ─── Video-level routes ───────────────────────────────────────────────────────
// Step 3 of the upload — confirms the bytes landed. Same permission as step 1.
router.post('/videos/:videoId/complete', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), completeUpload);
// A multi-gigabyte upload on a slow line can outlive its own credential. This
// issues a fresh one for the same object so the client resumes from its last
// offset instead of starting over.
router.post('/videos/:videoId/refresh-upload', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), refreshUpload);
router.get('/videos/:videoId/playback', requireAuth, requireVideoPermission(Permission.VIEW_TEAM), getPlaybackSource);
router.delete('/videos/:videoId', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), deleteVideo);

// ─── Match-time sync ──────────────────────────────────────────────────────────
// Anchors video time 0:00 to a real instant, so every tracked event maps to a
// point in the footage.
router.post('/videos/:videoId/calibrate', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), calibrateVideo);
// The client reports duration once the player knows it (the IFrame API returns
// 0 until metadata loads).
router.patch('/videos/:videoId/duration', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), updateVideoDuration);

// ─── Clips ────────────────────────────────────────────────────────────────────
// A clip is a time range, never a file — nothing here cuts or serves media.
router.get('/videos/:videoId/clips', requireAuth, requireVideoPermission(Permission.VIEW_TEAM), listClips);
router.post('/videos/:videoId/clips', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), createClip);
router.post('/videos/:videoId/clips/generate', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), generateClips);
// Used after recalibration, which leaves GENERATED ranges stale. MANUAL clips survive.
router.delete('/videos/:videoId/clips/generated', requireAuth, requireVideoPermission(Permission.TRACK_MATCH), clearGeneratedClips);
router.patch('/clips/:clipId', requireAuth, requireClipPermission(Permission.TRACK_MATCH), updateClip);
router.delete('/clips/:clipId', requireAuth, requireClipPermission(Permission.TRACK_MATCH), deleteClip);

export default router;
