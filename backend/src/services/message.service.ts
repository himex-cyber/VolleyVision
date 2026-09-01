// Team Chat — message read/write service. Permission gating happens in the
// route middleware (requireChannelPermission) and controller; this service
// enforces the author-level rules (edit own, delete own-or-moderated) and the
// soft-delete/tombstone contract.

import { AttachmentKind, MessageAttachment, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveUploadContentType } from '../lib/fileSignature';
import {
  afterCursorWhere,
  beforeCursorWhere,
  canDeleteMessage,
  clampPageSize,
  editRejection,
  serializeMessage,
  validateMessageBody,
  SerializedMessage,
} from '../lib/chat';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  assertAcceptable,
  buildObjectKey,
  deleteObjects,
  imageDimensions,
  signAttachmentUrls,
  uploadAttachment,
} from './chatStorage.service';

const senderSelect = {
  id: true,
  firstName: true,
  lastName: true,
  profileImage: true,
} as const;

const messageInclude = {
  sender: { select: senderSelect },
  attachments: true,
} as const;

function requireValidBody(raw: unknown): string {
  const result = validateMessageBody(raw);
  if (!result.ok) throw new AppError(400, result.error);
  return result.body;
}

// ─── Attachment DTOs ──────────────────────────────────────────────────────────

/** Public shape — storagePath never leaves the server; signedUrl is per-read. */
function toAttachmentDto(a: MessageAttachment, signedUrl: string | null) {
  return {
    id: a.id,
    kind: a.kind,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    signedUrl,
  };
}

/**
 * Swap raw attachment rows for signed DTOs across a page in one batched
 * Storage call. A failed signing yields signedUrl: null (the client renders
 * "unavailable") rather than failing the page.
 */
async function withSignedUrls(messages: SerializedMessage[]): Promise<SerializedMessage[]> {
  const paths = messages.flatMap((m) => (m.attachments as MessageAttachment[]).map((a) => a.storagePath));
  if (paths.length === 0) return messages;
  const urls = await signAttachmentUrls(paths);
  return messages.map((m) => ({
    ...m,
    attachments: (m.attachments as MessageAttachment[]).map((a) =>
      toAttachmentDto(a, urls.get(a.storagePath) ?? null),
    ),
  }));
}

/** Cursor anchor — the message a before/after page is relative to. */
async function getAnchor(channelId: string, messageId: string) {
  const anchor = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, createdAt: true, channelId: true },
  });
  if (!anchor || anchor.channelId !== channelId) {
    throw new AppError(404, 'Cursor message not found in this channel.');
  }
  return anchor;
}

export interface ListMessagesOptions {
  limit?: number;
  before?: string; // page of older messages (scroll-up)
  after?: string;  // only newer messages (poll delta)
}

/**
 * Messages in ascending (createdAt, id) order. With no cursor, returns the
 * LATEST page. Soft-deleted messages come back as tombstones — never omitted,
 * so ordering and cursors stay stable.
 */
