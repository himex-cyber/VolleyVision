import { useEffect, useState } from 'react';

/**
 * Suspense fallback for the lazily-loaded page components in main.tsx.
 *
 * Pages are code-split, so the first navigation to a route fetches its chunk.
 * On a warm connection that's a few milliseconds — showing anything at all in
 * that window reads as a flicker — so this stays blank for a beat and only then
 * says something. Matches the app's existing plain-text loading idiom
 * (see e.g. "Loading your teams…" on the Teams page) rather than introducing a
 * spinner the rest of the app doesn't use.
 */
export default function PageLoadingFallback() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="py-16 grid place-items-center" role="status" aria-live="polite">
      <p className="text-grey-600 text-sm">Loading…</p>
    </div>
  );
}
