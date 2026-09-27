// Netlify serverless function wrapping the existing Express API (backend/src/index.ts,
// compiled to backend/dist/index.js) via serverless-http.
//
// Why a classic (event, context) handler instead of the newer Request/Response
// function format: serverless-http is built for AWS Lambda-style events, and
// Netlify's classic function runtime is Lambda-compatible. This lets the whole
// existing Express app (18 route files, middleware, error handler) run
// unchanged rather than being rewritten per-route.
//
// Path handling: depending on how a request reaches this function (direct hit
// on /.netlify/functions/api/..., or proxied here via the /api/v1/* redirect
// in netlify.toml), event.path may or may not include the
// "/.netlify/functions/api" prefix. Express's routes are mounted at
// "/api/v1/..." (see backend/src/index.ts), so we strip that prefix if present
// and leave the path alone otherwise — covers both cases without needing to
// know Netlify's exact internal routing behavior.
const serverless = require('serverless-http');
const Sentry = require('@sentry/node');
const app = require('../dist/index').default;

const handler = serverless(app);

const FUNCTION_PREFIX = '/.netlify/functions/api';

// Record ids are cuids. Folding them keeps "GET /api/v1/teams/:id" one
// transaction in Sentry instead of one per team.
const CUID_SEGMENT = /\/c[a-z0-9]{24}(?=\/|$)/g;

exports.handler = async (event, context) => {
  if (event.path && event.path.startsWith(FUNCTION_PREFIX)) {
    event.path = event.path.slice(FUNCTION_PREFIX.length) || '/';
  }

  // serverless-http hands each request straight to Express's app.handle(),
  // with no http.Server in between, so Sentry's automatic request
  // instrumentation never runs here: no per-request scope, no request data on
  // errors, no transaction. This does its job by hand:
  //   - a fresh isolation scope per invocation, so breadcrumbs from one request
  //     can't ride along on the next request's error in a warm instance;
  //   - the method and PATH on that scope, never the query string, which can
  //     carry tokens (instrument.ts strips it again anyway);
  //   - a root span, so Express's own spans have a parent and tracing works.
  const method = event.httpMethod;
  const path = event.path || '/';
  const host = event.headers && event.headers.host;
  try {
    return await Sentry.withIsolationScope((scope) => {
      scope.setSDKProcessingMetadata({
        normalizedRequest: { method, url: host ? `https://${host}${path}` : path },
      });
      return Sentry.startSpan(
        { name: `${method} ${path.replace(CUID_SEGMENT, '/:id')}`, op: 'http.server' },
        async (span) => {
          const result = await handler(event, context);
          Sentry.setHttpStatus(span, result.statusCode);
          return result;
        },
      );
    });
  } finally {
    // Netlify can freeze this function's execution environment for reuse the
    // instant it returns, before Sentry's background transport has sent
    // whatever it queued during the request; a just-captured error would
    // otherwise vanish silently. Bounded to 2s so an unreachable Sentry never
    // meaningfully adds to response latency. Requiring ../dist/index above
    // already ran instrument.ts (index.ts's first import), so Sentry is
    // initialized by now, or safely inert if SENTRY_DSN was unset.
    await Sentry.flush(2000).catch(() => {});
  }
};
