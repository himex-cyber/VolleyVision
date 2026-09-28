import assert from 'node:assert/strict';
import { allowedOrigins } from './corsOrigins';

// CLIENT_URL alone (today's behaviour), with the local default when unset.
assert.deepEqual(allowedOrigins({ CLIENT_URL: 'https://volleyvision-app.netlify.app' }), ['https://volleyvision-app.netlify.app']);
assert.deepEqual(allowedOrigins({}), ['http://localhost:5173']);

// Extra origins: comma-separated, trimmed, empties dropped.
assert.deepEqual(
  allowedOrigins({ CLIENT_URL: 'https://app.test', CORS_EXTRA_ORIGINS: ' https://localhost , ,capacitor://localhost,' }),
  ['https://app.test', 'https://localhost', 'capacitor://localhost'],
);
assert.deepEqual(allowedOrigins({ CLIENT_URL: 'https://app.test', CORS_EXTRA_ORIGINS: '' }), ['https://app.test']);

console.log('corsOrigins.test.ts passed');
