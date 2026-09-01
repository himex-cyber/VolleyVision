import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TUS_CHUNK_SIZE_BYTES,
  decodeTusMetadata,
  encodeTusMetadata,
  isVideoStorageKey,
  resolveTusTargetUrl,
  rewriteTusLocation,
  storageKeyFromTusRequest,
  storageKeyFromTusUploadId,
} from './tusUpload';

const KEY = 'matches/cm4abc123/0f8fad5b-d9cb-469f-a165-70867728950e.mp4';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

// ─── Chunk size ───────────────────────────────────────────────────────────────

describe('TUS_CHUNK_SIZE_BYTES', () => {
  it('is exactly 6 MiB — a Supabase requirement, not a tuning knob', () => {
    assert.equal(TUS_CHUNK_SIZE_BYTES, 6 * 1024 * 1024);
    assert.equal(TUS_CHUNK_SIZE_BYTES, 6291456);
  });
});

// ─── Metadata encoding ────────────────────────────────────────────────────────

describe('encodeTusMetadata / decodeTusMetadata', () => {
  it('round-trips the metadata the Supabase adapter sends', () => {
    const meta = {
      bucketName: 'match-videos',
      objectName: KEY,
      contentType: 'video/mp4',
      cacheControl: '3600',
    };
    assert.deepEqual(decodeTusMetadata(encodeTusMetadata(meta)), meta);
  });

  it('encodes as `key <base64>` pairs joined by commas', () => {
    assert.equal(encodeTusMetadata({ a: 'x', b: 'y' }), `a ${b64('x')},b ${b64('y')}`);
  });

  it('round-trips values containing commas and spaces', () => {
    const meta = { note: 'set 1, set 2' };
    assert.deepEqual(decodeTusMetadata(encodeTusMetadata(meta)), meta);
  });

  it('returns an empty object for empty, blank, or missing input', () => {
    assert.deepEqual(decodeTusMetadata(''), {});
    assert.deepEqual(decodeTusMetadata('   '), {});
    assert.deepEqual(decodeTusMetadata(undefined as unknown as string), {});
  });

  it('accepts a valueless key, which the spec allows', () => {
    assert.deepEqual(decodeTusMetadata('isFinal'), { isFinal: '' });
  });

  it('tolerates stray commas and extra whitespace rather than throwing', () => {
    assert.deepEqual(decodeTusMetadata(`,, objectName ${b64(KEY)} ,,`), { objectName: KEY });
  });
});

// ─── Storage-key shape ────────────────────────────────────────────────────────

describe('isVideoStorageKey', () => {
  it('accepts each extension buildStorageKey can produce', () => {
    assert.equal(isVideoStorageKey(KEY), true);
    assert.equal(isVideoStorageKey(KEY.replace('.mp4', '.mov')), true);
    assert.equal(isVideoStorageKey(KEY.replace('.mp4', '.webm')), true);
  });

  it('rejects traversal, other prefixes, and other extensions', () => {
    assert.equal(isVideoStorageKey('../../etc/passwd'), false);
    assert.equal(isVideoStorageKey('matches/m1/../../secrets.mp4'), false);
    assert.equal(isVideoStorageKey('teams/t1/channels/c1/m1/uuid-photo.png'), false);
    assert.equal(isVideoStorageKey(KEY.replace('.mp4', '.exe')), false);
    assert.equal(isVideoStorageKey(''), false);
  });

  it('is anchored — a key embedded in a longer string is not a key', () => {
    assert.equal(isVideoStorageKey(`prefix/${KEY}`), false);
    assert.equal(isVideoStorageKey(`${KEY}/extra`), false);
  });
});

// ─── Upload id → storage key ──────────────────────────────────────────────────

