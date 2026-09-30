// Terms acceptance (9.3). Play's user-generated-content policy: people accept
// Terms that define prohibited content before they can post. The version is
// the date on frontend/public/terms.html; raising it asks everyone to accept
// again on their next sign-in.

export const CURRENT_TERMS_VERSION = '2026-10-01';

export const TERMS_REQUIRED_MESSAGE = 'Please accept the Terms before posting in team chat.';

export function termsRequired(user: { termsAcceptedAt: Date | null; termsVersion: string | null }): boolean {
  return !user.termsAcceptedAt || user.termsVersion !== CURRENT_TERMS_VERSION;
}
