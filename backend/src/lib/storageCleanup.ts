// Best-effort removal of attachment files from the private bucket, after the
// database rows are gone (9.0.8): message delete, team delete, account
// deletion, the scrub script, and the compensating delete after a failed
// upload. Never throws: the user's request has already succeeded, and an
// orphaned file costs storage while a thrown error costs the real response.
// Failures go to Sentry with a count only (paths hold file names).

import * as Sentry from '@sentry/node';

type RemoveResult = { error: { message: string } | null };
type Remover = (paths: string[]) => Promise<RemoveResult>;

const CHUNK = 100;

// Imported lazily: lib/supabase runs dotenv at load, which would pull
// backend/.env into any test or script that merely imports this file.
const removeFromBucket: Remover = async (paths) => {
  const { getSupabaseClient } = await import('./supabase');
  return getSupabaseClient().storage.from(process.env.SUPABASE_CHAT_BUCKET || 'team-chat').remove(paths);
};

/** Removes the files; returns how many could not be removed. */
export async function removeStoredFiles(paths: string[], remove: Remover = removeFromBucket): Promise<number> {
  let failed = 0;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    try {
      const { error } = await remove(chunk);
      if (error) throw new Error(`Storage remove failed: ${error.message}`);
    } catch (err) {
      failed += chunk.length;
      console.error(`Could not remove ${chunk.length} stored file(s):`, err instanceof Error ? err.message : err);
      Sentry.captureException(err, { extra: { files: chunk.length } });
    }
  }
  return failed;
}
