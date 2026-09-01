import { Request, Response, NextFunction } from 'express';
import { VideoSource, VideoStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../lib/audit';
import { buildStorageKey, formatMb, validateUploadIntent } from '../lib/videoValidation';
import { canRefreshUpload, canTransition, resolveUploadCompletion } from '../lib/videoStatus';
import { getVideoStorageProvider, videoStorageConfig } from '../services/videoStorage';
import * as youtube from '../services/youtubeVideo.service';
import { hasTeamPermission, Permission } from '../services/permission.service';

// Rows written before presigned storage carry a filePath and no storageKey.
// Their bytes lived on an ephemeral function container and are gone; the row
// stays so the match page still shows what was uploaded.
const LEGACY_MESSAGE = 'This video was stored before the migration and is no longer available.';

// YouTube rows share the Video table but none of the upload lifecycle: there is
// no object to presign, verify, sign for playback, or delete.
const NOT_AN_UPLOAD_MESSAGE = 'This is a linked YouTube video, not an upload.';

// ─── Upload: step 1 of 3 — issue a presigned URL ──────────────────────────────
// The browser PUTs the bytes straight to the provider (step 2, no API
// involvement) and then calls complete (step 3). No video byte ever passes
// through this function — a Netlify request payload caps out around 6 MB.

export async function createUploadIntent(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchId } = req.params;
    const cfg = videoStorageConfig();

    // Validate before presigning: never hand out a URL for a file we will
    // reject on completion.
    const intent = validateUploadIntent(req.body, cfg.maxSizeBytes);

    const match = await prisma.match.findUnique({ where: { id: matchId }, select: { id: true } });
    if (!match) throw new AppError(404, 'Match not found.');

    const provider = getVideoStorageProvider();
    const storageKey = buildStorageKey(matchId, intent.contentType);
    const upload = await provider.createPresignedUpload({
      storageKey,
      contentType: intent.contentType,
      maxSizeBytes: cfg.maxSizeBytes,
    });

    const video = await prisma.video.create({
      data: {
        matchId,
        filename: intent.filename,
        mimeType: intent.contentType,
        storageProvider: provider.name,
        storageKey: upload.storageKey,
        // Client-declared; overwritten with the provider's real value on completion.
        sizeBytes: intent.sizeBytes,
        status: VideoStatus.PENDING,
        uploadedByUserId: req.user!.userId,
      },
    });

    // storageKey is withheld from the top level; for the TUS arm the protocol
    // requires it inside upload.metadata.objectName, so the client does learn
    // its own key. That is fine — it is not a credential — but nothing
    // server-side may treat "caller knows a key" as authorization. See the
    // precedence note in storageKeyFromTusRequest.
    const { storageKey: _withheld, ...clientUpload } = upload;
    res.status(201).json({ videoId: video.id, upload: clientUpload });
  } catch (err) { next(err); }
}

// ─── Upload: re-credential an in-flight upload ────────────────────────────────

/**
 * Issue a fresh presigned upload for a video that is still PENDING, reusing the
 * same storage key so the client resumes at its last committed offset.
 *
 * A multi-gigabyte upload on a slow connection can outlive its credential —
 * Supabase's resumable token has a fixed two-hour server-side lifetime this API
 * cannot extend — and without this the only recovery is to start from zero.
 */
export async function refreshUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.videoId } });
    if (!video) throw new AppError(404, 'Video not found.');
    // A YouTube row has no upload to re-credential — and no mimeType to presign with.
    if (video.source !== VideoSource.UPLOAD || !video.mimeType) throw new AppError(400, NOT_AN_UPLOAD_MESSAGE);
    if (!video.storageKey) throw new AppError(410, LEGACY_MESSAGE);

    if (!canRefreshUpload(video.status)) {
      throw new AppError(
        409,
        video.status === VideoStatus.READY
          ? 'This video has already finished uploading.'
          : 'This upload has already failed. Start a new upload instead.',
      );
    }

    const provider = getVideoStorageProvider();
    if (video.storageProvider && video.storageProvider !== provider.name) {
      throw new AppError(409, `This upload was started on ${video.storageProvider}, which is not the configured provider.`);
    }

    const cfg = videoStorageConfig();
    const upload = await provider.createPresignedUpload({
      storageKey: video.storageKey,
      contentType: video.mimeType,
      maxSizeBytes: cfg.maxSizeBytes,
    });

    const { storageKey: _withheld, ...clientUpload } = upload;
    res.json({ videoId: video.id, upload: clientUpload });
  } catch (err) { next(err); }
}

