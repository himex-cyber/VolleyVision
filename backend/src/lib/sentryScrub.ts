// What the API sends to Sentry about a request (moved from instrument.ts in
// 9.0.9, so it can be tested). Pure: no Sentry import.
import { scrubUrl } from './scrubUrl';
import { clientTag } from './clientVersion';

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
  user?: { ip_address?: unknown; [key: string]: unknown };
};

// 9.0.9: the client's IP, as Netlify and common proxies/CDNs forward it.
const IP_HEADERS = new Set([
  'x-forwarded-for', 'x-real-ip', 'x-nf-client-connection-ip', 'client-ip', 'forwarded',
  'cf-connecting-ip', 'true-client-ip',
]);

export function scrubRequest<T extends ScrubbableEvent>(event: T): T {
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
        if (lower === 'authorization' || lower === 'cookie' || IP_HEADERS.has(lower)) delete headers[key];
      }
    }
  }

  // No IP address anywhere (9.0.9). Browser and app events go to Sentry
  // directly, so the project's "Prevent Storing of IP Addresses" is needed too.
  if (event.user) delete event.user.ip_address;

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
  // rides along on the error. Same rule as the browser (frontend/src/main.tsx): path only.
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
