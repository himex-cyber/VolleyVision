/**
 * Preflight the video storage configuration against the live bucket.
 *
 *   npm run check:video
 *   npx ts-node scripts/check-video-config.ts
 *
 * The app's upload ceiling (VIDEO_MAX_SIZE_BYTES) and the storage bucket's own
 * file-size limit are two independent settings, and only the bucket's is
 * enforced while bytes are moving. When the app allows more than the bucket
 * accepts, nothing complains until a user has already spent minutes uploading
 * and the transfer dies at the end. This script makes that mismatch — and a
 * handful of its cousins — a build-time failure instead.
 *
 * Checks, in order:
 *   1. A provider is configured (not `none`).
 *   2. The bucket exists.
 *   3. The bucket is PRIVATE. Playback is signed-URL based; a public bucket
 *      means every match recording is world-readable to anyone with the URL.
 *   4. The bucket's file-size limit is >= VIDEO_MAX_SIZE_BYTES.
 *   5. The bucket's allowed MIME types cover ALLOWED_VIDEO_MIME.
 *   6. A real round-trip: upload a few bytes, head() them, sign them, delete them.
 *
 * Exits non-zero on any FAIL so CI and deploy scripts can gate on it. Prints no
 * secrets and no full signed URLs.
 *
 * Safe to re-run; the round-trip cleans up after itself.
 */
import { getSupabaseClient } from '../src/lib/supabase';
import { ALLOWED_VIDEO_MIME, formatMb } from '../src/lib/videoValidation';
import { getVideoStorageProvider, videoStorageConfig } from '../src/services/videoStorage';

let failures = 0;
let warnings = 0;

function pass(label: string, detail = '') {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label: string, detail = '') {
  warnings++;
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label: string, detail = '') {
  failures++;
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('\n── VolleyVision video storage preflight ──\n');

  // ─── 1. Provider ────────────────────────────────────────────────────────────
  const providerName = (process.env.VIDEO_STORAGE_PROVIDER || 'none').trim().toLowerCase();
  const cfg = videoStorageConfig();

  console.log('Configuration');
  if (providerName === 'none') {
    fail('VIDEO_STORAGE_PROVIDER is "none"', 'video endpoints return 503; set it to `supabase` to use storage');
    return;
  }
  pass('VIDEO_STORAGE_PROVIDER', providerName);
  pass('VIDEO_MAX_SIZE_BYTES', `${formatMb(cfg.maxSizeBytes)} (${cfg.maxSizeBytes} bytes)`);
  pass('Upload URL TTL', `${cfg.uploadUrlTtlSeconds}s`);
  pass('Playback URL TTL', `${cfg.playbackUrlTtlSeconds}s`);

  if (process.env.NETLIFY) {
    warn(
      'Running on a Netlify runtime',
      'Supabase resumable uploads use 6 MB chunks proxied through this API; Netlify caps payloads at ~6 MB, so uploads will fail here',
    );
  }

  const provider = getVideoStorageProvider();
  if (provider.name !== providerName) {
    fail('Provider resolution', `"${providerName}" has no adapter and fell back to "${provider.name}"`);
    return;
  }

  // ─── 2–5. Bucket settings ───────────────────────────────────────────────────
  const bucketName = process.env.VIDEO_STORAGE_BUCKET || 'match-videos';
  console.log(`\nBucket "${bucketName}"`);

  const { data: bucket, error: bucketError } = await getSupabaseClient().storage.getBucket(bucketName);
  if (bucketError || !bucket) {
    fail('Bucket exists', bucketError?.message ?? 'not found');
    console.log('\n  Create it in the Supabase dashboard: Storage → New bucket, private, then re-run.');
    return;
  }
  pass('Bucket exists');

  if (bucket.public) {
    fail(
      'Bucket is PRIVATE',
      'this bucket is PUBLIC — every match recording is readable by anyone with the URL. Playback uses signed URLs and does not need public access. Set it to private',
    );
  } else {
    pass('Bucket is private');
  }

  const bucketLimit = bucket.file_size_limit;
  if (bucketLimit == null) {
    warn('Bucket file-size limit', 'not set; the project-level cap applies (50 MB on Supabase Free)');
  } else if (bucketLimit < cfg.maxSizeBytes) {
    fail(
      'Bucket file-size limit >= VIDEO_MAX_SIZE_BYTES',
      `bucket accepts ${formatMb(bucketLimit)} but the app allows ${formatMb(cfg.maxSizeBytes)}. ` +
        'Uploads between those two sizes are accepted by the API and then rejected mid-transfer',
    );
  } else {
    pass('Bucket file-size limit', `${formatMb(bucketLimit)} >= app limit ${formatMb(cfg.maxSizeBytes)}`);
  }

  const allowed = bucket.allowed_mime_types;
  if (!allowed || allowed.length === 0) {
    warn('Allowed MIME types', 'bucket accepts any type; the API allow-list is the only filter');
  } else {
    const missing = [...ALLOWED_VIDEO_MIME].filter((m) => !allowed.includes(m));
    if (missing.length > 0) {
      fail('Allowed MIME types cover the API allow-list', `bucket is missing: ${missing.join(', ')}`);
    } else {
      pass('Allowed MIME types', allowed.join(', '));
    }
  }

  // ─── 6. Round-trip ──────────────────────────────────────────────────────────
  // Exercises the same four operations the app uses, in the same order, so a
  // permissions or key problem surfaces here rather than mid-match.
  console.log('\nRound-trip');
  const probeKey = `__preflight/${Date.now()}.txt`;
  let uploaded = false;

  try {
    const { error } = await getSupabaseClient()
      .storage.from(bucketName)
      .upload(probeKey, Buffer.from('volleyvision preflight'), { contentType: 'text/plain', upsert: false });
    if (error) throw new Error(error.message);
    uploaded = true;
    pass('Upload');
  } catch (err) {
    fail('Upload', err instanceof Error ? err.message : String(err));
  }

  if (uploaded) {
    try {
      const head = await provider.head(probeKey);
      if (!head.exists) throw new Error('object reported as missing immediately after upload');
      pass('head()', `${head.sizeBytes ?? '?'} bytes, ${head.contentType ?? 'unknown type'}`);
    } catch (err) {
      fail('head()', err instanceof Error ? err.message : String(err));
    }

    try {
      const source = await provider.getPlaybackSource(probeKey);
      // Never print the URL itself — it is a live credential for the object.
      if (!source.url.startsWith('http')) throw new Error('signed URL is not an absolute URL');
      pass('Signed playback URL', `kind=${source.kind}, expires ${source.expiresAt.toISOString()}`);
    } catch (err) {
      fail('Signed playback URL', err instanceof Error ? err.message : String(err));
    }

    try {
      await provider.delete(probeKey);
      pass('Delete');
    } catch (err) {
      fail('Delete', `${err instanceof Error ? err.message : String(err)} — leftover object: ${probeKey}`);
    }
  }
}

main()
  .catch((err) => {
    failures++;
    console.error('\nUnexpected error:', err instanceof Error ? err.message : err);
  })
  .finally(() => {
    console.log(
      `\n${failures === 0 ? '✅ PASS' : '❌ FAIL'} — ${failures} failure(s), ${warnings} warning(s).\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
