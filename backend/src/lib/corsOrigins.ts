// Origins the API answers CORS for: the SPA (CLIENT_URL) plus the exact
// origins in CORS_EXTRA_ORIGINS (comma-separated). The Android app's WebView
// serves from https://localhost. Auth is a bearer header, never a cookie, so
// allowing that origin exposes no session: a page on it still needs a token.
// Exact strings only, no patterns, so nothing that merely looks similar passes.
export function allowedOrigins(env: Record<string, string | undefined>): string[] {
  const extra = (env.CORS_EXTRA_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return [env.CLIENT_URL || 'http://localhost:5173', ...extra];
}
