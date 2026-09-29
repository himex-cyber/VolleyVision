import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { isNative } from '../../lib/native';
import { setPrinting } from '../../lib/printing';

// The dashboards' own data. Unrelated background fetches (chat, a focus
// refetch of the team) mustn't disable the button or swallow a click.
const DASHBOARD = { queryKey: ['analytics'] };

/**
 * "Print / Save PDF" (8.7). Web only: Android's WebView ignores
 * window.print(). Disabled until everything on the page has loaded, or the
 * PDF would hold loading placeholders: no query in flight, and the lazy
 * panels' chunks in (useIsFetching alone is 0 while a chunk still loads
 * behind Suspense). `title` becomes the PDF's file name.
 */
export default function PrintButton({ title, chunks }: { title: string; chunks?: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching(DASHBOARD);
  const [chunksReady, setChunksReady] = useState(!chunks);

  useEffect(() => {
    let live = true;
    chunks?.().then(() => { if (live) setChunksReady(true); }, () => {});
    return () => { live = false; };
  }, [chunks]);

  if (isNative()) return null;

  function print() {
    if (queryClient.isFetching(DASHBOARD) > 0) return;
    const previous = document.title;
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      document.title = previous;
      setPrinting(false);
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    document.title = title;
    setPrinting(true);
    // Two frames: one for React to re-render the charts at print width, one
    // for the browser to lay them out before the print snapshot.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      // Chrome and Firefox block in print() and have fired afterprint by now;
      // this only matters where it never fires, so charts don't stay at print
      // width on screen.
      setTimeout(restore, 0);
    }));
  }

  const ready = chunksReady && fetching === 0;
  return (
    <button
      type="button"
      onClick={print}
      disabled={!ready}
      title={ready ? undefined : 'Available once everything has loaded'}
      className="btn-secondary min-h-[44px] text-sm disabled:opacity-50 disabled:cursor-not-allowed print:hidden"
    >
      Print / Save PDF
    </button>
  );
}
