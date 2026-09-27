import assert from 'node:assert/strict';
import { stagingGuardError, PROD_PROJECT_REF } from './stagingGuard';

const STAGING = 'abcdefghijklmnopqrst';
const stagingUrl = `postgresql://postgres.${STAGING}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
const prodUrl = `postgresql://postgres.${PROD_PROJECT_REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;

// The one allowed shape.
assert.equal(stagingGuardError({ STAGING_PROJECT_REF: STAGING, DATABASE_URL: stagingUrl }), null);

// Missing or blank ref: '' would match every URL.
assert.ok(stagingGuardError({ DATABASE_URL: stagingUrl }));
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: '', DATABASE_URL: stagingUrl }));
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: '   ', DATABASE_URL: stagingUrl }));

// Prod, whichever way it sneaks in.
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: STAGING, DATABASE_URL: prodUrl }));
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: PROD_PROJECT_REF, DATABASE_URL: prodUrl }));
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: STAGING, DATABASE_URL: `${stagingUrl}?x=${PROD_PROJECT_REF}` }));

// No URL, or a URL for some other database.
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: STAGING }));
assert.ok(stagingGuardError({ STAGING_PROJECT_REF: STAGING, DATABASE_URL: 'postgresql://ci:ci@localhost:5432/ci' }));

console.log('stagingGuard tests passed.');
