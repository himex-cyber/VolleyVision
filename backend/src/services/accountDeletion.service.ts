// Account deletion (9.4; Apple 5.1.1(v), Google Play). Design reviewed before
// any code: .claude/rebuild/9.4-deletion-design.md. The account and what it
// shared go; team history stays, anonymised:
//   - messages they sent: text and files erased, sender cleared ("Message from
//     a former member was removed")
//   - player records linked to them: renamed "Former player", stats kept
//   - their audit rows: user id replaced by DELETED_USER_ID
//   - their email and account id: removed from invitations, audit meta,
//     approval payloads, report snapshots and rate-limit keys
// Owned teams (and, for legacy data, head-coach roles) block it: 409.
// Used by DELETE /profile (with the password) and scripts/delete-account.ts
// (Karlos, for requests by email).

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { normalizeEmail } from '../lib/email';
import { sendMail } from '../lib/mailer';
import { removeStoredFiles } from '../lib/storageCleanup';
import { DELETED_USER_ID, blockersMessage, deletionBlockers } from '../lib/accountDeletion';
import { REMOVED_SNAPSHOT, SNAPSHOT_MARKER } from '../lib/messageReport';
import { verifyPassword } from './auth.service';

type Db = Prisma.TransactionClient;

async function blockers(db: Db, userId: string) {
  const [owned, headCoach] = await Promise.all([
    db.team.findMany({ where: { ownerId: userId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.teamMembership.findMany({
      where: { userId, role: 'HEAD_COACH', team: { ownerId: { not: userId } } },
      select: { team: { select: { id: true, name: true } } },
    }),
  ]);
  return deletionBlockers(owned, headCoach.map((m) => m.team));
}

function refuse(found: Awaited<ReturnType<typeof blockers>>): never {
  throw new AppError(409, blockersMessage(found), 'ACCOUNT_HAS_TEAMS', { teams: found });
}

export interface DeletionDeps {
  removeFiles: (paths: string[]) => Promise<number>;
  notify: (email: string) => Promise<unknown>;
}

const confirmationEmail = (to: string) => sendMail({
  to,
  subject: 'Your VolleyVision account has been deleted',
  text: 'Your VolleyVision account has been deleted, as you asked. Your messages and files are gone, and your name has been taken off the stats your teams keep.\n\nIf you didn\'t ask for this, reply to this email.',
  html: '<p>Your VolleyVision account has been deleted, as you asked. Your messages and files are gone, and your name has been taken off the stats your teams keep.</p><p>If you didn\'t ask for this, reply to this email.</p>',
});

const defaultDeps: DeletionDeps = { removeFiles: removeStoredFiles, notify: confirmationEmail };

/** Deletes the account. No password check: the endpoint and the admin script do their own. */
export async function deleteAccount(userId: string, deps: DeletionDeps = defaultDeps): Promise<void> {
  const files = await prisma.$transaction(async (tx) => {
    // Held to the end: any write that references this user (a message, a
    // membership, a team) waits, then fails once the row is gone (409).
    await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user) throw new AppError(401, 'Your session has ended. Sign in again.');
    const found = await blockers(tx, userId);
    if (found.length) refuse(found);
    const email = normalizeEmail(user.email);

    // Everything that must be read before the rows go.
    const [messageFiles, feedbackFiles, players] = await Promise.all([
      tx.messageAttachment.findMany({
        where: { OR: [{ message: { senderId: userId } }, { uploadedByUserId: userId }] },
        select: { storagePath: true },
      }),
      tx.feedbackAttachment.findMany({ where: { feedback: { userId } }, select: { storagePath: true } }),
      tx.player.findMany({ where: { userId }, select: { id: true } }),
    ]);
    const playerIds = players.map((p) => p.id);

    // Reports about their messages keep the reason and time, not the text.
    // Before sender_id is cleared: it's how their messages are found.
    await tx.$executeRaw`
      UPDATE feedback SET description = regexp_replace(description, ${SNAPSHOT_MARKER + '\n'} || '.*$', ${SNAPSHOT_MARKER + '\n' + REMOVED_SNAPSHOT})
      WHERE type = 'MESSAGE_REPORT' AND reported_message_id IN (SELECT id FROM messages WHERE sender_id = ${userId})`;

    await tx.messageAttachment.deleteMany({ where: { OR: [{ message: { senderId: userId } }, { uploadedByUserId: userId }] } });
    await tx.$executeRaw`
      UPDATE messages SET body = NULL, sender_id = NULL, deleted_by_user_id = NULL, deleted_at = COALESCE(deleted_at, now())
      WHERE sender_id = ${userId}`;
    await tx.$executeRaw`UPDATE messages SET deleted_by_user_id = NULL WHERE deleted_by_user_id = ${userId}`;

    // Stats stay with the team; the name doesn't. A pending edit to one of
    // these records would put the name back, so it loses its names too.
    await tx.player.updateMany({ where: { userId }, data: { firstName: 'Former', lastName: 'player', userId: null } });
    if (playerIds.length) {
      await tx.$executeRaw`
        UPDATE approval_requests SET payload = payload - 'firstName' - 'lastName'
        WHERE action = 'PLAYER_UPDATE' AND target_id IN (${Prisma.join(playerIds)})`;
    }

    // Their email wherever it was typed: raw text, so compared trimmed and
    // lower-cased. Only once they proved it's theirs: anyone can sign up
    // unverified under an address a team has invited, and deleting that
    // account mustn't wipe the team's invitations and history (security review).
    const ownsEmail = user.emailVerifiedAt != null;
    if (ownsEmail) await tx.$executeRaw`DELETE FROM invitations WHERE lower(trim(email)) = ${email}`;
    if (ownsEmail) await tx.$executeRaw`
      UPDATE approval_requests SET payload = jsonb_set(payload, '{email}', 'null'),
        status = CASE WHEN status = 'PENDING' THEN 'REJECTED'::"ApprovalStatus" ELSE status END,
        resolved_at = CASE WHEN status = 'PENDING' THEN now() ELSE resolved_at END
      WHERE action = 'INVITATION_CREATE' AND lower(trim(payload->>'email')) = ${email}`;
    if (ownsEmail) await tx.$executeRaw`
      UPDATE audit_logs SET meta = jsonb_set(meta, '{email}', 'null')
      WHERE action = 'CREATE_INVITATION' AND lower(trim(meta->>'email')) = ${email}`;
    await tx.$executeRaw`
      UPDATE audit_logs SET meta = jsonb_set(meta, '{userId}', 'null')
      WHERE action IN ('LINK_PLAYER', 'UNLINK_PLAYER') AND meta->>'userId' = ${userId}`;
    await tx.$executeRaw`UPDATE audit_logs SET user_id = ${DELETED_USER_ID} WHERE user_id = ${userId}`;

    // RESTRICT, and deleting them would take their events: the team owner
    // (never this user, see blockers) takes them over.
    await tx.$executeRaw`
      UPDATE training_sessions ts SET created_by_user_id = t.owner_id
      FROM teams t WHERE t.id = ts.team_id AND ts.created_by_user_id = ${userId}`;

    // Every limiter key naming them: login:email:, forgot:email: and each
    // <limiter>:user:<id>. Ids are cuids, so no LIKE wildcards to escape.
    const emailKeys = ownsEmail ? [`login:email:${email}`, `forgot:email:${email}`] : [];
    await tx.$executeRaw`
      DELETE FROM rate_limit_buckets
      WHERE key IN (${Prisma.join([...emailKeys, ''])}) OR key LIKE ${'%:user:' + userId}`;

    // Memberships, feedback, invitations they sent, blocks and approval
    // requests they made cascade. Their tokens stop working with the row.
    await tx.user.delete({ where: { id: userId } });
    return { email, paths: [...messageFiles, ...feedbackFiles].map((f) => f.storagePath) };
  }, { timeout: 10_000, maxWait: 5_000 });

  // Best effort, after commit: neither may undo a finished deletion.
  await deps.removeFiles(files.paths);
  await deps.notify(files.email).catch(() => undefined);
}

/** DELETE /profile: the account's own password, then the deletion. */
export async function deleteAccountWithPassword(userId: string, password: unknown): Promise<void> {
  if (typeof password !== 'string' || !password) throw new AppError(400, 'Enter your password.');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, role: true } });
  if (!user) throw new AppError(401, 'Your session has ended. Sign in again.');
  // 403, not 401: the app signs out on any 401, and this is only a typo.
  if (!(await verifyPassword(password, user.passwordHash))) throw new AppError(403, "That password isn't right.", 'WRONG_PASSWORD');
  if (user.role === 'ADMIN') throw new AppError(403, 'An admin account is deleted with the admin script, not in the app.');
  // Checked here too, so a blocked request is refused without a transaction.
  const found = await blockers(prisma, userId);
  if (found.length) refuse(found);
  await deleteAccount(userId);
}

/** What deleteAccount would touch, counts only (the admin script's dry run). */
export async function planAccountDeletion(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  if (!user) return null;
  const email = normalizeEmail(user.email);
  const ownsEmail = user.emailVerifiedAt != null; // as deleteAccount: unverified addresses aren't matched
  const [found, messages, files, players, invitations, auditRows] = await Promise.all([
    blockers(prisma, userId),
    prisma.message.count({ where: { senderId: userId } }),
    prisma.messageAttachment.count({ where: { OR: [{ message: { senderId: userId } }, { uploadedByUserId: userId }] } }),
    prisma.player.count({ where: { userId } }),
    // Compared as the deletion does: the address was typed, maybe with spaces.
    ownsEmail
      ? prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM invitations WHERE lower(trim(email)) = ${email}`.then(([row]) => Number(row.n))
      : 0,
    prisma.auditLog.count({ where: { userId } }),
  ]);
  return { blockers: found, messages, files, players, invitations, auditRows };
}
