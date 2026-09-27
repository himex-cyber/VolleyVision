/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL; defaults to '/api/v1' (Vite dev proxy) when unset. */
  readonly VITE_API_URL?: string;
  /** Sentry DSN; unset disables error tracking (normal in local dev). */
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
