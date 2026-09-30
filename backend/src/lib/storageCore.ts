// Native key-value storage for the apps (9.8): the token and the offline queue
// in Capacitor Preferences (UserDefaults / SharedPreferences), because iOS can
// reclaim WKWebView localStorage under storage pressure. The app reads storage
// synchronously, so this keeps an in-memory copy, loaded before render, and
// writes through to Preferences in call order. Pure: tested here, copied to
// frontend/src/lib/storageCore.ts (the test fails if the copy drifts).

export interface KeyValue {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  keys(): Promise<{ keys: string[] }>;
}

/** localStorage, as far as the first-run migration needs it. */
export interface LegacyStore {
  keys(): string[];
  get(key: string): string | null;
  remove(key: string): void;
}

const OWN = (key: string) => key.startsWith('vv_') && key !== 'vv_probe';

export function createNativeStore(prefs: KeyValue) {
  const memory = new Map<string, string>();
  let chain: Promise<void> = Promise.resolve();
  // ponytail: writes land a moment later; an app killed within that moment can
  // lose the last tap. flush() on pause and before sign-out narrows it.
  const enqueue = (write: () => Promise<void>) => {
    chain = chain.then(write).catch(() => undefined);
  };

  return {
    /**
     * Loads every app key into memory. With `legacy`, first copies the app's
     * old localStorage values into Preferences, waiting for every write, and
     * only then removes them there, so an update never loses the token or
     * queued taps. False if that copy failed (localStorage is left as it was).
     */
    async hydrate(legacy?: LegacyStore): Promise<boolean> {
      if (legacy) {
        const old = legacy.keys().filter(OWN);
        try {
          for (const key of old) {
            const value = legacy.get(key);
            if (value != null) await prefs.set({ key, value });
          }
        } catch {
          return false;
        }
        for (const key of old) legacy.remove(key);
      }
      const { keys } = await prefs.keys();
      for (const key of keys.filter(OWN)) {
        const { value } = await prefs.get({ key });
        if (value != null) memory.set(key, value);
      }
      return true;
    },
    get: (key: string): string | null => memory.get(key) ?? null,
    set(key: string, value: string): void {
      memory.set(key, value);
      enqueue(() => prefs.set({ key, value }));
    },
    remove(key: string): void {
      memory.delete(key);
      enqueue(() => prefs.remove({ key }));
    },
    keys: (prefix: string): string[] => [...memory.keys()].filter((k) => k.startsWith(prefix)),
    /** Waits for every write so far. */
    flush: (): Promise<void> => chain,
  };
}

export type NativeStore = ReturnType<typeof createNativeStore>;
