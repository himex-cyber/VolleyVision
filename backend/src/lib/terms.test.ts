// 9.3: who must (re)accept the Terms before posting in team chat.
import assert from 'node:assert/strict';
import { CURRENT_TERMS_VERSION, termsRequired } from './terms';

assert.equal(termsRequired({ termsAcceptedAt: null, termsVersion: null }), true, 'never accepted (accounts from before v9.17.0)');
assert.equal(termsRequired({ termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION }), false, 'accepted the current Terms');
assert.equal(termsRequired({ termsAcceptedAt: new Date(), termsVersion: '2020-01-01' }), true, 'accepted an older version');
assert.equal(termsRequired({ termsAcceptedAt: null, termsVersion: CURRENT_TERMS_VERSION }), true, 'a version without a date is not acceptance');
assert.match(CURRENT_TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/, 'the version is the Terms page date');

console.log('terms.test.ts passed');
