// 9.5 and 9.6 on real Postgres: members report and block by message id (other
// members' account ids aren't sent, 9.0.3); outsiders get 404; a report keeps
// a snapshot and can't be forged through POST /feedback; the admin can remove
// the message from triage; a block hides the sender's messages from the
// blocker only, and a former member's messages stay.
import assert from 'node:assert/strict';
import { prisma, startApp, makeUser, makeTeam, addMember, cleanup, call } from './harness';
import { SNAPSHOT_MARKER, REMOVED_WITH_TEAM } from '../lib/messageReport';

async function main() {
  const app = await startApp();
  try {
    const owner = await makeUser('mod-owner');
    const reporter = await makeUser('mod-reporter');
    const sender = await makeUser('mod-sender');
    const outsider = await makeUser('mod-outsider');
    const admin = await makeUser('mod-admin');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const team = await makeTeam(owner, 'Moderation');
    await addMember(team.id, reporter, 'PLAYER');
    await addMember(team.id, sender, 'PLAYER');
    const channel = await prisma.channel.create({ data: { teamId: team.id, type: 'TEAM' } });
    const say = (userId: string | null, body: string) => prisma.message.create({ data: { channelId: channel.id, senderId: userId, body } });
    const rude = await say(sender.id, 'you are useless');
    const own = await say(reporter.id, 'my own');
    const former = await say(null, 'from before');
    const report = (token: string, id: string, body: unknown = { reason: 'harassment', note: 'twice now' }) =>
      call(app.base, 'POST', `/api/v1/messages/${id}/report`, token, body);

    // Report.
    assert.equal((await report(outsider.token, rude.id)).status, 404, 'an outsider learns nothing');
    assert.equal((await report(reporter.token, own.id)).status, 400, 'not your own message');
    assert.equal((await report(reporter.token, rude.id, { reason: 'rude' })).status, 400, 'a listed reason');
    const made = await report(reporter.token, rude.id);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: made.body.id } });
    assert.deepEqual([row.type, row.userId, row.reportedMessageId, row.pageContext], ['MESSAGE_REPORT', reporter.id, rude.id, `/teams/${team.id}/chat`]);
    assert.ok(row.description.includes(`${SNAPSHOT_MARKER}\nyou are useless`), 'the snapshot keeps the evidence');
    assert.match(row.description, /Reason: harassment\nNote: twice now/);
    assert.equal((await report(reporter.token, rude.id)).body.id, made.body.id, 'a repeat returns the open report');
    const forged = await call(app.base, 'POST', '/api/v1/feedback', reporter.token, { type: 'MESSAGE_REPORT', subject: 's', description: 'd' });
    assert.equal(forged.status, 400, 'reports only come from the report route');

    // The admin removes it from triage (not a member of the team).
    const removed = await call(app.base, 'DELETE', `/api/v1/messages/${rude.id}`, admin.token);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: rude.id } })).body, null, 'erased');
    assert.equal((await report(owner.token, rude.id)).status, 409, 'a removed message can no longer be reported');

    // Block.
    const again = await say(sender.id, 'still here');
    const block = (token: string, id: string) => call(app.base, 'POST', `/api/v1/messages/${id}/block-sender`, token);
    assert.equal((await block(outsider.token, again.id)).status, 404);
    assert.equal((await block(reporter.token, own.id)).status, 400, "you can't block yourself");
    assert.equal((await block(reporter.token, former.id)).status, 409, 'a former member has no account to block');
    assert.equal((await block(reporter.token, again.id)).status, 204);
    assert.equal((await block(reporter.token, again.id)).status, 204, 'idempotent');

    const seen = async (token: string) => ((await call(app.base, 'GET', `/api/v1/channels/${channel.id}/messages`, token)).body as { id: string }[]).map((m) => m.id);
    const forReporter = await seen(reporter.token);
    assert.ok(!forReporter.includes(again.id) && !forReporter.includes(rude.id), "the blocked member's messages are hidden");
    assert.ok(forReporter.includes(own.id) && forReporter.includes(former.id), "own and former members' messages stay");
    assert.ok((await seen(owner.token)).includes(again.id), 'nobody else is affected');

    const blocks = await call(app.base, 'GET', '/api/v1/users/me/blocks', reporter.token);
    assert.deepEqual(blocks.body.map((b: { name: string }) => b.name), ['mod-sender Test']);
    assert.ok(!JSON.stringify(blocks.body).includes(sender.id), 'the list never carries account ids');
    const blockId = blocks.body[0].id;
    assert.equal((await call(app.base, 'DELETE', `/api/v1/users/me/blocks/${blockId}`, owner.token)).status, 404, "not someone else's block");
    assert.equal((await call(app.base, 'DELETE', `/api/v1/users/me/blocks/${blockId}`, reporter.token)).status, 204);
    assert.ok((await seen(reporter.token)).includes(again.id), 'unblocked: back again');

    // Deleting the team erases its chat, the reports' copies included (audit).
    await prisma.feedback.update({ where: { id: made.body.id }, data: { description: `Reason: spam\n${SNAPSHOT_MARKER}\nstill here` } });
    await prisma.$executeRaw`UPDATE feedback SET reported_message_id = ${again.id} WHERE id = ${made.body.id}`;
    await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: 'x' } });
    const gone = await call(app.base, 'DELETE', `/api/v1/teams/${team.id}`, owner.token);
    assert.equal(gone.status, 204, JSON.stringify(gone.body));
    assert.equal((await prisma.feedback.findUniqueOrThrow({ where: { id: made.body.id } })).description,
      `Reason: spam\n${SNAPSHOT_MARKER}\n${REMOVED_WITH_TEAM}`, 'the report keeps its reason, not the chat');

    console.log('moderation: all tests passed');
  } finally {
    await app.close();
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
