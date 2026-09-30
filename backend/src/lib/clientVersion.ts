// The installed apps send X-Client: <platform>/<version> (the web sends none).
// This parses it and says whether a build is below its platform's minimum.
// Anything that doesn't parse is treated as unknown and let through: the gate
// only ever refuses, so a spoofed or missing header can't unlock anything.

// Android before 9.13.0 sent absolute scores (erasing another device's points)
// and shifted match times on edit (8.5.0.2). No such APK is installed anywhere.
export const MIN_CLIENT_VERSION = { android: '9.13.0', ios: '0.0.0' } as const;

type Platform = keyof typeof MIN_CLIENT_VERSION;

const CLIENT_RE = /^(android|ios)\/(\d{1,6}\.\d{1,6}\.\d{1,6})$/;

export function parseClient(header: string | undefined): { platform: Platform; version: string } | null {
  const m = header ? CLIENT_RE.exec(header) : null;
  return m ? { platform: m[1] as Platform, version: m[2] } : null;
}

/** -1, 0 or 1, comparing each dotted part as a number. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function isOutdated(header: string | undefined): boolean {
  const client = parseClient(header);
  return client != null && compareVersions(client.version, MIN_CLIENT_VERSION[client.platform]) < 0;
}

/** The Sentry `client` tag for a request's headers (Node lower-cases their names). */
export function clientTag(headers: Record<string, unknown> | undefined): string {
  const raw = headers?.['x-client'];
  if (raw === undefined) return 'web';
  const client = typeof raw === 'string' ? parseClient(raw) : null;
  return client ? `${client.platform}/${client.version}` : 'unknown';
}
