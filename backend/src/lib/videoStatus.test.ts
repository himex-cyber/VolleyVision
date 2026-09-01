import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canRefreshUpload,
  canTransition,
  resolveUploadCompletion,
  type HeadResult,
  type VideoStatusName,
} from './videoStatus';

const MAX = 500 * 1024 * 1024;

function head(over: Partial<HeadResult> = {}): HeadResult {
  return { exists: true, sizeBytes: 1024, contentType: 'video/mp4', ...over };
}

const ALL: VideoStatusName[] = ['PENDING', 'READY', 'FAILED'];

// ─── canTransition ────────────────────────────────────────────────────────────

describe('canTransition', () => {
  it('allows PENDING to resolve either way', () => {
    assert.equal(canTransition('PENDING', 'READY'), true);
    assert.equal(canTransition('PENDING', 'FAILED'), true);
  });

  it('treats READY as terminal — nothing leaves it, including itself', () => {
    for (const to of ALL) {
      assert.equal(canTransition('READY', to), false, `READY → ${to} should be rejected`);
    }
  });

  it('treats FAILED as terminal — a retry gets a fresh row, not a revived one', () => {
    for (const to of ALL) {
      assert.equal(canTransition('FAILED', to), false, `FAILED → ${to} should be rejected`);
    }
  });

  it('never allows a move back to PENDING', () => {
    for (const from of ALL) {
      assert.equal(canTransition(from, 'PENDING'), false, `${from} → PENDING should be rejected`);
    }
  });
});

// ─── resolveUploadCompletion ──────────────────────────────────────────────────

describe('resolveUploadCompletion — READY', () => {
  it('promotes a confirmed object within the cap, carrying the provider values', () => {
    const out = resolveUploadCompletion(head({ sizeBytes: 2048, contentType: 'video/webm' }), MAX);
    assert.deepEqual(out, { status: 'READY', sizeBytes: 2048, contentType: 'video/webm' });
  });

  it('accepts a size exactly at the cap', () => {
    assert.equal(resolveUploadCompletion(head({ sizeBytes: MAX }), MAX).status, 'READY');
  });

  it('accepts an existing object whose size the provider could not report', () => {
    const out = resolveUploadCompletion(head({ sizeBytes: null }), MAX);
    assert.deepEqual(out, { status: 'READY', sizeBytes: null, contentType: 'video/mp4' });
  });
});

describe('resolveUploadCompletion — FAILED', () => {
  it('fails a missing object', () => {
    assert.deepEqual(resolveUploadCompletion(head({ exists: false }), MAX), {
      status: 'FAILED',
      reason: 'missing',
    });
  });

  it('fails one byte over the cap — the size declared at intent is not trusted', () => {
    assert.deepEqual(resolveUploadCompletion(head({ sizeBytes: MAX + 1 }), MAX), {
      status: 'FAILED',
      reason: 'oversize',
    });
  });

  it('reports "missing" ahead of "oversize" when the object is absent', () => {
    const out = resolveUploadCompletion({ exists: false, sizeBytes: MAX + 1, contentType: null }, MAX);
    assert.deepEqual(out, { status: 'FAILED', reason: 'missing' });
  });

  it('fails a zero-size object only if the cap is zero, not by default', () => {
    assert.equal(resolveUploadCompletion(head({ sizeBytes: 0 }), MAX).status, 'READY');
  });
});

// ─── canRefreshUpload ─────────────────────────────────────────────────────────

describe('canRefreshUpload', () => {
  it('allows a fresh credential only while the upload is in flight', () => {
    assert.equal(canRefreshUpload('PENDING'), true);
  });

  it('refuses a READY row — re-crediting it would let a new upload overwrite confirmed footage', () => {
    assert.equal(canRefreshUpload('READY'), false);
  });

  it('refuses a FAILED row — terminal, and a retry starts a new intent', () => {
    assert.equal(canRefreshUpload('FAILED'), false);
  });

  it('agrees with the transition table: refreshable exactly when PENDING can still move', () => {
    for (const status of ALL) {
      const stillOpen = canTransition(status, 'READY') || canTransition(status, 'FAILED');
      assert.equal(canRefreshUpload(status), stillOpen, `${status} disagrees`);
    }
  });
});

// ─── The two together ─────────────────────────────────────────────────────────

describe('completion is only ever applied from PENDING', () => {
  it('every outcome resolveUploadCompletion can produce is a legal move from PENDING', () => {
    const outcomes = [
      resolveUploadCompletion(head(), MAX),
      resolveUploadCompletion(head({ exists: false }), MAX),
      resolveUploadCompletion(head({ sizeBytes: MAX + 1 }), MAX),
    ];
    for (const o of outcomes) {
      assert.equal(canTransition('PENDING', o.status), true);
      assert.equal(canTransition('READY', o.status), false);
      assert.equal(canTransition('FAILED', o.status), false);
    }
  });
});
