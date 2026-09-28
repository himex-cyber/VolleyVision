// Imported before ../index by testing/http.ts. index.ts starts a real server on
// :3001 unless NETLIFY is set; the test runners set it, but an http test run on
// its own (ts-node src/__tests__/http.x.test.ts) would otherwise leave a
// listener holding the port after the test finishes.
process.env.NETLIFY ??= '1';
