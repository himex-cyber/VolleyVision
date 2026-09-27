// Feedback tab routes. Mounted at /api/v1 (paths carry their own prefixes,
// like routes/channels.ts). Visibility: any authenticated user submits and
// lists their own; requireAdmin gates the cross-user list and triage.

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/permissions';
import { chatPostRateLimit } from '../middleware/rateLimit';
import { MAX_ATTACHMENTS_PER_FEEDBACK, MAX_FILE_BYTES } from '../services/feedbackStorage.service';
import {
  createFeedback,
  getAttachmentUrl,
  listAll,
  listMine,
  updateStatus,
} from '../controllers/feedback';

const router = Router();

// Memory storage: bytes are proxied straight to Supabase, never written to
// disk. The per-file cap here is the coarse 25 MB ceiling; the per-kind caps
// (10 MB images) are enforced in feedbackStorage.assertAcceptable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_ATTACHMENTS_PER_FEEDBACK },
});

// multer throws its own error types; normalize to the API's { error } shape.
function handleMulterError(err: any, _req: Request, res: Response, next: NextFunction) {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: `A file is too large. Maximum size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.` });
  } else if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: `A feedback submission can have at most ${MAX_ATTACHMENTS_PER_FEEDBACK} attachments.` });
  } else if (err instanceof Error) {
    res.status(400).json({ error: err.message });
  } else {
    next(err);
  }
}

// The chat rate limit doubles as spam protection on the submit form.
router.post(
  '/feedback',
  requireAuth,
  chatPostRateLimit,
  upload.array('files', MAX_ATTACHMENTS_PER_FEEDBACK),
  handleMulterError,
  createFeedback,
);
router.get('/feedback/mine', requireAuth, listMine);
router.get('/feedback', requireAuth, requireAdmin, listAll);
router.patch('/feedback/:id', requireAuth, requireAdmin, updateStatus);
// Owner-or-admin — enforced in feedback.service.getAttachmentSignedUrl.
router.get('/feedback/:feedbackId/attachments/:attachmentId/url', requireAuth, getAttachmentUrl);

export default router;
