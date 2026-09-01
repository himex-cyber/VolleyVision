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
const app = require('../dist/index').default;

const handler = serverless(app);

const FUNCTION_PREFIX = '/.netlify/functions/api';

exports.handler = async (event, context) => {
  if (event.path && event.path.startsWith(FUNCTION_PREFIX)) {
    event.path = event.path.slice(FUNCTION_PREFIX.length) || '/';
  }
  return handler(event, context);
};
