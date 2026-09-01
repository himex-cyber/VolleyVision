// Team Chat slice 4 — attachment upload verification. Exercises the upload
// endpoint over HTTP against the running dev server (image + PDF in one
// message, size/type/empty rejections), then forces a DB failure in-process
// to prove the compensating cleanup leaves no orphaned objects in the bucket.
// Creates a throwaway member on the seeded team and removes everything after.
//
// Run: npx ts-node scripts/verify-chat-uploads.ts   (server must be up)

import assert from 'node:assert/strict';
import { PrismaClient, TeamRole } from '@prisma/client';
import { prisma as serviceprisma } from '../src/lib/prisma';
import { getSupabaseClient } from '../src/lib/supabase';
import { postMessageWithAttachments } from '../src/services/message.service';

const API = `http://localhost:${process.env.PORT || 3001}/api/v1`;
const TEAM_ID = 'seed-team-1';
const BUCKET = process.env.SUPABASE_CHAT_BUCKET || 'team-chat';
const prisma = new PrismaClient();

// Header-only 10×20 PNG — enough for image-size to read dimensions.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000a0000001408060000008d32cfbd',
  'hex',
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf8');

function fileForm(body: string | undefined, files: { name: string; type: string; bytes: Buffer }[]) {
  const fd = new FormData();
  if (body) fd.append('body', body);
  for (const f of files) fd.append('files', new Blob([new Uint8Array(f.bytes)], { type: f.type }), f.name);
  return fd;
}

