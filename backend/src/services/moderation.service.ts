// Chat moderation by members (Apple 1.2, Play UGC): report a message (9.5)
// and block its sender (9.6). Both work by message id: other members' account
// ids aren't sent to the app (9.0.3). Callers have already checked that the
// caller is a member of the message's team.

import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { sendMail } from '../lib/mailer';
import { escapeHtml } from '../lib/escapeHtml';
import { buildReportDescription, parseReportInput } from '../lib/messageReport';

async function liveMessage(messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true, senderId: true, body: true, deletedAt: true, createdAt: true,
      attachments: { select: { fileName: true } },
      channel: { select: { team: { select: { id: true, name: true } } } },
    },
  });
  if (!message) throw new AppError(404, 'Message not found.');
  return message;
}

/**
 * A report goes to the global admins (Karlos) as a MESSAGE_REPORT feedback
 * row with a snapshot, so the evidence outlives the message. The email says
 * only that there is one: no message text in anyone's inbox (players can be
 * minors). The same member reporting the same message again gets the open one.
 */
export async function reportMessage(userId: string, messageId: string, input: unknown) {
  const parsed = parseReportInput(input);
  if ('error' in parsed) throw new AppError(400, parsed.error);
  const message = await liveMessage(messageId);
  if (message.senderId === userId) throw new AppError(400, "You can't report your own message.");
  if (message.deletedAt) throw new AppError(409, 'That message has already been removed.');

  const existing = await prisma.feedback.findFirst({
    where: { userId, type: 'MESSAGE_REPORT', reportedMessageId: messageId, status: { notIn: ['RESOLVED', 'WONT_FIX'] } },
    select: { id: true },
  });
  if (existing) return existing;

  const team = message.channel.team;
  const report = await prisma.feedback.create({
    data: {
      userId,
      type: 'MESSAGE_REPORT',
      subject: 'Reported message',
      reportedMessageId: messageId,
      pageContext: `/teams/${team.id}/chat`,
      description: buildReportDescription({
        ...parsed, teamName: team.name, reportedAt: new Date(), sentAt: message.createdAt,
        body: message.body, fileNames: message.attachments.map((a) => a.fileName),
      }),
    },
    select: { id: true },
  });

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { email: true } });
  const line = `A message was reported in ${team.name}. Review it in VolleyVision → Feedback.`;
  await Promise.all(admins.map((a) => sendMail({
    to: a.email,
    subject: 'A chat message was reported',
    text: line,
    html: `<p>${escapeHtml(line)}</p>`,
  })));
  return report;
}

/** Blocks the message's sender for the caller. Idempotent. */
export async function blockSender(userId: string, messageId: string) {
  const message = await liveMessage(messageId);
  if (!message.senderId) throw new AppError(409, 'That member has left VolleyVision.');
  if (message.senderId === userId) throw new AppError(400, "You can't block yourself.");
  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: message.senderId } },
    update: {},
    create: { blockerId: userId, blockedId: message.senderId },
  });
}

/** The caller's blocks: the block's own id and the member's name, never their account id. */
export async function listBlocks(userId: string) {
  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    select: { id: true, blocked: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return blocks.map((b) => ({ id: b.id, name: `${b.blocked.firstName} ${b.blocked.lastName}` }));
}

export async function unblock(userId: string, blockId: string) {
  const { count } = await prisma.userBlock.deleteMany({ where: { id: blockId, blockerId: userId } });
  if (count === 0) throw new AppError(404, 'Block not found.');
}

/** Account ids whose messages this caller doesn't see (listMessages). */
export async function blockedSenderIds(userId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  return rows.map((r) => r.blockedId);
}
