// Must run before express/route modules load: Sentry.init() patches
// Node's http internals, which only reaches code imported after this file.
// index.ts makes this its first import for exactly that reason.
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

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
    environment: process.env.NODE_ENV || 'development',
    // Free-tier Sentry quota: 10% keeps trace volume affordable. Raise only
    // after confirming there's quota headroom to spend.
    tracesSampleRate: 0.1,
    // VolleyVision stores players' emails, phone numbers, DOBs, chat
    // messages and match footage that may include minors. Sentry must not
    // become a second copy of that: no IP/user data by default, and
    // beforeSend below strips what sendDefaultPii alone doesn't cover.
    sendDefaultPii: false,
    beforeSend(event: Sentry.ErrorEvent) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        const headers = event.request.headers;
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'cookie') {
              delete headers[key];
            }
          }
        }
      }
      return event;
    },
  });
}

export default Sentry;