export async function listMessages(channelId: string, opts: ListMessagesOptions = {}) {
  const limit = clampPageSize(opts.limit);

  let cursorWhere: Prisma.MessageWhereInput = {};
  // With no cursor (initial load) we want the newest page, so fetch descending
  // and flip; `before` pages older content the same way. `after` reads forward.
  let fetchDescending = true;
  if (opts.after) {
    cursorWhere = afterCursorWhere(await getAnchor(channelId, opts.after));
    fetchDescending = false;
  } else if (opts.before) {
    cursorWhere = beforeCursorWhere(await getAnchor(channelId, opts.before));
  }

  const rows = await prisma.message.findMany({
    where: { channelId, ...cursorWhere },
    include: messageInclude,
    orderBy: fetchDescending
      ? [{ createdAt: 'desc' }, { id: 'desc' }]
      : [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  if (fetchDescending) rows.reverse();
  return withSignedUrls(rows.map(serializeMessage));
}

/** Resend with a known Idempotency-Key → the existing message, not a duplicate. */
async function findByClientKey(channelId: string, clientKey: string) {
  const existing = await prisma.message.findUnique({
    where: { channelId_clientKey: { channelId, clientKey } },
    include: messageInclude,
  });
  if (!existing) return null;
  const [dto] = await withSignedUrls([serializeMessage(existing)]);
  return dto;
}

export async function postMessage(
  channelId: string,
  senderId: string,
  rawBody: unknown,
  clientKey?: string | null,
) {
  const body = requireValidBody(rawBody);
  if (clientKey) {
    const existing = await findByClientKey(channelId, clientKey);
    if (existing) return existing;
  }
  try {
    const message = await prisma.message.create({
      data: { channelId, senderId, body, clientKey: clientKey ?? null },
      include: messageInclude,
    });
    return serializeMessage(message);
  } catch (err) {
    // Two racing sends with the same key: the loser reads the winner's row.
    if (clientKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findByClientKey(channelId, clientKey);
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Attachment upload flow (slice 4): validate the WHOLE batch before uploading
 * anything, upload the bytes to Supabase, then create the Message and its
 * MessageAttachment rows in one atomic write. If anything fails after bytes
 * have landed in storage, the uploaded objects are deleted (compensating
 * cleanup) so a failed request leaves no orphans.
 */
export async function postMessageWithAttachments(
  channelId: string,
  senderId: string,
  rawBody: unknown,
  files: Express.Multer.File[],
  clientKey?: string | null,
) {
  // Body is optional on an upload — but when present it obeys the text rules.
  let body: string | null = null;
  if (typeof rawBody === 'string' && rawBody.trim().length > 0) {
    body = requireValidBody(rawBody);
  }
  if (!body && files.length === 0) {
    throw new AppError(400, 'A message needs text or at least one attachment.');
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AppError(400, `A message can have at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments.`);
  }

  // Idempotent retry: bail out BEFORE re-uploading any bytes.
  if (clientKey) {
    const existing = await findByClientKey(channelId, clientKey);
    if (existing) return existing;
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { teamId: true },
  });
  if (!channel) throw new AppError(404, 'Channel not found.');

  // Reject the whole batch up front so one bad file can't strand siblings
  // that were already uploaded.
  // contentType is verified against the file's bytes here so a byte/type
  // mismatch also rejects the batch up front. uploadAttachment re-derives it —
  // it stays the choke point that decides what Storage is actually told.
  const prepared = files.map((file) => ({
    file,
    kind: assertAcceptable(file),
    contentType: resolveUploadContentType(file.mimetype, file.buffer),
  })).map((p) => ({
    ...p,
    dims: p.kind === AttachmentKind.IMAGE ? imageDimensions(p.file.buffer) : null,
  }));

  // Object keys embed the message id, so mint it before the row exists
  // (a UUID — the id column accepts any unique string).
  const messageId = randomUUID();
  const uploaded: { p: (typeof prepared)[number]; storagePath: string }[] = [];
  try {
    for (const p of prepared) {
      const key = buildObjectKey({
        teamId: channel.teamId,
        channelId,
        messageId,
        originalName: p.file.originalname,
        contentType: p.contentType,
      });
      await uploadAttachment({ key, buffer: p.file.buffer, mimeType: p.file.mimetype });
      uploaded.push({ p, storagePath: key });
    }

    // Nested create = message + attachments in a single transaction.
    const message = await prisma.message.create({
      data: {
        id: messageId,
        channelId,
        senderId,
        body,
        clientKey: clientKey ?? null,
        attachments: {
          create: uploaded.map(({ p, storagePath }) => ({
            kind: p.kind,
            storagePath,
            fileName: p.file.originalname.slice(0, 255),
            mimeType: p.file.mimetype,
            sizeBytes: p.file.size,
            width: p.dims?.width ?? null,
            height: p.dims?.height ?? null,
            uploadedByUserId: senderId,
          })),
        },
      },
      include: messageInclude,
    });
    const [dto] = await withSignedUrls([serializeMessage(message)]);
    return dto;
  } catch (err) {
    await deleteObjects(uploaded.map((u) => u.storagePath));
    // A concurrent retry with the same key won the race — return its message.
    if (clientKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await findByClientKey(channelId, clientKey);
      if (existing) return existing;
    }
    throw err;
  }
}

/** Author-only; deletion is terminal (409 on a deleted message). Sets editedAt. */
export async function editMessage(messageId: string, userId: string, rawBody: unknown) {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, deletedAt: true },
  });
  if (!existing) throw new AppError(404, 'Message not found.');
  const rejection = editRejection(existing, userId);
  if (rejection) throw new AppError(rejection.status, rejection.error);

  const body = requireValidBody(rawBody);
  const message = await prisma.message.update({
    where: { id: messageId },
    data: { body, editedAt: new Date() },
    include: messageInclude,
  });
  // An edited message keeps its attachments — re-sign them for the response.
  const [dto] = await withSignedUrls([serializeMessage(message)]);
  return dto;
}

/**
 * Soft delete — author or moderator. Idempotent: deleting an already-deleted
 * message returns its tombstone unchanged (the original deleter is preserved).
 * `didDelete` is true only when THIS call performed the delete, so the caller
 * can audit moderation exactly once.
 */
export async function softDeleteMessage(messageId: string, userId: string, isModerator: boolean) {
  const existing = await prisma.message.findUnique({
    where: { id: messageId },
    include: messageInclude,
  });
  if (!existing) throw new AppError(404, 'Message not found.');
  if (existing.deletedAt) return { tombstone: serializeMessage(existing), didDelete: false };
  if (!canDeleteMessage(existing, userId, isModerator)) {
    throw new AppError(403, 'You can only delete your own messages.');
  }

  const message = await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), deletedByUserId: userId },
    include: messageInclude,
  });
  return { tombstone: serializeMessage(message), didDelete: true };
}
