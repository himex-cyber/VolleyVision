import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_GENERATION_ATTEMPTS,
  generateUniqueCode,
  normalizeCode,
} from './joinCode';

const never = async () => false;   // nothing is taken
const always = async () => true;   // everything collides

// ─── Alphabet & format ────────────────────────────────────────────────────────

describe('CODE_ALPHABET', () => {
  it('excludes the characters users confuse when reading a code aloud', () => {
    for (const ambiguous of ['0', 'O', '1', 'I']) {
      assert.equal(CODE_ALPHABET.includes(ambiguous), false, `${ambiguous} must not be in the alphabet`);
    }
  });

  it('is uppercase-only, with no duplicates', () => {
    assert.equal(CODE_ALPHABET, CODE_ALPHABET.toUpperCase());
    assert.equal(new Set(CODE_ALPHABET).size, CODE_ALPHABET.length);
  });
});

describe('generateUniqueCode — format', () => {
  it('returns a code of the documented length drawn only from the alphabet', async () => {
    for (let i = 0; i < 200; i++) {
      const code = await generateUniqueCode(never);
      assert.equal(code.length, CODE_LENGTH);
      for (const char of code) {
        assert.equal(CODE_ALPHABET.includes(char), true, `"${char}" is not in the alphabet`);
      }
    }
  });

  it('checks the candidate exactly once when it is free', async () => {
    let calls = 0;
    await generateUniqueCode(async () => { calls++; return false; });
    assert.equal(calls, 1);
  });

  it('produces varied codes rather than a constant', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(await generateUniqueCode(never));
    // 32^8 possibilities — a repeat in 100 draws would mean the generator is broken.
    assert.equal(codes.size, 100);
  });
});

// ─── Collision retry ──────────────────────────────────────────────────────────

describe('generateUniqueCode — collision retry', () => {
  it('retries past a taken code and returns the first free one', async () => {
    const taken: string[] = [];
    let calls = 0;
    const code = await generateUniqueCode(async (candidate) => {
      calls++;
      if (calls <= 3) { taken.push(candidate); return true; }
      return false;
    });
    assert.equal(calls, 4);
    assert.equal(taken.includes(code), false, 'the returned code was one it had already rejected');
    assert.equal(code.length, CODE_LENGTH);
  });

  it('gives every attempt a fresh candidate', async () => {
    const seen: string[] = [];
    await generateUniqueCode(async (candidate) => {
      seen.push(candidate);
      return seen.length < 5;
    });
    assert.equal(seen.length, 5);
    assert.equal(new Set(seen).size, 5, 'the same candidate was tried twice');
  });
});

// ─── UUID fallback ────────────────────────────────────────────────────────────

describe('generateUniqueCode — UUID fallback', () => {
  it('stops after MAX_GENERATION_ATTEMPTS and falls back', async () => {
    let calls = 0;
    const code = await generateUniqueCode(async () => { calls++; return true; });
    assert.equal(calls, MAX_GENERATION_ATTEMPTS);
    assert.equal(typeof code, 'string');
  });

  it('the fallback is uppercase hex, longer than a normal code', async () => {
    const code = await generateUniqueCode(always);
    assert.equal(code.length, 10);
    assert.match(code, /^[0-9A-F]{10}$/);
    assert.equal(code.length > CODE_LENGTH, true);
  });

  it('the fallback is not checked for collisions — that is the point of giving up', async () => {
    // It escapes the loop entirely, so `exists` is never consulted about it.
    const candidates: string[] = [];
    const code = await generateUniqueCode(async (candidate) => { candidates.push(candidate); return true; });
    assert.equal(candidates.includes(code), false);
  });

  it('produces distinct fallbacks', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(await generateUniqueCode(always));
    assert.equal(codes.size, 50);
  });
});

// ─── Normalization ────────────────────────────────────────────────────────────

describe('normalizeCode', () => {
  it('uppercases, so a lower-case entry still matches the stored code', () => {
    assert.equal(normalizeCode('abcd2345'), 'ABCD2345');
    assert.equal(normalizeCode('AbCd2345'), 'ABCD2345');
  });

  it('strips the whitespace a paste drags along', () => {
    assert.equal(normalizeCode('  ABCD2345  '), 'ABCD2345');
    assert.equal(normalizeCode('\tABCD2345\n'), 'ABCD2345');
  });

  it('handles case and whitespace together', () => {
    assert.equal(normalizeCode('  abcd2345\n'), 'ABCD2345');
  });

  it('leaves an already-normal code untouched, and is idempotent', () => {
    assert.equal(normalizeCode('ABCD2345'), 'ABCD2345');
    assert.equal(normalizeCode(normalizeCode('  abcd2345 ')), normalizeCode('  abcd2345 '));
  });

  it('does not strip inner separators — a code is matched exactly, not fuzzily', () => {
    // Pins current behaviour: "ABCD-2345" is a miss, not a silent match.
    assert.equal(normalizeCode('abcd-2345'), 'ABCD-2345');
  });

  it('normalizes a generated code to itself', async () => {
    const code = await generateUniqueCode(never);
    assert.equal(normalizeCode(code), code);
  });
});
