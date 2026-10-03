import { isNative } from './native';

// The legal pages are static files on the website (9.2), outside the SPA: plain
// <a href>, never a router <Link> (the catch-all route would send it home). In
// the apps the link is absolute, so it opens in the phone's browser instead of
// replacing the app. One spot for the address. volleyvision.co.nz (Karlos, 1 Oct)
// must point at the Netlify site (docs/domain-setup.md) before an app build with
// this ships, or the links won't open.
export const SITE_URL = 'https://volleyvision.co.nz';

export type LegalPage = 'privacy' | 'terms' | 'delete-account' | 'support';

/** The pages linked from the avatar menu and the signed-out footer. */
export const LEGAL_LINKS: readonly [LegalPage, string][] = [['privacy', 'Privacy'], ['terms', 'Terms'], ['support', 'Support']];

// The one config spot for the legal details (9.2). The static pages in
// public/ repeat them, and scripts/check-legal.mjs fails CI if they differ.
export const LEGAL_ENTITY = 'Himex Trading Ltd';
export const SUPPORT_EMAIL = 'support@volleyvision.co.nz';
/** Equals CURRENT_TERMS_VERSION in backend/src/lib/terms.ts and the date on terms.html. */
export const TERMS_VERSION = '2026-10-01';

export const legalHref = (page: LegalPage): string => (isNative() ? `${SITE_URL}/${page}` : `/${page}`);