async function main() {
  const health = await fetch(`http://localhost:${process.env.PORT || 3001}/health`).catch(() => null);
  assert.ok(health?.ok, 'Dev server is not running — start it first (npm run dev).');

  // ── Throwaway member ───────────────────────────────────────────────────────
  const email = 'chat-upload-verify@volleyvision.test';
  let auth = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'upload-verify-1', firstName: 'Upload', lastName: 'Verify' }),
  });
  if (auth.status === 409) {
    auth = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'upload-verify-1' }),
    });
  }
  const { token, user } = (await auth.json()) as any;
  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: user.id, teamId: TEAM_ID } },
    update: { role: TeamRole.PLAYER },
    create: { userId: user.id, teamId: TEAM_ID, role: TeamRole.PLAYER },
  });
  const headers = { Authorization: `Bearer ${token}` };

  const channelRes = await fetch(`${API}/teams/${TEAM_ID}/channel`, { headers });
  const channelId = ((await channelRes.json()) as any).id as string;

  try {
    // ── Happy path: image + PDF in one message ───────────────────────────────
    const up = await fetch(`${API}/channels/${channelId}/messages/upload`, {
      method: 'POST',
      headers,
      body: fileForm('Scouting notes attached', [
        { name: 'lineup photo.png', type: 'image/png', bytes: PNG_BYTES },
        { name: 'scouting-report.pdf', type: 'application/pdf', bytes: PDF_BYTES },
      ]),
    });
    const upBody = await up.text();
    assert.equal(up.status, 201, `upload failed: ${up.status} ${upBody}`);
    const msg = JSON.parse(upBody) as any;
    assert.equal(msg.body, 'Scouting notes attached');
    assert.equal(msg.attachments.length, 2, 'two attachments expected');

    const img = msg.attachments.find((a: any) => a.kind === 'IMAGE');
    const pdf = msg.attachments.find((a: any) => a.kind === 'FILE');
    assert.ok(img && pdf, 'one IMAGE and one FILE expected');
    assert.equal(img.width, 10, 'image width recorded');
    assert.equal(img.height, 20, 'image height recorded');
    assert.equal(pdf.fileName, 'scouting-report.pdf');
    assert.ok(!('storagePath' in img) && !('storagePath' in pdf), 'storagePath must not be exposed');

    for (const [att, bytes] of [[img, PNG_BYTES], [pdf, PDF_BYTES]] as const) {
      assert.ok(att.signedUrl?.startsWith('https://'), 'signed URL present');
      const dl = await fetch(att.signedUrl);
      assert.equal(dl.status, 200, `signed URL fetch ${dl.status}`);
      assert.ok(Buffer.from(await dl.arrayBuffer()).equals(bytes), `${att.fileName} bytes round-trip`);
    }
    console.log('✓ image + PDF upload, dimensions, signed URLs, byte round-trip');

    // ── Attachments appear on the list endpoint with fresh URLs ─────────────
    const list = await fetch(`${API}/channels/${channelId}/messages?limit=5`, { headers });
    const listed = ((await list.json()) as any[]).find((m) => m.id === msg.id);
    assert.ok(listed, 'uploaded message listed');
    assert.equal(listed.attachments.length, 2);
    assert.ok(listed.attachments.every((a: any) => a.signedUrl?.startsWith('https://')));
    console.log('✓ list endpoint re-signs attachment URLs');

    // ── Rejections ───────────────────────────────────────────────────────────
    const exe = await fetch(`${API}/channels/${channelId}/messages/upload`, {
      method: 'POST',
      headers,
      body: fileForm(undefined, [{ name: 'virus.exe', type: 'application/x-msdownload', bytes: PDF_BYTES }]),
    });
    assert.equal(exe.status, 400, 'executable should be rejected');

    const big = await fetch(`${API}/channels/${channelId}/messages/upload`, {
      method: 'POST',
      headers,
      body: fileForm(undefined, [{ name: 'huge.png', type: 'image/png', bytes: Buffer.alloc(11 * 1024 * 1024, 1) }]),
    });
    assert.equal(big.status, 400, 'oversized image should be rejected');

    const empty = await fetch(`${API}/channels/${channelId}/messages/upload`, {
      method: 'POST',
      headers,
      body: fileForm(undefined, []),
    });
    assert.equal(empty.status, 400, 'empty message should be rejected');
    console.log('✓ rejects executable, oversized image, and empty message');

    // ── Forced DB failure → compensating cleanup, no orphans ────────────────
    const channelPrefix = `teams/${TEAM_ID}/channels/${channelId}`;
    const listFolders = async () => {
      const { data, error } = await getSupabaseClient().storage.from(BUCKET).list(channelPrefix, { limit: 1000 });
      assert.ok(!error, `bucket list failed: ${error?.message}`);
      return new Set((data ?? []).map((e) => e.name));
    };
    const before = await listFolders();

    const realCreate = serviceprisma.message.create;
    (serviceprisma.message as any).create = () => {
      throw new Error('forced DB failure (verification)');
    };
    let threw = false;
    try {
      await postMessageWithAttachments(channelId, user.id, undefined, [
        { originalname: 'orphan.png', mimetype: 'image/png', size: PNG_BYTES.length, buffer: PNG_BYTES } as any,
      ]);
    } catch {
      threw = true;
    } finally {
      (serviceprisma.message as any).create = realCreate;
    }
    assert.ok(threw, 'forced failure should propagate');

    const after = await listFolders();
    assert.deepEqual([...after].sort(), [...before].sort(), 'no orphaned objects after forced DB failure');
    console.log('✓ forced DB failure leaves no orphaned objects in the bucket');

    console.log('\n✅ Slice 4 upload verification passed.');
  } finally {
    // ── Cleanup: storage objects, then rows, then the user ──────────────────
    const atts = await prisma.messageAttachment.findMany({
      where: { uploadedByUserId: user.id },
      select: { storagePath: true },
    });
    if (atts.length) await getSupabaseClient().storage.from(BUCKET).remove(atts.map((a) => a.storagePath));
    await prisma.message.deleteMany({ where: { senderId: user.id } });
    await prisma.teamMembership.deleteMany({ where: { userId: user.id, teamId: TEAM_ID } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log('🧹 Cleaned up verification user, messages, and storage objects.');
  }
}

main()
  .catch((err) => {
    console.error('\nFAIL —', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await serviceprisma.$disconnect();
  });
