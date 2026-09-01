// Supabase Storage client — Team Chat and Feedback attachments live in the
// private `team-chat` bucket. Both the app database and object storage are on
// Supabase; this module covers Storage only (Prisma owns the database), and
// MessageAttachment/FeedbackAttachment.storagePath is the link between the two.
// The service-role key is server-only (bypasses RLS; the private bucket is
// default-deny to everyone else) — it must never reach the frontend or logs.

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../middleware/errorHandler';

// Self-load env: index.ts calls dotenv.config() only after its imports have
// evaluated, and standalone scripts import this module directly.
dotenv.config();

let client: SupabaseClient | null = null;

/**
 * Memoized Storage client, created on first use.
 *
 * Deliberately lazy: this module is reachable from the chat and feedback
 * routers, which index.ts imports unconditionally. Throwing at module load
 * would take the entire API down (auth, matches, analytics) over a storage
 * misconfiguration, so the failure is deferred to the endpoints that actually
 * need storage and surfaces there as a clean 503.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      'Supabase Storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see backend/.env.example).',
    );
    throw new AppError(503, 'Attachment storage is not configured.');
  }

  client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return client;
}
