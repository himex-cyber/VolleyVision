// What a URL may look like once it reaches Sentry. The query string and
// fragment go (they carry reset tokens and join codes under innocent key names;
// see instrument.ts), and so do the two path segments that ARE credentials: a
// team join code on /invitations/lookup/:code and an invitation token on
// /invitations/:token/accept|decline. Folded by route shape, not by what the
// value looks like, so a new code format can't slip past.
//
// Used by instrument.ts and netlify-functions/api.js; frontend/src/main.tsx
// keeps a copy (the frontend can't import backend code).

const CREDENTIAL_SEGMENTS: Array<[RegExp, string]> = [
  [/\/invitations\/lookup\/[^/]+/g, '/invitations/lookup/:code'],
  [/\/invitations\/[^/]+\/(accept|decline)(?=\/|$)/g, '/invitations/:token/$1'],
];

export function scrubUrl(url: string): string {
  let out = url.split('?')[0].split('#')[0];
  for (const [pattern, replacement] of CREDENTIAL_SEGMENTS) out = out.replace(pattern, replacement);
  return out;
}
