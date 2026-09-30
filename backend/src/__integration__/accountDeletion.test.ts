// 9.4 on real Postgres: DELETE /profile removes the account and every trace of
// its email and id, keeps the team's stats and history anonymised, and refuses
// while the person owns (or, in legacy data, head-coaches) a team.
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { prisma, startApp, makeUser, makeTeam, addMember, cleanup, call, RUN } from './harness';
import { DELETED_USER_ID } from '../lib/accountDeletion';
import { SNAPSHOT_MARKER, REMOVED_SNAPSHOT } from '../lib/messageReport';

const PASSWORD = 'correct horse battery';

async function main() {
  const app = await startApp();
  try {
    const owner = await makeUser('owner');
    const leaver = await makeUser('leaver');
    await prisma.user.update({ where: { id: leaver.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    const team = await makeTeam(owner, 'Deletion');
    await addMember(team.id, leaver, 'PLAYER');

    // Stats they're part of.
    const record = await prisma.player.create({ data: { teamId: team.id, firstName: 'Lea', lastName: 'Ver', jerseyNumber: 9, position: 'SETTER', userId: leaver.id } });
    const match = await prisma.match.create({ data: { teamId: team.id, opponent: 'X', matchDate: new Date(), status: 'IN_PROGRESS' } });
    await prisma.event.create({ data: { matchId: match.id, playerId: record.id, eventType: 'KILL', setNumber: 1 } });
    const session = await prisma.trainingSession.create({ data: { teamId: team.id, sessionDate: new Date(), createdByUserId: leaver.id } });

    // Chat: their message with a file, another's they moderated, a report about theirs.
    const channel = await prisma.channel.create({ data: { teamId: team.id, type: 'TEAM' } });
    const theirs = await prisma.message.create({
      data: { channelId: channel.id, senderId: leaver.id, body: 'my words',
        attachments: { create: { kind: 'FILE', storagePath: `teams/${team.id}/f.pdf`, fileName: 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1, uploadedByUserId: leaver.id } } },
    });
    const moderated = await prisma.message.create({ data: { channelId: channel.id, senderId: owner.id, body: null, deletedAt: new Date(), deletedByUserId: leaver.id } });
    const report = await prisma.feedback.create({
      data: { userId: owner.id, type: 'MESSAGE_REPORT', subject: 'Reported message', reportedMessageId: theirs.id,
        description: `Reason: harassment\nTime: now\n${SNAPSHOT_MARKER}\nmy words\nf.pdf` },
    });
    await prisma.feedback.create({
      data: { userId: leaver.id, type: 'BUG', subject: 'x', description: 'x',
        attachments: { create: { kind: 'FILE', storagePath: 'feedback/x/y.pdf', originalName: 'y.pdf', mimeType: 'application/pdf', sizeBytes: 1 } } },
    });

    // Their email typed elsewhere, padded and mixed-case.
    const typed = `  ${leaver.email.toUpperCase()} `;
    for (const [i, status] of (['PENDING', 'ACCEPTED', 'DECLINED'] as const).entries()) {
      await prisma.invitation.create({ data: { email: typed, teamId: team.id, invitedById: owner.id, role: 'PLAYER', status, token: `${RUN}-del-${i}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    }
    await prisma.auditLog.createMany({ data: [
      { userId: leaver.id, action: 'UPDATE_TEAM', resource: 'team', resourceId: team.id },
      { userId: owner.id, action: 'CREATE_INVITATION', resource: 'invitation', meta: { teamId: team.id, email: typed, role: 'PLAYER' } },
      { userId: owner.id, action: 'LINK_PLAYER', resource: 'player', resourceId: record.id, meta: { teamId: team.id, userId: leaver.id } },
    ] });
    const inviteApproval = await prisma.approvalRequest.create({ data: { teamId: team.id, requestedById: owner.id, action: 'INVITATION_CREATE', payload: { email: typed, role: 'PLAYER' } } });
    const renameApproval = await prisma.approvalRequest.create({ data: { teamId: team.id, requestedById: owner.id, action: 'PLAYER_UPDATE', targetId: record.id, payload: { firstName: 'Lea', lastName: 'Ver', jerseyNumber: 10 } } });
    await prisma.userBlock.createMany({ data: [{ blockerId: leaver.id, blockedId: owner.id }, { blockerId: owner.id, blockedId: leaver.id }] });
    await prisma.$executeRaw`INSERT INTO rate_limit_buckets (key, tokens, updated_at, full_at) VALUES
      (${'login:email:' + leaver.email}, 1, now(), now()), (${'chat:user:' + leaver.id}, 1, now(), now()), (${'chat:user:' + owner.id}, 1, now(), now())`;

    // Refusals first.
    const del = (token: string, password?: string) => call(app.base, 'DELETE', '/api/v1/profile', token, password === undefined ? {} : { password });
    assert.equal((await del(leaver.token)).status, 400, 'no password');
    const wrong = await del(leaver.token, 'nope');
    assert.equal(wrong.status, 403, 'a wrong password is 403, not 401 (the app signs out on 401)');
    assert.equal(wrong.body.code, 'WRONG_PASSWORD');
    assert.ok(await prisma.user.findUnique({ where: { id: leaver.id } }), 'still there');

    const ownerTry = await del(owner.token, 'x');
    // The owner's harness hash isn't a real bcrypt hash, so give them one.
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    const refused = await del(owner.token, PASSWORD);
    assert.equal(ownerTry.status, 403);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ACCOUNT_HAS_TEAMS');
    assert.deepEqual(refused.body.teams, [{ id: team.id, name: team.name, reason: 'owner' }]);
    assert.match(refused.body.error, /Transfer or delete these teams first/);

    const coach = await makeUser('legacy-coach');
    await prisma.user.update({ where: { id: coach.id }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    const other = await prisma.team.create({ data: { name: `${RUN} Other`, season: '2026', ownerId: owner.id } });
    await addMember(other.id, coach, 'HEAD_COACH');
    const legacy = await del(coach.token, PASSWORD);
    assert.equal(legacy.status, 409, 'head coach of a team they do not own');
    assert.equal(legacy.body.teams[0].reason, 'head_coach');

    // The deletion.
    const done = await del(leaver.token, PASSWORD);
    assert.equal(done.status, 204, JSON.stringify(done.body));

    assert.equal(await prisma.user.findUnique({ where: { id: leaver.id } }), null, 'the account is gone');
    const m = await prisma.message.findUniqueOrThrow({ where: { id: theirs.id }, include: { attachments: true } });
    assert.deepEqual([m.body, m.senderId, m.attachments.length, !!m.deletedAt], [null, null, 0, true], 'their message is erased');
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: moderated.id } })).deletedByUserId, null);
    const p = await prisma.player.findUniqueOrThrow({ where: { id: record.id }, include: { events: true } });
    assert.deepEqual([p.firstName, p.lastName, p.userId, p.jerseyNumber, p.events.length], ['Former', 'player', null, 9, 1], 'stats stay, the name goes');
    assert.equal((await prisma.feedback.findUniqueOrThrow({ where: { id: report.id } })).description,
      `Reason: harassment\nTime: now\n${SNAPSHOT_MARKER}\n${REMOVED_SNAPSHOT}`, 'the report keeps reason and time only');
    assert.equal(await prisma.invitation.count({ where: { token: { startsWith: `${RUN}-del-` } } }), 0, 'invitations in every status');
    const inv = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: inviteApproval.id } });
    assert.deepEqual([(inv.payload as any).email, inv.status], [null, 'REJECTED'], 'a pending invite to them is withdrawn');
    assert.ok(!('firstName' in ((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: renameApproval.id } })).payload as object)));
    const audits = await prisma.auditLog.findMany({ where: { OR: [{ userId: DELETED_USER_ID }, { resourceId: record.id }, { action: 'CREATE_INVITATION', userId: owner.id }] } });
    assert.ok(audits.some((a) => a.userId === DELETED_USER_ID && a.action === 'UPDATE_TEAM'), 'their audit rows stay, anonymised');
    assert.equal((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).createdByUserId, owner.id);
    assert.equal(await prisma.userBlock.count({ where: { OR: [{ blockerId: leaver.id }, { blockedId: leaver.id }] } }), 0);
    const keys = await prisma.$queryRaw<{ key: string }[]>`SELECT key FROM rate_limit_buckets WHERE key LIKE '%:user:%' OR key LIKE 'login:%'`;
    assert.ok(!keys.some((k) => k.key.includes(leaver.id) || k.key.includes(leaver.email)), 'their limiter keys are gone');
    assert.ok(keys.some((k) => k.key === `chat:user:${owner.id}`), "someone else's stays");

    // Nothing anywhere still holds their email or account id.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    for (const { tablename } of tables) {
      const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "${tablename}" x WHERE row_to_json(x)::text ILIKE $1 OR row_to_json(x)::text LIKE $2`,
        `%${leaver.email}%`, `%${leaver.id}%`,
      );
      assert.equal(Number(n), 0, `${tablename} still holds their email or id`);
    }
    // Control: the same scan does find someone who still exists.
    const [{ n: ownerRows }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*) AS n FROM users x WHERE row_to_json(x)::text ILIKE $1', `%${owner.email}%`);
    assert.equal(Number(ownerRows), 1, 'the scan works');

    assert.equal((await del(leaver.token, PASSWORD)).status, 401, 'the old session is dead');
    console.log('accountDeletion: all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
