import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLIP_POST_ROLL_SECONDS,
  CLIP_PRE_ROLL_SECONDS,
  MAX_CLIP_LENGTH_SECONDS,
  clipRangeForEvent,
  eventToVideoSeconds,
  formatTimecode,
  validateClipRange,
} from './videoClips';

const START = new Date('2026-08-07T10:00:00.000Z');
const at = (seconds: number, ms = 0) => new Date(START.getTime() + seconds * 1000 + ms);

function expectAppError(status: number, fn: () => unknown) {
  try {
    fn();
    assert.fail('should have thrown');
  } catch (err: any) {
    assert.equal(err.statusCode, status, `expected ${status}, got ${err.statusCode}: ${err.message}`);
  }
}

// ─── Roll constants ───────────────────────────────────────────────────────────

describe('roll constants', () => {
  it('has more pre-roll than post-roll — the tap comes after the action', () => {
    assert.ok(
      CLIP_PRE_ROLL_SECONDS > CLIP_POST_ROLL_SECONDS,
      'a statistician records the event after seeing it, so the rally is BEFORE the instant',
    );
  });
});

// ─── eventToVideoSeconds ──────────────────────────────────────────────────────

describe('eventToVideoSeconds', () => {
  it('maps an event to its offset from the recording start', () => {
    assert.equal(eventToVideoSeconds(at(125), START), 125);
  });

  it('is 0 at the anchor itself', () => {
    assert.equal(eventToVideoSeconds(START, START), 0);
  });

  it('floors to whole seconds rather than rounding', () => {
    assert.equal(eventToVideoSeconds(at(10, 999), START), 10);
    assert.equal(eventToVideoSeconds(at(10, 1), START), 10);
  });

  it('goes negative for an event that predates the footage', () => {
    // A match filmed from set 2: set-1 events sit before 0:00.
    assert.equal(eventToVideoSeconds(at(-30), START), -30);
  });

  it('floors toward negative infinity on the negative side too', () => {
    assert.equal(eventToVideoSeconds(new Date(START.getTime() - 500), START), -1);
  });
});

// ─── clipRangeForEvent ────────────────────────────────────────────────────────

describe('clipRangeForEvent — normal cases', () => {
  it('brackets the event with pre- and post-roll', () => {
    assert.deepEqual(clipRangeForEvent(100, 600), {
      startSeconds: 100 - CLIP_PRE_ROLL_SECONDS,
      endSeconds: 100 + CLIP_POST_ROLL_SECONDS,
    });
  });

  it('works when the duration is not yet known', () => {
    assert.deepEqual(clipRangeForEvent(100, null), {
      startSeconds: 100 - CLIP_PRE_ROLL_SECONDS,
      endSeconds: 100 + CLIP_POST_ROLL_SECONDS,
    });
  });
});

describe('clipRangeForEvent — clamping at the start', () => {
  it('clamps the start to 0 for an event early in the video', () => {
    const range = clipRangeForEvent(3, 600);
    assert.deepEqual(range, { startSeconds: 0, endSeconds: 3 + CLIP_POST_ROLL_SECONDS });
  });

  it('keeps an event just before 0:00 whose aftermath is still on camera', () => {
    // -2s + 4s post-roll = the clip still ends inside the footage.
    assert.deepEqual(clipRangeForEvent(-2, 600), { startSeconds: 0, endSeconds: 2 });
  });

  it('skips an event entirely before the footage', () => {
    assert.equal(clipRangeForEvent(-CLIP_POST_ROLL_SECONDS, 600), null);
    assert.equal(clipRangeForEvent(-60, 600), null);
  });
});

describe('clipRangeForEvent — clamping at the end', () => {
  it('clamps the end to the video duration', () => {
    assert.deepEqual(clipRangeForEvent(598, 600), { startSeconds: 588, endSeconds: 600 });
  });

  it('keeps an event exactly at the final second', () => {
    assert.deepEqual(clipRangeForEvent(600, 600), { startSeconds: 590, endSeconds: 600 });
  });

  it('skips an event past the end of the video', () => {
    assert.equal(clipRangeForEvent(601, 600), null);
    assert.equal(clipRangeForEvent(9999, 600), null);
  });

  it('skips rather than emitting an inverted range when clamping collapses it', () => {
    // Duration 0 is degenerate but reachable if a client reports it.
    assert.equal(clipRangeForEvent(0, 0), null);
  });
});

