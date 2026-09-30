// Must run before express/route modules load: Sentry.init() patches
// Node's http internals, which only reaches code imported after this file.
// index.ts makes this its first import for exactly that reason.
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { scrubUrl } from './lib/scrubUrl';
import { clientTag } from './lib/clientVersion';

// index.ts also calls dotenv.config(), but only after its own imports
// evaluate; this file runs first, so it self-loads env the same way
// lib/supabase.ts does. dotenv never overwrites an already-set variable, so
// index.ts's later call is a harmless re-read.
dotenv.config();

// Strip the parts of a captured request that can carry personal data.
//
// `sendDefaultPii: false` is NOT "attach nothing" in SDK v10 — it switches the
// SDK to a DENY-LIST (see @sentry/core/build/cjs/utils/data-collection/).
// Headers, cookies and query params are all still attached; keys matching a
// fixed snippet list are replaced with "[Filtered]". That list contains "auth"
// and "cookie", so `authorization` and `cookie` headers are already scrubbed
// upstream — the header loop below is defence in depth, not the only guard,
// and it stays because that list is Sentry's to change, not ours.
//
// What the deny-list does NOT cover, and this does:
//
//   * `request.url` is attached unconditionally and passes through no filter
//     whatsoever — requestdata.js sets `url: true` with the comment "No
//     dataCollection equivalent — URL is always included" — and Express's
//     `req.url` carries the query string.
//   * `query_string` IS filtered, but by KEY NAME only. Every sensitive value
//     this app puts in a query string sits under an innocuous key: `?q=` on
//     the add-member lookup is a complete email address, `?opponent=` is a
//     club name. Key matching never fires on those.
//
// So the query string is dropped outright, here and on spans. The path alone
// is what makes an error diagnosable; the values after "?" only ever cost us.
// Two path segments are credentials too (a join code, an invitation token);
// lib/scrubUrl.ts folds those.
//
// The type below is structural, not Sentry.ErrorEvent | Sentry.TransactionEvent: @sentry/node
// re-exports ErrorEvent but not TransactionEvent, and reaching past it into
// @sentry/core would mean depending directly on a transitive package. These
// are the only fields touched, so describing just them costs nothing.
type ScrubbableEvent = {
  transaction?: string;
  request?: {
    url?: string;
    data?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    headers?: Record<string, unknown>;
  };
  spans?: Array<{ data?: Record<string, unknown> }>;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
  tags?: Record<string, unknown>;
};

function scrubRequest<T extends ScrubbableEvent>(event: T): T {
  const request = event.request;
  if (request) {
    // Per event, not Sentry.setTag: a module-level tag would be shared by every
    // request the function serves.
    event.tags = { ...event.tags, client: clientTag(request.headers) };
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (request.url) request.url = scrubUrl(request.url);

    const headers = request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie') delete headers[key];
      }
    }
  }

  // Without a matched route the transaction is named after the raw path.
  if (event.transaction) event.transaction = scrubUrl(event.transaction);

  // Spans carry their own copy: processSegmentSpan writes the same unfiltered
  // URL to url.full and the query to url.query, so clearing event.request
  // alone would leave the address sitting in the trace.
  for (const span of event.spans ?? []) {
    const data = span.data;
    if (!data) continue;
    if (typeof data['url.full'] === 'string') data['url.full'] = scrubUrl(data['url.full']);
    delete data['url.query'];
  }

  // Breadcrumbs too: an outgoing-HTTP breadcrumb keeps the full URL plus its
  // query and fragment, and every breadcrumb recorded earlier in the request
  // rides along on the error. Same rule as the browser (src/main.tsx): path only.
  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    for (const key of ['url', 'from', 'to']) {
      if (typeof data[key] === 'string') data[key] = scrubUrl(data[key] as string);
    }
    delete data['http.query'];
    delete data['http.fragment'];
  }

  return event;
}

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
