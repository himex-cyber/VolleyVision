import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveViewMode, type ViewMode } from './viewMode';

const at = (over: Partial<Parameters<typeof resolveViewMode>[0]> = {}) =>
  resolveViewMode({ canCoach: false, canPlay: false, stored: null, signupIntent: null, ...over });

describe('resolveViewMode — capability beats stated intent', () => {
  it('sends a coach-only user to the coach view even if they signed up as PLAYER', () => {
    assert.equal(at({ canCoach: true, signupIntent: 'PLAYER' }), 'coach');
  });

  it('sends a player-only user to the player view even if they signed up as COACH', () => {
    assert.equal(at({ canPlay: true, signupIntent: 'COACH' }), 'player');
  });

  it('ignores a stale stored toggle once the user has only one capability', () => {
    assert.equal(at({ canCoach: true, stored: 'player', signupIntent: 'PLAYER' }), 'coach');
    assert.equal(at({ canPlay: true, stored: 'coach', signupIntent: 'COACH' }), 'player');
  });
});

describe('resolveViewMode — intent breaks the tie', () => {
  for (const [label, caps] of [
    ['dual-capability', { canCoach: true, canPlay: true }],
    ['no capabilities yet', { canCoach: false, canPlay: false }],
  ] as const) {
    it(`respects PLAYER intent for a ${label} user`, () => {
      assert.equal(at({ ...caps, signupIntent: 'PLAYER' }), 'player');
    });

    it(`defaults a ${label} user to coach for COACH / UNSURE / missing intent`, () => {
      for (const intent of ['COACH', 'UNSURE', null, undefined]) {
        assert.equal(at({ ...caps, signupIntent: intent }), 'coach', `intent=${intent}`);
      }
    });

    it(`lets an explicit toggle outrank intent for a ${label} user`, () => {
      assert.equal(at({ ...caps, stored: 'coach', signupIntent: 'PLAYER' }), 'coach');
      assert.equal(at({ ...caps, stored: 'player', signupIntent: 'COACH' }), 'player');
    });
  }
});

describe('resolveViewMode — total', () => {
  it('returns a valid mode for every input combination', () => {
    const modes: ViewMode[] = ['coach', 'player'];
    for (const canCoach of [true, false]) {
      for (const canPlay of [true, false]) {
        for (const stored of [null, 'coach', 'player'] as const) {
          for (const signupIntent of ['COACH', 'PLAYER', 'UNSURE', null]) {
            assert.ok(modes.includes(resolveViewMode({ canCoach, canPlay, stored, signupIntent })));
          }
        }
      }
    }
  });
});
