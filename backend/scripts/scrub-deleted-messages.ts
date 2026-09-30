/**
 * Erases what deleted chat messages still hold (9.0.8). Before v9.16.0 a
 * deleted message was only hidden: its text, attachment rows and files stayed.
 * Deleting now erases them; this does the same for the old ones.
 *
 *   Local:      DATABASE_URL=postgresql://…@localhost… npx ts-node scripts/scrub-deleted-messages.ts [--apply]
 *   Production: npx ts-node scripts/scrub-deleted-messages.ts --prod [--apply]   (backend/.env; take a backup first)
 *
 * A dry run by default: counts only. --apply removes each batch's files, then
 * blanks the text and deletes the attachment rows. A batch whose files can't
 * all be removed keeps its rows, so running it again retries them. Local runs
 * skip storage (there's no bucket locally). Prints the database's project ref,
 * never its URL, and never message text or file names.
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

    if (!target.prod) console.log('Local run: storage skipped.');
    let erased = 0;
    let kept = 0;
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const paths = batch.flatMap((m) => m.attachments.map((a) => a.storagePath));
      // Files first: once the rows are gone, nothing records where they are.
      if (target.prod && paths.length && (await removeStoredFiles(paths)) > 0) {
        kept += batch.length;
        continue;
      }
      const ids = batch.map((m) => m.id);
      await prisma.$transaction([
        prisma.messageAttachment.deleteMany({ where: { messageId: { in: ids } } }),
        prisma.message.updateMany({ where: { id: { in: ids } }, data: { body: null } }),
      ]);
      erased += batch.length;
    }
    console.log(`Erased ${erased} message(s).`);
    if (kept) console.log(`${kept} message(s) kept: their files couldn't be removed (see the errors above). Run it again to retry.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
