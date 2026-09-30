// localStorage throws in some browsers (private mode, blocked site data, a
// full quota), and the offline queue must never crash a tap because of it.
// Every call is guarded; callers fall back to memory when storageWorks() is
// false. In the apps, native Preferences once hydrated (9.8, nativeStorage.ts).

import { nativeStore } from './nativeStorage';

let works: boolean | null = null;

export function storageWorks(): boolean {
  if (nativeStore()) return true;
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
  const native = nativeStore();
  if (native) return native.get(key);
  try { return localStorage.getItem(key); } catch { return null; }
}

/** False when the write failed (blocked or full). */
export function storageSet(key: string, value: string): boolean {
  const native = nativeStore();
  if (native) { native.set(key, value); return true; }
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function storageRemove(key: string): void {
  const native = nativeStore();
  if (native) { native.remove(key); return; }
  try { localStorage.removeItem(key); } catch { /* nothing to remove */ }
}

export function storageKeys(prefix: string): string[] {
  const native = nativeStore();
  if (native) return native.keys(prefix);
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}
