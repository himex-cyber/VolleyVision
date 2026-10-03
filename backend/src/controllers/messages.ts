// Team Chat — controllers. Channel-scoped permission checks live in the route
// middleware; message-scoped routes (PATCH/DELETE) resolve the message's team
// here to compute membership + moderator status, since the author-level rules
// are enforced in message.service.

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { assertTeamVisible } from '../lib/teamVisibility';
import { getOrCreateTeamChannel } from '../services/teamChannel.service';
import {
  listMessages,
  postMessage,
  postMessageWithAttachments,
  editMessage,
  softDeleteMessage,
} from '../services/message.service';
import {
  Permission,
  canModerateChannel,
  hasTeamPermission,
} from '../services/permission.service';
import { logAudit } from '../lib/audit';
import { assertTermsAccepted } from '../services/auth.service';
import { reportMessage, blockSender, listBlocks, unblock } from '../services/moderation.service';
import { idempotencyKey } from '../lib/idempotencyKey';


export async function getTeamChannel(req: Request, res: Response, next: NextFunction) {
  try {
    const channel = await getOrCreateTeamChannel(req.params.teamId);
    res.json(channel);
  } catch (err) {
    next(err);
  }
}

export async function listChannelMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const { limit, before, after } = req.query;
    const messages = await listMessages(req.params.channelId, req.user!.userId, {
      limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      before: typeof before === 'string' ? before : undefined,
      after: typeof after === 'string' ? after : undefined,
    });
    res.json(messages);
  } catch (err) {
    next(err);
  }
}

export async function postChannelMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const message = await postMessage(
      req.params.channelId,
      req.user.userId,
      req.body?.body,
      idempotencyKey(req),
    );
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}

/** Multipart: optional `body` field + `files[]` (slice 4). */
export async function uploadChannelMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const message = await postMessageWithAttachments(
      req.params.channelId,
      req.user.userId,
      req.body?.body,
      files,
      idempotencyKey(req),
    );
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
}

/** Resolve the team a message belongs to (404 if the message doesn't exist). */
/**
 * The message's team, once the caller is known to be able to see it: a
 * non-member gets the same 404 as for a message that doesn't exist, so a
 * message id never confirms anything to an outsider.
 */
async function getVisibleMessageTeamId(messageId: string, userId: string): Promise<string> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { channel: { select: { teamId: true } } },
  });
  if (!message) throw new AppError(404, 'Message not found.');
  await assertTeamVisible(message.channel.teamId, userId, 'Message not found.');
  return message.channel.teamId;
}

export async function updateMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const teamId = await getVisibleMessageTeamId(req.params.messageId, req.user.userId);
    // Editing is a form of posting — a member removed from the team (or demoted
    // to VIEWER) loses it immediately, even for their own old messages.
    const allowed = await hasTeamPermission(req.user.userId, teamId, Permission.POST_MESSAGE);
    if (!allowed) throw new AppError(403, 'You do not have permission to perform this action.');
    await assertTermsAccepted(req.user.userId);
    const message = await editMessage(req.params.messageId, req.user.userId, req.body?.body);
    res.json(message);
  } catch (err) {
    next(err);
  }
}

export async function deleteMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');
    const teamId = await getVisibleMessageTeamId(req.params.messageId, req.user.userId);
    const isModerator = await canModerateChannel(req.user.userId, teamId);
    if (!isModerator) {
      // Author self-delete still requires live team membership.
      const member = await hasTeamPermission(req.user.userId, teamId, Permission.VIEW_TEAM);
      if (!member) throw new AppError(403, 'You do not have permission to perform this action.');
    }
    const { tombstone, didDelete } = await softDeleteMessage(
      req.params.messageId,
      req.user.userId,
      isModerator,
    );
    // Moderation leaves an audit trail; author self-deletes don't.
    if (didDelete && isModerator && tombstone.senderId !== req.user.userId) {
      logAudit(req.user.userId, 'message.delete', 'message', tombstone.id, {
        channelId: tombstone.channelId,
        moderator: true,
      });
    }
    res.json(tombstone);
  } catch (err) {
    next(err);
  }
}

/** Message-scoped moderation by members (9.5, 9.6): a member of its team, else the same 404 as a missing message. */
async function assertMessageMember(messageId: string, userId: string): Promise<void> {
  const teamId = await getVisibleMessageTeamId(messageId, userId);
  if (!(await hasTeamPermission(userId, teamId, Permission.VIEW_TEAM))) throw new AppError(404, 'Message not found.');
}

/** POST /messages/:messageId/report (9.5). */
export async function reportMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await assertMessageMember(req.params.messageId, req.user!.userId);
    const report = await reportMessage(req.user!.userId, req.params.messageId, req.body);
    res.status(201).json({ id: report.id });
  } catch (err) {
    next(err);
  }
}

/** POST /messages/:messageId/block-sender (9.6). */
export async function blockSenderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await assertMessageMember(req.params.messageId, req.user!.userId);
    await blockSender(req.user!.userId, req.params.messageId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** GET /users/me/blocks (9.6). */
export async function listBlocksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listBlocks(req.user!.userId));
  } catch (err) {
    next(err);
  }
}

/** DELETE /users/me/blocks/:blockId (9.6). */
export async function unblockHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await unblock(req.user!.userId, req.params.blockId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
