// Guard for admin scripts that write (9.0.8 scrub-deleted-messages, 9.4
// delete-account). Prisma and dotenv fill an unset DATABASE_URL from
// backend/.env, which is production, so the target must be explicit: a local
// DATABASE_URL, or --prod to mean backend/.env. Call it with process.env read
// BEFORE anything imports lib/prisma or runs dotenv.

import { isLocal } from './localDb';

type Env = Record<string, string | undefined>;

export type AdminTarget =
  | { apply: boolean; prod: boolean; env: Env }
  | { error: string };

/** `env` is what to pin into process.env before loading Prisma. */
export function adminScriptTarget(argv: string[], env: Env): AdminTarget {
  const apply = argv.includes('--apply');
  if (argv.includes('--prod')) return { apply, prod: true, env: {} };

  const url = env.DATABASE_URL ?? '';
  const direct = env.DIRECT_URL || url;
  if (!isLocal(url) || !isLocal(direct)) {
    return {
      error: 'Refusing to run: set DATABASE_URL (and DIRECT_URL, if set) to a local database, '
        + 'or pass --prod to use backend/.env (production).',
    };
  }
  // Blank, not unset: dotenv never overwrites a set variable, so local runs
  // can't pick up production's storage keys from backend/.env.
  return { apply, prod: false, env: { DIRECT_URL: direct, SUPABASE_URL: env.SUPABASE_URL ?? '', SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ?? '' } };
}

/** Which database, without printing the URL (it holds the password). */
export function projectRef(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    const fromUser = /^postgres\.([a-z0-9]+)$/.exec(u.username); // Supabase pooler
    const fromHost = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname); // direct
    return fromUser?.[1] ?? fromHost?.[1] ?? u.hostname;
  } catch {
    return 'unknown';
  }
}
