// localStorage throws in some browsers (private mode, blocked site data, a
// full quota), and the offline queue must never crash a tap because of it.
// Every call is guarded; callers fall back to memory when storageWorks() is
// false. tokenStorage.ts deliberately stays as it is.

let works: boolean | null = null;

export function storageWorks(): boolean {
  if (works === null) {
    try {
      localStorage.setItem('vv_probe', '1');
      localStorage.removeItem('vv_probe');
      works = true;
    } catch {
      works = false;
    }
  }
  return works;
}

export function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** False when the write failed (blocked or full). */
export function storageSet(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function storageRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* nothing to remove */ }
}

export function storageKeys(prefix: string): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}
