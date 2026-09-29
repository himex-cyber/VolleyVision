// Print / Save PDF (8.7, web only). Recharts' ResponsiveContainer measures its
// box with a ResizeObserver, which doesn't reliably fire for the print layout,
// so while printing every chart is drawn at a fixed width instead. ~680 px is
// A4 portrait inside 12 mm margins.
import { useSyncExternalStore } from 'react';

export const PRINT_CHART_WIDTH = 680;

let printing = false;
const listeners = new Set<() => void>();

export function setPrinting(value: boolean): void {
  printing = value;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The width to hand ResponsiveContainer: its usual 100%, or the print width. */
export function useChartWidth(): number | '100%' {
  return useSyncExternalStore(subscribe, () => printing) ? PRINT_CHART_WIDTH : '100%';
}

/** For a one-line "which tab is printed" note on tabbed cards. */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, () => printing);
}