// ─── Upload: step 3 of 3 — verify the bytes actually landed ───────────────────

export async function completeUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.videoId } });
    if (!video) throw new AppError(404, 'Video not found.');
    if (!video.storageKey) throw new AppError(410, LEGACY_MESSAGE);

    if (!canTransition(video.status, VideoStatus.READY)) {
      // READY is terminal, so a duplicate confirm (retry, double-click) is a
      // no-op rather than an error. FAILED is terminal too — a retry gets a
      // fresh intent and its own row.
      if (video.status === VideoStatus.READY) { res.json(video); return; }
      throw new AppError(400, 'Upload was not completed.');
    }

    const cfg = videoStorageConfig();
    const provider = getVideoStorageProvider();
    const outcome = resolveUploadCompletion(await provider.head(video.storageKey), cfg.maxSizeBytes);

    if (outcome.status === 'FAILED') {
      // An oversize object exists and is ours to clean up. Best-effort: the
      // client's error must not be replaced by a cleanup error.
      if (outcome.reason === 'oversize') {
        await provider.delete(video.storageKey).catch((err) => {
          console.error(`Failed to remove oversize video ${video.id} (${video.storageKey}):`, err);
        });
      }
      await prisma.video.update({ where: { id: video.id }, data: { status: VideoStatus.FAILED } });
      throw new AppError(
        400,
        outcome.reason === 'oversize'
          ? `That video is too large. Maximum size is ${formatMb(cfg.maxSizeBytes)}.`
          : 'Upload was not completed.',
      );
    }

    const updated = await prisma.video.update({
      where: { id: video.id },
      data: {
        status: VideoStatus.READY,
        sizeBytes: outcome.sizeBytes ?? video.sizeBytes,
        mimeType: outcome.contentType ?? video.mimeType,
      },
    });

    logAudit(req.user!.userId, 'video.upload', 'video', video.id, {
      matchId: video.matchId,
      filename: video.filename,
      sizeBytes: updated.sizeBytes,
      storageProvider: video.storageProvider,
    });

    res.json(updated);
  } catch (err) { next(err); }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listVideos(req: Request, res: Response, next: NextFunction) {
  try {
    const { matchId } = req.params;

    // Both sources come back from here. PENDING and FAILED rows are upload
    // plumbing — useful to whoever is doing the uploading, noise to everyone
    // else — and YouTube rows are created READY, so they are never filtered out
    // by the default. The route guard is VIEW_TEAM, so the staff check for
    // includePending happens here.
    let includePending = false;
    if (req.query.includePending === 'true') {
      const match = await prisma.match.findUnique({ where: { id: matchId }, select: { teamId: true } });
      if (!match) throw new AppError(404, 'Match not found.');
      includePending = await hasTeamPermission(req.user!.userId, match.teamId, Permission.TRACK_MATCH);
    }

    const videos = await prisma.video.findMany({
      where: { matchId, ...(includePending ? {} : { status: VideoStatus.READY }) },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(videos);
  } catch (err) { next(err); }
}

/**
 * Signed playback URL + how to play it. Bytes are served by the storage vendor
 * directly to the browser — this endpoint returns a pointer, never a stream.
 */
export async function getPlaybackSource(req: Request, res: Response, next: NextFunction) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.videoId } });
    if (!video) throw new AppError(404, 'Video not found.');

    // A YouTube video plays through the embed, using youtubeVideoId from the
    // list payload. There is no object to sign, so asking for one is a client bug.
    if (video.source === VideoSource.YOUTUBE) {
      throw new AppError(400, 'This is a YouTube video — play it through the embed, not a playback URL.');
    }

    if (!video.storageKey) throw new AppError(410, LEGACY_MESSAGE);

    if (video.status !== VideoStatus.READY) {
      throw new AppError(409, "This video hasn't finished uploading yet.");
    }

    const provider = getVideoStorageProvider();
    if (video.storageProvider && video.storageProvider !== provider.name) {
      // Signing this key against the current vendor would look up an object
      // that was never there. Say so plainly instead of 404ing.
      throw new AppError(410, `This video is stored on a provider that is no longer configured (${video.storageProvider}).`);
    }

    res.json(await provider.getPlaybackSource(video.storageKey));
  } catch (err) { next(err); }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteVideo(req: Request, res: Response, next: NextFunction) {
  try {
    const video = await prisma.video.findUnique({ where: { id: req.params.videoId } });
    if (!video) throw new AppError(404, 'Video not found.');

    // Storage first: if the row goes first and the object delete then fails, the
    // bytes are orphaned with nothing left pointing at them. This order can
    // leave a row whose object is already gone, which the next delete tolerates.
    //
    // A YouTube row owns no bytes — unlinking removes our record, and the
    // coach's video on their own channel is untouched.
    if (video.source === VideoSource.UPLOAD && video.storageKey) {
      const provider = getVideoStorageProvider();
      if (!video.storageProvider || video.storageProvider === provider.name) {
        await provider.delete(video.storageKey);
      } else {
        throw new AppError(
          409,
          `This video is stored on ${video.storageProvider}, which is not the configured provider. Deleting the record would orphan the file.`,
        );
      }
    }

    await prisma.video.delete({ where: { id: video.id } });

    logAudit(req.user!.userId, 'video.delete', 'video', video.id, {
      matchId: video.matchId,
      source: video.source,
      filename: video.filename,
      storageProvider: video.storageProvider,
    });

    res.status(204).send();
  } catch (err) { next(err); }
}

