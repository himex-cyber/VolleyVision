// What the server sends to Sentry about a request. 9.0.9: no IP address, from
// any proxy header Netlify or a CDN adds, or from the user block.
import assert from 'node:assert/strict';
import { scrubRequest } from './sentryScrub';

const event: Parameters<typeof scrubRequest>[0] = scrubRequest({
  request: {
    url: 'https://x.test/api/v1/invitations/TOKEN123/accept?q=kid@x.test',
    data: { password: 'p' },
    cookies: { a: 'b' },
    query_string: 'q=kid@x.test',
    headers: {
      Authorization: 'Bearer t', cookie: 'c', 'X-Forwarded-For': '203.0.113.9', 'x-real-ip': '203.0.113.9',
      'x-nf-client-connection-ip': '203.0.113.9', 'CF-Connecting-IP': '203.0.113.9', 'true-client-ip': '203.0.113.9',
      'x-client': 'android/9.15.0', 'user-agent': 'UA',
    },
  },
  user: { ip_address: '203.0.113.9', id: undefined },
});

assert.deepEqual(Object.keys(event.request!.headers!).sort(), ['user-agent', 'x-client'], 'only harmless headers stay');
assert.equal(event.user?.ip_address, undefined, 'no IP on the user block');
assert.ok(!('ip_address' in (event.user ?? {})));
assert.ok(!JSON.stringify(event).includes('203.0.113.9'), 'the IP appears nowhere');
assert.ok(!JSON.stringify(event).includes('kid@x.test'), 'no query values');
assert.equal(event.request!.data, undefined);
assert.equal(event.tags?.client, 'android/9.15.0', 'the client tag is set per event');

// An event with no request (a background error) passes, still without an IP.
assert.deepEqual(scrubRequest({ user: { ip_address: '{{auto}}' } }), { user: {} });

console.log('sentryScrub.test.ts passed');