describe('clipRangeForEvent — always produces a valid range when it produces one', () => {
  it('never returns start >= end across a sweep of positions', () => {
    for (let seconds = -20; seconds <= 620; seconds++) {
      const range = clipRangeForEvent(seconds, 600);
      if (range === null) continue;
      assert.ok(range.startSeconds >= 0, `negative start at ${seconds}`);
      assert.ok(range.endSeconds > range.startSeconds, `inverted at ${seconds}`);
      assert.ok(range.endSeconds <= 600, `past duration at ${seconds}`);
    }
  });
});

// ─── validateClipRange ────────────────────────────────────────────────────────

describe('validateClipRange — accepted', () => {
  it('returns the range when it is well formed', () => {
    assert.deepEqual(validateClipRange({ startSeconds: 10, endSeconds: 30 }), {
      startSeconds: 10,
      endSeconds: 30,
    });
  });

  it('accepts a clip starting at 0', () => {
    assert.deepEqual(validateClipRange({ startSeconds: 0, endSeconds: 5 }), { startSeconds: 0, endSeconds: 5 });
  });

  it('accepts a clip ending exactly at the video duration', () => {
    assert.deepEqual(validateClipRange({ startSeconds: 0, endSeconds: 600, durationSeconds: 600 }), {
      startSeconds: 0,
      endSeconds: 600,
    });
  });

  it('accepts a clip exactly at the maximum length', () => {
    assert.equal(validateClipRange({ startSeconds: 0, endSeconds: MAX_CLIP_LENGTH_SECONDS }).endSeconds, MAX_CLIP_LENGTH_SECONDS);
  });
});

describe('validateClipRange — rejected', () => {
  it('rejects a negative start', () => {
    expectAppError(400, () => validateClipRange({ startSeconds: -1, endSeconds: 10 }));
  });

  it('rejects an end at or before the start', () => {
    expectAppError(400, () => validateClipRange({ startSeconds: 10, endSeconds: 10 }));
    expectAppError(400, () => validateClipRange({ startSeconds: 30, endSeconds: 10 }));
  });

  it('rejects one second over the maximum length', () => {
    expectAppError(400, () => validateClipRange({ startSeconds: 0, endSeconds: MAX_CLIP_LENGTH_SECONDS + 1 }));
  });

  it('rejects a clip ending past a known duration', () => {
    expectAppError(400, () => validateClipRange({ startSeconds: 0, endSeconds: 601, durationSeconds: 600 }));
  });

  it('allows an end past a video duration when that duration is unknown', () => {
    // Well inside the max clip length, but past where a 600 s video would end —
    // with duration null there is nothing to clamp against, so it stands.
    assert.deepEqual(validateClipRange({ startSeconds: 700, endSeconds: 800, durationSeconds: null }), {
      startSeconds: 700,
      endSeconds: 800,
    });
  });

  it('rejects fractional, non-finite and non-numeric values', () => {
    expectAppError(400, () => validateClipRange({ startSeconds: 1.5, endSeconds: 10 }));
    expectAppError(400, () => validateClipRange({ startSeconds: 0, endSeconds: NaN }));
    expectAppError(400, () => validateClipRange({ startSeconds: 0, endSeconds: Infinity }));
    expectAppError(400, () => validateClipRange({ startSeconds: '0' as unknown, endSeconds: 10 }));
    expectAppError(400, () => validateClipRange({ startSeconds: undefined, endSeconds: 10 }));
  });
});

// ─── formatTimecode ───────────────────────────────────────────────────────────

describe('formatTimecode', () => {
  it('renders m:ss below an hour and h:mm:ss above', () => {
    assert.equal(formatTimecode(0), '0:00');
    assert.equal(formatTimecode(9), '0:09');
    assert.equal(formatTimecode(75), '1:15');
    assert.equal(formatTimecode(3600), '1:00:00');
    assert.equal(formatTimecode(3725), '1:02:05');
  });

  it('floors fractional seconds and never renders a negative time', () => {
    assert.equal(formatTimecode(75.9), '1:15');
    assert.equal(formatTimecode(-5), '0:00');
  });
});
