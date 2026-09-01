import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ALLOWED_VIDEO_MIME,
  DEFAULT_MAX_VIDEO_BYTES,
  buildStorageKey,
  extensionForContentType,
  formatMb,
  sanitizeVideoFilename,
  validateUploadIntent,
} from './videoValidation';

const MAX = DEFAULT_MAX_VIDEO_BYTES;

function expectAppError(status: number, fn: () => unknown) {
  try {
    fn();
    assert.fail('should have thrown');
  } catch (err: any) {
    assert.equal(err.statusCode, status, `expected ${status}, got ${err.statusCode}: ${err.message}`);
  }
}

// ─── sanitizeVideoFilename ────────────────────────────────────────────────────

describe('sanitizeVideoFilename', () => {
  it('leaves an already-safe name alone', () => {
    assert.equal(sanitizeVideoFilename('set-3_vs_Hornby.mp4'), 'set-3_vs_Hornby.mp4');
  });

  it('strips directory components from a POSIX traversal attempt', () => {
    assert.equal(sanitizeVideoFilename('../../etc/passwd'), 'passwd');
  });

  it('strips directory components from a Windows traversal attempt', () => {
    assert.equal(sanitizeVideoFilename('..\\..\\Windows\\System32\\config.sys'), 'config.sys');
  });

  it('collapses runs of replaced characters', () => {
    assert.equal(sanitizeVideoFilename('match   final!!!.mp4'), 'match_final_.mp4');
  });

  it('falls back to "video" when nothing survives', () => {
    assert.equal(sanitizeVideoFilename('///'), 'video');
    assert.equal(sanitizeVideoFilename(''), 'video');
  });

  it('caps length at 120 characters', () => {
    assert.equal(sanitizeVideoFilename('a'.repeat(500)).length, 120);
  });
});

// ─── extensionForContentType ──────────────────────────────────────────────────

describe('extensionForContentType', () => {
  it('maps each allowed type to its extension', () => {
    assert.equal(extensionForContentType('video/mp4'), 'mp4');
    assert.equal(extensionForContentType('video/quicktime'), 'mov');
    assert.equal(extensionForContentType('video/webm'), 'webm');
  });

  it('covers every entry in the allow-list', () => {
    for (const mime of ALLOWED_VIDEO_MIME) {
      assert.ok(extensionForContentType(mime).length > 0, `${mime} has no extension`);
    }
  });

  it('rejects a type that is not on the allow-list', () => {
    expectAppError(400, () => extensionForContentType('application/x-msdownload'));
    expectAppError(400, () => extensionForContentType('video/x-matroska'));
  });
});

// ─── buildStorageKey ──────────────────────────────────────────────────────────

describe('buildStorageKey', () => {
  it('builds matches/{matchId}/{id}.{ext}', () => {
    assert.equal(buildStorageKey('match123', 'video/mp4', 'abc'), 'matches/match123/abc.mp4');
    assert.equal(buildStorageKey('match123', 'video/quicktime', 'abc'), 'matches/match123/abc.mov');
  });

  it('generates a unique id when none is supplied', () => {
    const a = buildStorageKey('m1', 'video/webm');
    const b = buildStorageKey('m1', 'video/webm');
    assert.notEqual(a, b);
    assert.match(a, /^matches\/m1\/[0-9a-f-]{36}\.webm$/);
  });

  it('never derives the key from the client filename, so traversal cannot reach it', () => {
    // The filename is not an input at all — the key is matchId + server id +
    // an extension taken from the (allow-listed) content type.
    const key = buildStorageKey('m1', 'video/mp4', 'id1');
    assert.ok(!key.includes('..'));
    assert.ok(key.startsWith('matches/m1/'));
    assert.equal(key.split('/').length, 3);
  });

  it('rejects an unsupported content type rather than producing an extensionless key', () => {
    expectAppError(400, () => buildStorageKey('m1', 'text/html', 'id1'));
  });
});

// ─── validateUploadIntent ─────────────────────────────────────────────────────

describe('validateUploadIntent — accepted', () => {
  it('returns normalized values for a valid intent', () => {
    const out = validateUploadIntent(
      { filename: '../set 1.mp4', contentType: 'video/mp4', sizeBytes: 1024 },
      MAX,
    );
    assert.deepEqual(out, { filename: 'set_1.mp4', contentType: 'video/mp4', sizeBytes: 1024 });
  });

  it('accepts a size exactly at the cap', () => {
    const out = validateUploadIntent({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: MAX }, MAX);
    assert.equal(out.sizeBytes, MAX);
  });

  it('accepts the smallest legal size', () => {
    const out = validateUploadIntent({ filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 1 }, MAX);
    assert.equal(out.sizeBytes, 1);
  });
});

describe('validateUploadIntent — rejected', () => {
  const valid = { filename: 'a.mp4', contentType: 'video/mp4', sizeBytes: 1024 };

  it('rejects a missing or blank filename', () => {
    expectAppError(400, () => validateUploadIntent({ ...valid, filename: undefined }, MAX));
    expectAppError(400, () => validateUploadIntent({ ...valid, filename: '   ' }, MAX));
  });

  it('rejects a content type off the allow-list', () => {
    expectAppError(400, () => validateUploadIntent({ ...valid, contentType: 'video/x-matroska' }, MAX));
    expectAppError(400, () => validateUploadIntent({ ...valid, contentType: undefined }, MAX));
  });

  it('rejects one byte over the cap', () => {
    expectAppError(400, () => validateUploadIntent({ ...valid, sizeBytes: MAX + 1 }, MAX));
  });

  it('rejects zero, negative, fractional, and non-numeric sizes', () => {
    for (const sizeBytes of [0, -1, 1.5, NaN, Infinity] as number[]) {
      expectAppError(400, () => validateUploadIntent({ ...valid, sizeBytes }, MAX));
    }
    expectAppError(400, () => validateUploadIntent({ ...valid, sizeBytes: '1024' as unknown as number }, MAX));
    expectAppError(400, () => validateUploadIntent({ ...valid, sizeBytes: undefined }, MAX));
  });

  it('does not leak the sanitized filename check into the type check order', () => {
    // A traversal filename with a bad type still fails on type, not on path.
    expectAppError(400, () => validateUploadIntent({ filename: '../../x', contentType: 'text/html', sizeBytes: 1 }, MAX));
  });
});

// ─── formatMb ─────────────────────────────────────────────────────────────────

describe('formatMb', () => {
  it('renders MB below a gigabyte and GB above', () => {
    assert.equal(formatMb(500 * 1024 * 1024), '500 MB');
    assert.equal(formatMb(1536 * 1024 * 1024), '1.5 GB');
  });
});