describe('storageKeyFromTusUploadId', () => {
  it('extracts the key from a base64 id of `bucket/object/version`', () => {
    const id = Buffer.from(`match-videos/${KEY}/1`, 'utf8').toString('base64');
    assert.equal(storageKeyFromTusUploadId(id), KEY);
  });

  it('handles base64url without padding', () => {
    const id = Buffer.from(`match-videos/${KEY}/1`, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.equal(storageKeyFromTusUploadId(id), KEY);
  });

  it('extracts from a plain unencoded id too', () => {
    assert.equal(storageKeyFromTusUploadId(`match-videos/${KEY}/1`), KEY);
  });

  it('returns null when there is no key to find — the caller must refuse, not allow', () => {
    assert.equal(storageKeyFromTusUploadId(''), null);
    assert.equal(storageKeyFromTusUploadId('deadbeef'), null);
    assert.equal(storageKeyFromTusUploadId(Buffer.from('team-chat/teams/t1/x.png').toString('base64')), null);
  });
});

// ─── Request → storage key ────────────────────────────────────────────────────

describe('storageKeyFromTusRequest', () => {
  it('prefers Upload-Metadata on the creation request', () => {
    const header = encodeTusMetadata({ bucketName: 'match-videos', objectName: KEY });
    assert.equal(storageKeyFromTusRequest({ metadataHeader: header }), KEY);
  });

  it('falls back to the upload id once metadata is no longer sent', () => {
    const id = Buffer.from(`match-videos/${KEY}/1`).toString('base64');
    assert.equal(storageKeyFromTusRequest({ uploadId: id }), KEY);
  });

  it('rejects a metadata objectName that is not one of our keys', () => {
    // A client controls this header; a key-shaped check is what stops it
    // naming an object in someone else's namespace.
    const header = encodeTusMetadata({ objectName: 'teams/t1/channels/c1/secret.png' });
    assert.equal(storageKeyFromTusRequest({ metadataHeader: header }), null);
  });

  it('rejects a traversal attempt in metadata', () => {
    const header = encodeTusMetadata({ objectName: '../../../etc/passwd' });
    assert.equal(storageKeyFromTusRequest({ metadataHeader: header }), null);
  });

  it('returns null when neither source identifies an object', () => {
    assert.equal(storageKeyFromTusRequest({}), null);
    assert.equal(storageKeyFromTusRequest({ metadataHeader: null, uploadId: null }), null);
    assert.equal(storageKeyFromTusRequest({ metadataHeader: 'garbage' }), null);
  });

  it('ignores Upload-Metadata once an upload id is present', () => {
    // The bypass this precedence exists to close: the proxy routes by the id, so
    // authorizing off a metadata key the caller legitimately owns would approve a
    // request aimed somewhere else entirely.
    const header = encodeTusMetadata({ objectName: KEY });
    assert.equal(
      storageKeyFromTusRequest({ metadataHeader: header, uploadId: '../../../rest/v1/users' }),
      null,
    );
  });

  it('rejects an unrecognisable upload id even alongside valid metadata', () => {
    const header = encodeTusMetadata({ objectName: KEY });
    assert.equal(storageKeyFromTusRequest({ metadataHeader: header, uploadId: 'deadbeef' }), null);
  });
});

// ─── Upstream target resolution ───────────────────────────────────────────────

describe('resolveTusTargetUrl', () => {
  const SUPABASE = 'https://abc.supabase.co';
  const PREFIX = '/storage/v1/upload/resumable';

  it('hangs a plain id under the resumable prefix', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, 'SGVsbG8x')?.href, `${SUPABASE}${PREFIX}/SGVsbG8x`);
  });

  it('allows an id that legitimately contains slashes', () => {
    const id = `match-videos/${KEY}/1`;
    assert.equal(resolveTusTargetUrl(SUPABASE, id)?.href, `${SUPABASE}${PREFIX}/${id}`);
  });

  it('targets the collection itself when there is no id', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, '')?.href, `${SUPABASE}${PREFIX}`);
  });

  it('tolerates a trailing slash on the configured Supabase URL', () => {
    assert.equal(resolveTusTargetUrl(`${SUPABASE}/`, 'abc')?.href, `${SUPABASE}${PREFIX}/abc`);
  });

  // Express percent-decodes the wildcard before we see it, so `..%2F..%2F`
  // arrives here as real dot segments. Each of these would otherwise be sent
  // upstream carrying the service-role key.
  it('refuses dot-segment traversal out of the prefix', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, '../../../rest/v1/users'), null);
    assert.equal(resolveTusTargetUrl(SUPABASE, '../../../../auth/v1/admin/users'), null);
    assert.equal(resolveTusTargetUrl(SUPABASE, '..%2F..%2F..%2Frest%2Fv1%2Fusers'.replace(/%2F/g, '/')), null);
  });

  it('refuses traversal that lands back on a sibling storage path', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, '../../object/team-chat/secret.png'), null);
  });

  it('refuses an absolute or protocol-relative id', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, 'https://evil.com/x'), null);
    assert.equal(resolveTusTargetUrl(SUPABASE, '//evil.com/x'), null);
  });

  it('refuses a root-relative id', () => {
    assert.equal(resolveTusTargetUrl(SUPABASE, '/rest/v1/users'), null);
  });

  it('returns null for an unusable Supabase URL rather than guessing', () => {
    assert.equal(resolveTusTargetUrl('not a url', 'abc'), null);
  });
});

// ─── Location rewriting ───────────────────────────────────────────────────────

describe('rewriteTusLocation', () => {
  const PROXY = '/api/v1/videos/upload-tus';

  it('re-hangs an absolute vendor Location under the proxy base', () => {
    const upstream = 'https://abc.supabase.co/storage/v1/upload/resumable/SGVsbG8x';
    assert.equal(rewriteTusLocation(upstream, PROXY), `${PROXY}/SGVsbG8x`);
  });

  it('never leaks the vendor origin into the rewritten value', () => {
    const upstream = 'https://abc.supabase.co/storage/v1/upload/resumable/SGVsbG8x';
    assert.ok(!rewriteTusLocation(upstream, PROXY)!.includes('supabase.co'));
  });

  it('tolerates a trailing slash on the proxy base', () => {
    const upstream = 'https://abc.supabase.co/storage/v1/upload/resumable/abc';
    assert.equal(rewriteTusLocation(upstream, `${PROXY}/`), `${PROXY}/abc`);
  });

  it('preserves a query string on the id', () => {
    const upstream = 'https://abc.supabase.co/storage/v1/upload/resumable/abc?token=x';
    assert.equal(rewriteTusLocation(upstream, PROXY), `${PROXY}/abc?token=x`);
  });

  it('falls back to the trailing segment for an unfamiliar shape', () => {
    assert.equal(rewriteTusLocation('https://host/some/other/path/xyz', PROXY), `${PROXY}/xyz`);
  });

  it('returns null when there is no id to lift', () => {
    assert.equal(rewriteTusLocation('', PROXY), null);
    assert.equal(rewriteTusLocation('https://host/', PROXY), null);
  });
});
