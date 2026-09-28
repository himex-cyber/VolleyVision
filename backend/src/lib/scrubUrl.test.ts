import assert from 'node:assert/strict';
import { scrubUrl } from './scrubUrl';

// Record ids (cuids) are not credentials and stay: they make an error findable.
const CUID = 'ckz8x1q0v0000abcd1234efgh';
assert.equal(scrubUrl(`/api/v1/teams/${CUID}/members`), `/api/v1/teams/${CUID}/members`);

// A team join code in the lookup path.
assert.equal(scrubUrl('/api/v1/invitations/lookup/K7Q2M9PX'), '/api/v1/invitations/lookup/:code');
assert.equal(scrubUrl('https://volleyvision-app.netlify.app/api/v1/invitations/lookup/AB%2DCD?x=1'), 'https://volleyvision-app.netlify.app/api/v1/invitations/lookup/:code');

// An invitation token (UUID) on accept/decline.
const TOKEN = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
assert.equal(scrubUrl(`/api/v1/invitations/${TOKEN}/accept`), '/api/v1/invitations/:token/accept');
assert.equal(scrubUrl(`/api/v1/invitations/${TOKEN}/decline#top`), '/api/v1/invitations/:token/decline');

// Routes with fixed segments are left alone.
assert.equal(scrubUrl('/api/v1/invitations/redeem'), '/api/v1/invitations/redeem');
assert.equal(scrubUrl('/api/v1/invitations/redeem-team-code'), '/api/v1/invitations/redeem-team-code');

// Query strings and fragments always go.
assert.equal(scrubUrl('/reset-password?token=secret'), '/reset-password');
assert.equal(scrubUrl('/a#b'), '/a');

console.log('scrubUrl.test.ts passed');
