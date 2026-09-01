// Feedback tab — controllers. Admin gating for listAll/updateStatus lives in
// the route middleware (requireAdmin); the attachment URL endpoint serves both
// audiences, so its ownership check happens in the service.

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import {
  createFeedback as createFeedbackService,
  getAttachmentSignedUrl,
  listAllFeedback,
  listMyFeedback,
  updateFeedbackStatus,
} from '../services/feedback.service';

/** Multipart: type/subject/description (+ optional severity, pageContext) + `files[]`. */
export async function createFeedback(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const feedback = await createFeedbackService({
      userId: req.user.userId,
      type: req.body?.type,
      severity: req.body?.severity,
      subject: req.body?.subject,
      description: req.body?.description,
      pageContext: req.body?.pageContext,
      files,
    });
    res.status(201).json(feedback);
  } catch (err) {
    next(err);
  }
}

// clampPageSize (lib/chat.ts) already defaults on NaN/undefined, so this just
// forwards the raw query string through Number().
function parseLimit(raw: unknown): number | undefined {
  return typeof raw === 'string' ? Number(raw) : undefined;
}

export async function listMine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const { limit, cursor } = req.query;
    res.json(await listMyFeedback(req.user.userId, {
      limit: parseLimit(limit),
      cursor: typeof cursor === 'string' ? cursor : undefined,
    }));
  } catch (err) {
    next(err);
  }
}

export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, type, severity, limit, cursor } = req.query;
    res.json(await listAllFeedback({
      status: typeof status === 'string' ? status : undefined,
      type: typeof type === 'string' ? type : undefined,
      severity: typeof severity === 'string' ? severity : undefined,
      limit: parseLimit(limit),
      cursor: typeof cursor === 'string' ? cursor : undefined,
    }));
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await updateFeedbackStatus(req.params.id, {
      status: req.body?.status,
      adminNotes: req.body?.adminNotes,
    }));
  } catch (err) {
    next(err);
  }
}

export async function getAttachmentUrl(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const url = await getAttachmentSignedUrl(
      req.params.feedbackId,
      req.params.attachmentId,
      req.user.userId,
      req.user.role === 'ADMIN',
    );
    res.json({ url });
  } catch (err) {
    next(err);
  }
}
