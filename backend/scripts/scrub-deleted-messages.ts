/**
 * Erases what deleted chat messages still hold (9.0.8). Before v9.16.0 a
 * deleted message was only hidden: its text, attachment rows and files stayed.
 * Deleting now erases them; this does the same for the old ones.
 *
 *   Local:      DATABASE_URL=postgresql://…@localhost… npx ts-node scripts/scrub-deleted-messages.ts [--apply]
 *   Production: npx ts-node scripts/scrub-deleted-messages.ts --prod [--apply]   (backend/.env; take a backup first)
 *
 * A dry run by default: counts only. --apply blanks the text, deletes the
 * attachment rows, then removes the files (best effort). Prints the database's
 * project ref, never its URL, and never message text or file names.
 */
import path from 'node:path';
import { adminScriptTarget, projectRef } from '../src/lib/adminScript';

const BATCH = 100;

async function main() {
  // Before anything loads Prisma or dotenv (see lib/adminScript.ts).
  const target = adminScriptTarget(process.argv.slice(2), process.env);
  if ('error' in target) {
    console.error(target.error);
    process.exit(1);
  }
  Object.assign(process.env, target.env);
  if (target.prod) (await import('dotenv')).config({ path: path.join(__dirname, '..', '.env') });

  const { prisma } = await import('../src/lib/prisma');
  const { removeStoredFiles } = await import('../src/lib/storageCleanup');
  console.log(`Database: ${projectRef(process.env.DATABASE_URL)}${target.prod ? ' (production, from backend/.env)' : ''}`);

  try {
    const messages = await prisma.message.findMany({
      where: { deletedAt: { not: null }, OR: [{ body: { not: null } }, { attachments: { some: {} } }] },
      select: { id: true, attachments: { select: { storagePath: true } } },
    });
    const files = messages.reduce((n, m) => n + m.attachments.length, 0);
    console.log(`${messages.length} deleted message(s) still hold text or files; ${files} attachment file(s).`);

    if (!target.apply) {
      console.log('Dry run: nothing changed. Run again with --apply to erase them.');
      return;
    }

    let missed = 0;
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const ids = batch.map((m) => m.id);
      await prisma.$transaction([
        prisma.messageAttachment.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.message.updateMany({ where: { id: { in: ids } }, data: { body: null } }),
      ]);
      missed += await removeStoredFiles(batch.flatMap((m) => m.attachments.map((a) => a.storagePath)));
    }
    console.log(`Erased ${messages.length} message(s) and ${files} attachment row(s).`);
    if (missed) console.log(`${missed} file(s) could not be removed from storage (see the errors above); their rows are gone.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
