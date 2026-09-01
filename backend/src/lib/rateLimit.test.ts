import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter } from './rateLimit';

// Every test drives the clock explicitly (`now` args) rather than sleeping, so
// the suite stays deterministic and instant.

const T0 = 1_000_000;

// ─── Limit boundary ───────────────────────────────────────────────────────────

describe('RateLimiter — limit boundary', () => {
  it('allows exactly `max` requests in an instant burst, then rejects', () => {
    const limiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 5 }, T0);
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.tryConsume('a', T0), true, `request ${i + 1} should pass`);
    }
    assert.equal(limiter.tryConsume('a', T0), false, 'the 6th request should be rejected');
  });

  it('stays rejected while the bucket is under one token', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 2 }, T0);
    limiter.tryConsume('a', T0);
    limiter.tryConsume('a', T0);
    // 2 tokens per 1000ms → 400ms buys 0.8 tokens, still short of one.
    assert.equal(limiter.tryConsume('a', T0 + 400), false);
    // 100ms more clears 1.0.
    assert.equal(limiter.tryConsume('a', T0 + 500), true);
  });

  it('never refills past capacity however long it idles', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 3 }, T0);
    assert.equal(limiter.tryConsume('a', T0), true);
    const farFuture = T0 + 1000 * 60 * 60;
    for (let i = 0; i < 3; i++) {
      assert.equal(limiter.tryConsume('a', farFuture), true, `burst ${i + 1} after idling`);
    }
    assert.equal(limiter.tryConsume('a', farFuture), false, 'capacity is still only 3');
  });
});

// ─── Window expiry ────────────────────────────────────────────────────────────

describe('RateLimiter — window expiry', () => {
  it('is fully replenished one window after being drained', () => {
    const windowMs = 15 * 60 * 1000;
    const limiter = new RateLimiter({ windowMs, max: 5 }, T0);
    for (let i = 0; i < 5; i++) limiter.tryConsume('a', T0);
    assert.equal(limiter.tryConsume('a', T0), false);

    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.tryConsume('a', T0 + windowMs), true, `post-window request ${i + 1}`);
    }
    assert.equal(limiter.tryConsume('a', T0 + windowMs), false);
  });

  it('refills proportionally partway through the window', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 10 }, T0);
    for (let i = 0; i < 10; i++) limiter.tryConsume('a', T0);
    assert.equal(limiter.tryConsume('a', T0), false);

    // Half a window = half the capacity back.
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.tryConsume('a', T0 + 500), true, `half-window request ${i + 1}`);
    }
    assert.equal(limiter.tryConsume('a', T0 + 500), false);
  });
});

// ─── Per-key isolation ────────────────────────────────────────────────────────

describe('RateLimiter — per-key isolation', () => {
  it('keeps a separate budget per key', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 2 }, T0);
    assert.equal(limiter.tryConsume('alice', T0), true);
    assert.equal(limiter.tryConsume('alice', T0), true);
    assert.equal(limiter.tryConsume('alice', T0), false);

    assert.equal(limiter.tryConsume('bob', T0), true, 'bob is unaffected by alice');
    assert.equal(limiter.tryConsume('bob', T0), true);
    assert.equal(limiter.tryConsume('bob', T0), false);
  });

  it('rejects when ANY of several keys is exhausted', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 2 }, T0);
    // Drain the shared IP key via two different emails.
    assert.equal(limiter.tryConsume(['ip:1.2.3.4', 'email:a@x.com'], T0), true);
    assert.equal(limiter.tryConsume(['ip:1.2.3.4', 'email:b@x.com'], T0), true);
    // A third, previously unseen email is still blocked by the IP key.
    assert.equal(limiter.tryConsume(['ip:1.2.3.4', 'email:c@x.com'], T0), false);
    // A different IP with that same fresh email goes through.
    assert.equal(limiter.tryConsume(['ip:5.6.7.8', 'email:c@x.com'], T0), true);
  });

  it('does not debit any key when the request is rejected', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 1 }, T0);
    assert.equal(limiter.tryConsume('ip:1.2.3.4', T0), true); // ip now empty
    // Rejected on the ip key — the email key must not lose its token.
    assert.equal(limiter.tryConsume(['ip:1.2.3.4', 'email:a@x.com'], T0), false);
    assert.equal(limiter.tryConsume('email:a@x.com', T0), true, 'email budget was preserved');
  });
});

// ─── Eviction ─────────────────────────────────────────────────────────────────

