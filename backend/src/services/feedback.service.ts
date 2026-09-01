// Feedback tab — submit / list / triage service. Visibility rules: users see
// only their own submissions; the global ADMIN sees everything. The admin gate
// is enforced by requireAdmin in the routes — listAllFeedback and
// updateFeedbackStatus trust that; only the attachment signed-URL check
// (mixed-audience endpoint) re-verifies ownership here.

import { AttachmentKind, FeedbackAttachment, FeedbackSeverity, FeedbackStatus, FeedbackType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { beforeCursorWhere, clampPageSize } from '../lib/chat';
import { resolveUploadContentType } from '../lib/fileSignature';
import { isEnumValue, parseRequiredText, parseSeverity, parseType } from '../lib/feedbackValidation';
import {
  MAX_ATTACHMENTS_PER_FEEDBACK,
  assertAcceptable,
  buildFeedbackObjectKey,
  deleteObjects,
  imageDimensions,
  signAttachmentUrl,
  uploadAttachment,
} from './feedbackStorage.service';

const MAX_SUBJECT_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_ADMIN_NOTES_LENGTH = 5000;
const MAX_PAGE_CONTEXT_LENGTH = 300;

// The submitter identity shown on the admin's "All Feedback" list only —
// never included in a user's own list.
const submitterSelect = { firstName: true, lastName: true, email: true } as const;

// ─── Serialization ────────────────────────────────────────────────────────────

/** Public attachment shape — storagePath never leaves the server. */
function toAttachmentDto(a: FeedbackAttachment) {
  return {
    id: a.id,
    kind: a.kind,
    originalName: a.originalName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
  };
}

function serializeFeedback<T extends { attachments: FeedbackAttachment[] }>(row: T) {
  const { attachments, ...rest } = row;
  return { ...rest, attachments: attachments.map(toAttachmentDto) };
}

// ─── Input validation ─────────────────────────────────────────────────────────
// parseType / parseSeverity / parseRequiredText / isEnumValue live in
// lib/feedbackValidation.ts (unit-tested there, no DB needed).

function parseOptionalText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value ? value.slice(0, maxLength) : null;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateFeedbackInput {
  userId: string;
  type: unknown;
  severity?: unknown;
  subject: unknown;
  description: unknown;
  pageContext?: unknown;
  files: Express.Multer.File[];
}

/**
 * Validate → upload attachments → create Feedback + FeedbackAttachment rows in
 * one atomic write. If the DB write fails after bytes have landed in storage,
 * the uploaded objects are deleted (compensating cleanup, mirrors
 * message.service.postMessageWithAttachments) so a failed request leaves no
 * orphans.
 */
export async function createFeedback(input: CreateFeedbackInput) {
  const type = parseType(input.type);
  const severity = parseSeverity(input.severity, type);
  const subject = parseRequiredText(input.subject, 'Subject', MAX_SUBJECT_LENGTH);
  const description = parseRequiredText(input.description, 'Description', MAX_DESCRIPTION_LENGTH);
  const pageContext = parseOptionalText(input.pageContext, MAX_PAGE_CONTEXT_LENGTH);

  if (input.files.length > MAX_ATTACHMENTS_PER_FEEDBACK) {
    throw new AppError(400, `A feedback submission can have at most ${MAX_ATTACHMENTS_PER_FEEDBACK} attachments.`);
  }

  // Reject the whole batch up front so one bad file can't strand siblings
  // that were already uploaded.
  // contentType is verified against the file's bytes here so a byte/type
  // mismatch also rejects the batch up front. uploadAttachment re-derives it —
  // it stays the choke point that decides what Storage is actually told.
  const prepared = input.files.map((file) => ({
    file,
    kind: assertAcceptable(file),
    contentType: resolveUploadContentType(file.mimetype, file.buffer),
  })).map((p) => ({
    ...p,
    dims: p.kind === AttachmentKind.IMAGE ? imageDimensions(p.file.buffer) : null,
  }));

  // Object keys embed the feedback id, so mint it before the row exists.
  const feedbackId = randomUUID();
  const uploaded: { p: (typeof prepared)[number]; storagePath: string }[] = [];
  try {
    for (const p of prepared) {
      const key = buildFeedbackObjectKey({ feedbackId, originalName: p.file.originalname, contentType: p.contentType });
      await uploadAttachment({ key, buffer: p.file.buffer, mimeType: p.file.mimetype });
      uploaded.push({ p, storagePath: key });
    }

    // Nested create = feedback + attachments in a single transaction.
    const feedback = await prisma.feedback.create({
      data: {
        id: feedbackId,
        userId: input.userId,
        type,
        severity,
        subject,
        description,
        pageContext,
        attachments: {
          create: uploaded.map(({ p, storagePath }) => ({
            kind: p.kind,
            storagePath,
            originalName: p.file.originalname.slice(0, 255),
            mimeType: p.file.mimetype,
            sizeBytes: p.file.size,
            width: p.dims?.width ?? null,
            height: p.dims?.height ?? null,
          })),
        },
      },
      include: { attachments: true },
    });
    return serializeFeedback(feedback);
  } catch (err) {
    await deleteObjects(uploaded.map((u) => u.storagePath));
    throw err;
  }
}

// ─── Lists ────────────────────────────────────────────────────────────────────
// Feedback is ordered newest-first (createdAt desc) — the opposite of chat's
// ascending timeline — so a page of "more" is strictly OLDER than the cursor.
// beforeCursorWhere's (createdAt, id) tuple comparison is order-agnostic, so
// it's reused as-is from lib/chat.ts rather than reimplemented here.

export interface ListFeedbackOptions {
  limit?: number;
  cursor?: string;
}

export interface FeedbackPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Cursor anchor → WHERE fragment. An unknown/stale cursor id is treated as
 * no cursor (restart pagination) rather than a 500. */
async function resolveCursorWhere(cursor: string | undefined): Promise<Prisma.FeedbackWhereInput> {
  if (!cursor) return {};
  const anchor = await prisma.feedback.findUnique({
    where: { id: cursor },
    select: { id: true, createdAt: true },
  });
  return anchor ? beforeCursorWhere(anchor) : {};
}

/** Trim a `limit + 1` fetch down to a page + nextCursor, without a second query. */
function paginate<T extends { id: string }>(rows: T[], limit: number): FeedbackPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function listMyFeedback(userId: string, opts: ListFeedbackOptions = {}) {
  const limit = clampPageSize(opts.limit);
  const rows = await prisma.feedback.findMany({
    where: { userId, ...(await resolveCursorWhere(opts.cursor)) },
    include: { attachments: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const { items, nextCursor } = paginate(rows, limit);
  return { items: items.map(serializeFeedback), nextCursor };
}

export interface FeedbackFilters {
  status?: string;
  type?: string;
  severity?: string;
}

export interface ListAllFeedbackOptions extends FeedbackFilters, ListFeedbackOptions {}

/** Admin-only (enforced by requireAdmin in the routes) — all users' feedback. */
export async function listAllFeedback(options: ListAllFeedbackOptions = {}) {
  const limit = clampPageSize(options.limit);
  const where: Prisma.FeedbackWhereInput = { ...(await resolveCursorWhere(options.cursor)) };
  if (isEnumValue(FeedbackStatus, options.status)) where.status = options.status;
  if (isEnumValue(FeedbackType, options.type)) where.type = options.type;
  if (isEnumValue(FeedbackSeverity, options.severity)) where.severity = options.severity;

  const rows = await prisma.feedback.findMany({
    where,
    include: { attachments: true, user: { select: submitterSelect } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const { items, nextCursor } = paginate(rows, limit);
  return { items: items.map(serializeFeedback), nextCursor };
}

// ─── Triage ───────────────────────────────────────────────────────────────────

/** Admin-only (enforced by requireAdmin in the routes). */
export async function updateFeedbackStatus(
  feedbackId: string,
  updates: { status?: unknown; adminNotes?: unknown },
) {
  const data: Prisma.FeedbackUpdateInput = {};

  if (updates.status !== undefined) {
    if (!isEnumValue(FeedbackStatus, updates.status)) {
      throw new AppError(400, 'Status must be OPEN, IN_PROGRESS, RESOLVED, or WONT_FIX.');
    }
    data.status = updates.status;
  }
  if (updates.adminNotes !== undefined) {
    if (updates.adminNotes !== null && typeof updates.adminNotes !== 'string') {
      throw new AppError(400, 'Admin notes must be text.');
    }
    const notes = typeof updates.adminNotes === 'string' ? updates.adminNotes.trim() : '';
    if (notes.length > MAX_ADMIN_NOTES_LENGTH) {
      throw new AppError(400, `Admin notes must be at most ${MAX_ADMIN_NOTES_LENGTH.toLocaleString()} characters.`);
    }
    data.adminNotes = notes || null;
  }
  if (Object.keys(data).length === 0) {
    throw new AppError(400, 'Nothing to update — provide a status and/or admin notes.');
  }

  try {
    const feedback = await prisma.feedback.update({
      where: { id: feedbackId },
      data,
      include: { attachments: true, user: { select: submitterSelect } },
    });
    return serializeFeedback(feedback);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new AppError(404, 'Feedback not found.');
    }
    throw err;
  }
}

// ─── Attachments ──────────────────────────────────────────────────────────────

/**
 * Signed URL for one attachment. 403 unless the caller is the ADMIN or the
 * attachment's feedback belongs to them — this endpoint serves both audiences,
 * so ownership is checked here rather than in route middleware. Also verifies
 * the attachment actually belongs to the feedbackId in the route (a
 * mismatched pair would otherwise silently succeed since only attachmentId
 * was previously checked) — same not-found message as the missing-attachment
 * branch so the endpoint doesn't become an existence oracle.
 */
export async function getAttachmentSignedUrl(
  feedbackId: string,
  attachmentId: string,
  requestingUserId: string,
  isAdmin: boolean,
): Promise<string> {
  const attachment = await prisma.feedbackAttachment.findUnique({
    where: { id: attachmentId },
    select: { storagePath: true, feedbackId: true, feedback: { select: { userId: true } } },
  });
  if (!attachment || attachment.feedbackId !== feedbackId) throw new AppError(404, 'Attachment not found.');
  if (!isAdmin && attachment.feedback.userId !== requestingUserId) {
    throw new AppError(403, 'You do not have permission to view this attachment.');
  }
  return signAttachmentUrl(attachment.storagePath);
}
