// Team Chat routes. Mounted at /api/v1 (paths here carry their own prefixes,
// like routes/videos.ts) because the surface spans three resources: the
// team-scoped channel getter, channel-scoped messages, and message-scoped
// edit/delete.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { chatPostRateLimit } from '../middleware/rateLimit';
import { requireChannelPermission, requireTeamPermission } from '../middleware/permissions';
import { Permission } from '../services/permission.service';
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_FILE_BYTES } from '../services/chatStorage.service';
import {
  getTeamChannel,
  listChannelMessages,
  postChannelMessage,
  uploadChannelMessage,
  updateMessage,
  deleteMessage,
} from '../controllers/messages';

const router = Router();

// ─── Attachment upload (slice 4) ──────────────────────────────────────────────
// Memory storage: bytes are proxied straight to Supabase, never written to
// disk. The per-file cap here is the coarse 25 MB ceiling; the per-kind caps
// (10 MB images) are enforced in chatStorage.assertAcceptable.

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_ATTACHMENTS_PER_MESSAGE },
});

// multer throws its own error types; normalize to the API's { error } shape.
function handleMulterError(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: `A file is too large. Maximum size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.` });
  } else if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: `A message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.` });
  } else if (err instanceof Error) {
    res.status(400).json({ error: err.message });
  } else {
    next(err);
  }
}

// The team's single TEAM channel (get-or-create; readable by every member).
router.get(
  '/teams/:teamId/channel',
  requireAuth,
  requireTeamPermission(Permission.VIEW_TEAM, 'teamId'),
  getTeamChannel,
);

router.get(
  '/channels/:channelId/messages',
  requireAuth,
  requireChannelPermission(Permission.VIEW_TEAM),
  listChannelMessages,
);
router.post(
  '/channels/:channelId/messages',
  requireAuth,
  chatPostRateLimit,
  requireChannelPermission(Permission.POST_MESSAGE),
  postChannelMessage,
);
router.post(
  '/channels/:channelId/messages/upload',
  requireAuth,
  chatPostRateLimit,
  requireChannelPermission(Permission.POST_MESSAGE),
  upload.array('files', MAX_ATTACHMENTS_PER_MESSAGE),
  handleMulterError,
  uploadChannelMessage,
);

// Author/moderator rules resolved in the controller + service.
router.patch('/messages/:messageId', requireAuth, updateMessage);
router.delete('/messages/:messageId', requireAuth, deleteMessage);

export default router;
