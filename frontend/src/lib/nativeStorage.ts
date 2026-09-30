// The apps keep the token and offline taps in native Preferences (9.8): iOS can
// reclaim WKWebView localStorage under storage pressure, which would sign the
// user out and lose queued taps. safeStorage.ts and tokenStorage.ts read
// through this once it's hydrated; the web keeps localStorage exactly as before.
import { isNative } from './native';
import { createNativeStore, type NativeStore } from './storageCore';

let store: NativeStore | null = null;

/** The hydrated native store, or null: the web, or Preferences unavailable (localStorage then). */
export const nativeStore = (): NativeStore | null => store;

/**
 * Called once before the first render (main.tsx): nothing may read storage
 * before it. On first run after the update, the app's localStorage values move
 * into Preferences first (the migration waits for every write).
 */
export async function hydrateStorage(): Promise<void> {
  if (!isNative()) return;
  try {
    // Dynamic imports: the web bundle never loads @capacitor/* (native.ts).
    const { Preferences } = await import('@capacitor/preferences');
    const candidate = createNativeStore(Preferences);
    const legacy = {
      keys: () => Object.keys(localStorage),
      get: (k: string) => localStorage.getItem(k),
      remove: (k: string) => localStorage.removeItem(k),
    };
    if (!(await candidate.hydrate(legacy))) return; // migration failed: keep localStorage, nothing lost
    store = candidate;
    // Going to the background may be followed by a kill: let pending writes land.
    const { App } = await import('@capacitor/app');
    await App.addListener('pause', () => { void candidate.flush(); });
  } catch {
    // Preferences unavailable: localStorage, as before this change.
  }
}

/** Waits for pending native writes (sign-out, pause); nothing to wait for on the web. */
export const flushStorage = (): Promise<void> => store?.flush() ?? Promise.resolve();