describe('RateLimiter — eviction', () => {
  it('drops keys idle for a full window instead of growing forever', () => {
    const windowMs = 1000;
    const limiter = new RateLimiter({ windowMs, max: 5 }, T0);
    for (let i = 0; i < 50; i++) limiter.tryConsume(`user-${i}`, T0);
    assert.equal(limiter.size, 50);

    // One request a full window later sweeps every idle bucket; only the key
    // used in that request survives.
    limiter.tryConsume('late-arrival', T0 + windowMs);
    assert.equal(limiter.size, 1);
  });

  it('keeps buckets that are still inside the window', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 5 }, T0);
    limiter.tryConsume('old', T0);
    limiter.tryConsume('recent', T0 + 600);
    limiter.tryConsume('trigger', T0 + 1000); // sweeps: 'old' is 1000ms idle, 'recent' only 400ms
    assert.equal(limiter.size, 2);
    assert.deepEqual(
      // 'old' was evicted, so it comes back at full capacity.
      Array.from({ length: 5 }, () => limiter.tryConsume('old', T0 + 1000)),
      [true, true, true, true, true],
    );
  });

  it('sweeps at most once per window', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 5 }, T0);
    limiter.tryConsume('a', T0);
    limiter.tryConsume('b', T0 + 100);
    // Not a full window since construction — nothing swept.
    assert.equal(limiter.size, 2);
  });

  it('eviction is unobservable — a swept bucket equals a fully refilled one', () => {
    const windowMs = 1000;
    const swept = new RateLimiter({ windowMs, max: 3 }, T0);
    const fresh = new RateLimiter({ windowMs, max: 3 }, T0);

    for (let i = 0; i < 3; i++) swept.tryConsume('a', T0);
    swept.sweep(T0 + windowMs); // 'a' is dropped

    const after = T0 + windowMs;
    for (let i = 0; i < 4; i++) {
      assert.equal(
        swept.tryConsume('a', after),
        fresh.tryConsume('a', after),
        `request ${i + 1} must behave identically swept vs never-seen`,
      );
    }
  });
});

// ─── Chat limiter parity ──────────────────────────────────────────────────────

describe('RateLimiter — chat limiter parity', () => {
  // The Team Chat limiter was a hand-rolled bucket of CAPACITY 10 refilling at
  // 2 tokens/second. { max: 10, windowMs: 5000 } is the same bucket exactly
  // (10 / 5000ms = 2/1000ms) — this pins that equivalence.
  it('reproduces the original chat burst and sustained rate', () => {
    const limiter = new RateLimiter({ windowMs: 5000, max: 10 }, T0);
    for (let i = 0; i < 10; i++) {
      assert.equal(limiter.tryConsume('u', T0), true, `burst message ${i + 1}`);
    }
    assert.equal(limiter.tryConsume('u', T0), false, '11th message in the burst is throttled');
    // 500ms buys exactly one token back — 2 per second.
    assert.equal(limiter.tryConsume('u', T0 + 499), false);
    assert.equal(limiter.tryConsume('u', T0 + 500), true);
  });
});

// ─── maxKeys cap ──────────────────────────────────────────────────────────────
// The IP arm of a limiter is keyed on a header we cannot fully trust, so the
// key space is partly caller-controlled. Time-based eviction alone does not
// bound it: sweep() runs at most once per window, which for the 15-minute
// forgot-password window is a long time to insert keys into.

describe('RateLimiter — maxKeys cap', () => {
  it('bounds the map even when every key is unique', () => {
    const limiter = new RateLimiter({ windowMs: 900_000, max: 5, maxKeys: 100 });
    for (let i = 0; i < 5_000; i++) limiter.tryConsume(`forged:${i}`, T0 + i);
    assert.ok(limiter.size <= 100, `expected <= 100 keys, got ${limiter.size}`);
  });

  it('does not let a flood of forged keys reset the bucket being charged', () => {
    const limiter = new RateLimiter({ windowMs: 900_000, max: 5, maxKeys: 10 });
    for (let i = 0; i < 4; i++) {
      assert.equal(limiter.tryConsume('real:victim', T0), true, `spend ${i}`);
    }
    for (let i = 0; i < 500; i++) limiter.tryConsume(`forged:${i}`, T0);
    assert.equal(limiter.tryConsume('real:victim', T0), true, 'fifth and last token');
    assert.equal(limiter.tryConsume('real:victim', T0), false, 'bucket survived the flood');
  });
});
