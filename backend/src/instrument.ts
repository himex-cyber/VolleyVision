// Must run before express/route modules load: Sentry.init() patches
// Node's http internals, which only reaches code imported after this file.
// index.ts makes this its first import for exactly that reason.
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { scrubRequest } from './lib/sentryScrub';

// index.ts also calls dotenv.config(), but only after its own imports
// evaluate; this file runs first, so it self-loads env the same way
// lib/supabase.ts does. dotenv never overwrites an already-set variable, so
// index.ts's later call is a harmless re-read.
dotenv.config();

const dsn = process.env.SENTRY_DSN;

// Fail-soft, same convention as lib/supabase.ts's lazy client: no DSN is the
// normal state in local dev and in `npm test`, and Sentry must never be why
// either fails to boot.
if (dsn) {
  Sentry.init({
    dsn,
    // SENTRY_ENVIRONMENT first: staging runs with NODE_ENV=production (the
    // Postgres rate limiter only runs there), so NODE_ENV alone would tag every
    // staging error as production.
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    // Free-tier Sentry quota: 10% keeps trace volume affordable. Raise only
    // after confirming there's quota headroom to spend.
    tracesSampleRate: 0.1,
    // VolleyVision stores players' emails, phone numbers, DOBs, chat
    // messages and match footage that may include minors. Sentry must not
    // become a second copy of that: no IP/user data by default, and
    // beforeSend below strips what sendDefaultPii alone doesn't cover.
    sendDefaultPii: false,
    beforeSend: scrubRequest,
    // Errors are not the only events carrying request data: with tracing on,
    // transactions get the same `request` block and the same span attributes.
    beforeSendTransaction: scrubRequest,
  });
}

export default Sentry;
