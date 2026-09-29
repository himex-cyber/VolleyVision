import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { flushAll, hasQueued, setOnSynced } from '../../lib/eventQueue';
import { invalidateMatchData } from '../../hooks';
import { isNative } from '../../lib/native';

const TIMER_MS = 15_000;

/**
 * Sends queued taps from anywhere in the app, not just the tracker (6.6a):
 * the 401 redirect reloads the whole page, and a tracker who reopens the app
 * on another screen still has taps waiting. Mounted once, at the root.
 */
export default function QueueFlusher() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id;

  useEffect(() => {
    setOnSynced((matchId) => invalidateMatchData(qc, matchId));
    return () => setOnSynced(null);
  }, [qc]);

  useEffect(() => {
    if (!userId) return;
    const flush = () => { void flushAll(userId); };
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };

    flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (hasQueued(userId)) flush(); }, TIMER_MS);

    // The app coming back to the foreground. Dynamic import, as in
    // lib/native.ts: the web bundle never loads @capacitor/app.
    let removeResume: (() => void) | undefined;
    let cancelled = false;
    if (isNative()) {
      import('@capacitor/app')
        .then(({ App }) => App.addListener('resume', flush))
        .then((handle) => {
          if (cancelled) void handle.remove();
          else removeResume = () => { void handle.remove(); };
        })
        .catch(() => { /* the timer and 'online' still flush */ });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      removeResume?.();
    };
  }, [userId]);

  return null;
}
