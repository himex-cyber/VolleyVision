// The database half of GET /health.
//
// /health used to answer "ok" without touching the database, so it stayed
// green through the 2026-09-27 Supabase pause, the outage this app is likeliest
// to have. It now runs a trivial query, bounded by a timeout: a paused or
// unreachable database can hang the first query until Prisma's connect timeout,
// and an uptime monitor needs a prompt 503, not a function timeout. The bound
// is generous because a cold start pays for the engine load and the first
// connection inside it.
export async function checkDatabase(ping: () => Promise<unknown>, timeoutMs = 5000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([ping().then(() => true), timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
