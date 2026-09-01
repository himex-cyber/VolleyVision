/**
 * Delete stale PENDING videos and their storage objects.
 *
 *   npx ts-node scripts/cleanup-pending-videos.ts --dry-run   (report only)
 *   npx ts-node scripts/cleanup-pending-videos.ts             (delete)
 *   npx ts-node scripts/cleanup-pending-videos.ts --hours=48  (custom age)
 *
 * A PENDING row is the residue of an upload that was started but never
 * confirmed: the API issued a presigned URL and created the row, then the
 * browser closed the tab, lost its connection, or the URL expired before the
 * bytes finished. Nothing else cleans these up — the API never sees the bytes,
 * so it cannot notice the upload stopped.
 *
 * 24 hours is the default cut-off: comfortably longer than any presigned URL
 * lives (and than any plausible upload takes on a slow connection), so an
 * in-flight upload is never killed mid-transfer.
 *
 * Storage is deleted before the row, matching deleteVideo — if the object
 * delete fails the row is kept, so the bytes stay tracked rather than becoming
 * an untraceable orphan. A row whose object was never created (the client got
 * a URL and uploaded nothing) tolerates a delete that finds nothing.
 *
 * NOT wired to a scheduler. Run it by hand, or attach it to a scheduled
 * function when the video feature is switched on.
 *
 * Idempotent — safe to re-run; a second run finds nothing to do.
 */
import { VideoStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { getVideoStorageProvider } from '../src/services/videoStorage';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const hoursArg = process.argv.find((a) => a.startsWith('--hours='));
  const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;

  if (!Number.isFinite(hours) || hours <= 0) {
    console.error(`Invalid --hours value: ${hoursArg}. Expected a positive number.`);
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stale = await prisma.video.findMany({
    where: { status: VideoStatus.PENDING, uploadedAt: { lt: cutoff } },
    select: { id: true, matchId: true, filename: true, storageKey: true, storageProvider: true, uploadedAt: true },
    orderBy: { uploadedAt: 'asc' },
  });

  if (stale.length === 0) {
    console.log(`✅ No PENDING videos older than ${hours}h. Nothing to do.`);
    return;
  }

  console.log(`Found ${stale.length} PENDING video(s) older than ${hours}h (before ${cutoff.toISOString()}):\n`);
  for (const v of stale) {
    console.log(`  ${v.id}  ${v.uploadedAt.toISOString()}  match=${v.matchId}  ${v.filename}`);
  }

  if (dryRun) {
    console.log('\n--dry-run — nothing deleted.');
    return;
  }

  const provider = getVideoStorageProvider();
  let deleted = 0;
  let kept = 0;

  for (const v of stale) {
    try {
      if (v.storageKey) {
        if (v.storageProvider && v.storageProvider !== provider.name) {
          console.warn(`  ⚠ ${v.id}: stored on "${v.storageProvider}", configured provider is "${provider.name}" — skipped.`);
          kept++;
          continue;
        }
        await provider.delete(v.storageKey);
      }
      await prisma.video.delete({ where: { id: v.id } });
      deleted++;
    } catch (err) {
      // Keep the row: it is the only remaining pointer to the object.
      console.error(`  ⚠ ${v.id}: storage delete failed, row kept —`, err instanceof Error ? err.message : err);
      kept++;
    }
  }

  console.log(`\n✅ Deleted ${deleted} video(s).${kept > 0 ? ` Kept ${kept} for a later run.` : ''}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