// ─── YouTube source ───────────────────────────────────────────────────────────

export async function linkYouTube(req: Request, res: Response, next: NextFunction) {
  try {
    const video = await youtube.linkYouTubeVideo({
      matchId: req.params.matchId,
      url: (req.body?.url ?? '') as string,
      userId: req.user!.userId,
    });
    res.status(201).json(video);
  } catch (err) { next(err); }
}

export async function calibrateVideo(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await youtube.setRecordingStart({
        videoId: req.params.videoId,
        videoSeconds: Number(req.body?.videoSeconds),
        userId: req.user!.userId,
      }),
    );
  } catch (err) { next(err); }
}

export async function updateVideoDuration(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await youtube.setVideoDuration({
        videoId: req.params.videoId,
        durationSeconds: req.body?.durationSeconds,
        userId: req.user!.userId,
      }),
    );
  } catch (err) { next(err); }
}

// ─── Clips ────────────────────────────────────────────────────────────────────

export async function generateClips(req: Request, res: Response, next: NextFunction) {
  try {
    const { eventType, playerId, setNumber } = req.body ?? {};
    res.json(
      await youtube.generateClipsFromEvents({
        videoId: req.params.videoId,
        userId: req.user!.userId,
        filter: {
          eventType: typeof eventType === 'string' ? eventType : undefined,
          playerId: typeof playerId === 'string' ? playerId : undefined,
          setNumber: Number.isInteger(setNumber) ? setNumber : undefined,
        },
      }),
    );
  } catch (err) { next(err); }
}

export async function clearGeneratedClips(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await youtube.clearGeneratedClips({ videoId: req.params.videoId, userId: req.user!.userId }));
  } catch (err) { next(err); }
}

export async function listClips(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await youtube.listClips(req.params.videoId));
  } catch (err) { next(err); }
}

export async function createClip(req: Request, res: Response, next: NextFunction) {
  try {
    const clip = await youtube.createManualClip({
      videoId: req.params.videoId,
      startSeconds: req.body?.startSeconds,
      endSeconds: req.body?.endSeconds,
      label: req.body?.label,
      userId: req.user!.userId,
    });
    res.status(201).json(clip);
  } catch (err) { next(err); }
}

export async function updateClip(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await youtube.updateClip({
        clipId: req.params.clipId,
        startSeconds: req.body?.startSeconds,
        endSeconds: req.body?.endSeconds,
        label: req.body?.label,
        userId: req.user!.userId,
      }),
    );
  } catch (err) { next(err); }
}

export async function deleteClip(req: Request, res: Response, next: NextFunction) {
  try {
    await youtube.deleteClip({ clipId: req.params.clipId, userId: req.user!.userId });
    res.status(204).send();
  } catch (err) { next(err); }
}
