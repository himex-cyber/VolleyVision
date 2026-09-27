// Profile images are rendered to other users, so they may only point at our
// own Supabase storage host (derived from SUPABASE_URL, the same env var the
// storage client uses) — never an arbitrary, possibly tracking, host.

/** True when `url` is an https URL on the same host as `supabaseUrl`. */
export function isAllowedProfileImageUrl(url: string, supabaseUrl: string | undefined): boolean {
  if (!url || !supabaseUrl) return false;

  let parsed: URL;
  let supabaseHost: string;
  try {
    parsed = new URL(url);
    supabaseHost = new URL(supabaseUrl).host;
  } catch {
    return false;
  }

  return parsed.protocol === 'https:' && parsed.host === supabaseHost;
}
