import assert from 'node:assert/strict';
import { parseClient, compareVersions, isOutdated, clientTag } from './clientVersion';

// Ordering, numerically per part (9.13.0 > 9.9.0, not string order).
const ordered = ['9.9.0', '9.12.9', '9.13.0', '9.13.1', '9.14.0', '10.0.0'];
for (let i = 1; i < ordered.length; i++) {
  assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1, `${ordered[i - 1]} < ${ordered[i]}`);
  assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
}
assert.equal(compareVersions('9.13.0', '9.13.0'), 0);

// Parsing X-Client: <platform>/<semver>.
assert.deepEqual(parseClient('android/9.14.0'), { platform: 'android', version: '9.14.0' });
assert.deepEqual(parseClient('ios/9.15.0'), { platform: 'ios', version: '9.15.0' });
for (const bad of [undefined, '', 'android', 'android/', 'android/unknown', 'android/9.14', 'android/9.14.0.1',
  'android/v9.14.0', 'windows/9.14.0', 'ANDROID/9.14.0', ' android/9.14.0', 'android/9.14.0-beta', 'android/09999999999999999999.0.0']) {
  assert.equal(parseClient(bad), null, `unparsable: ${JSON.stringify(bad)}`);
}

// Only a parsed client below its platform's minimum is outdated.
assert.equal(isOutdated('android/9.12.9'), true);
assert.equal(isOutdated('android/9.10.0'), true);
assert.equal(isOutdated('android/9.13.0'), false);
assert.equal(isOutdated('android/9.14.0'), false);
assert.equal(isOutdated('android/10.0.0'), false);
assert.equal(isOutdated('ios/0.0.1'), false, 'no iOS minimum yet');
assert.equal(isOutdated('ios/9.15.0'), false);
for (const pass of [undefined, 'android/unknown', 'garbage', 'android/9.12']) {
  assert.equal(isOutdated(pass), false, `passes through: ${JSON.stringify(pass)}`);
}

// The Sentry `client` tag: a parsed header, 'web' without one, and 'unknown'
// for anything else (so a client can't put arbitrary text in a tag).
assert.equal(clientTag({ 'x-client': 'ios/9.15.0' }), 'ios/9.15.0');
assert.equal(clientTag({ 'x-client': 'android/9.14.0' }), 'android/9.14.0');
assert.equal(clientTag({}), 'web');
assert.equal(clientTag(undefined), 'web');
assert.equal(clientTag({ 'x-client': 'x'.repeat(500) }), 'unknown');
assert.equal(clientTag({ 'x-client': ['ios/9.15.0'] }), 'unknown');

console.log('clientVersion.test.ts passed');
