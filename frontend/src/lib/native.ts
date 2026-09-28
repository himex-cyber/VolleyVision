// The Android app (Capacitor) runs this same SPA in a WebView. The native
// bridge sets window.Capacitor before our code loads, so this needs no import.
// Never import @capacitor/* statically from code on the web entry path: the
// web build must not pull it in. Dynamic-import it inside `if (isNative())`.
export const isNative = (): boolean =>
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

/** Native-only setup, called from main.tsx inside `if (isNative())`. */
export async function initNative(): Promise<void> {
  // Dynamic import: the web bundle never loads @capacitor/app.
  const { App } = await import('@capacitor/app');
  // Android's back gesture/button walks the app's history, and leaves the app
  // from the first screen instead of doing nothing. The event's canGoBack is the
  // WebView's native history, which missed in-app route changes (found on the
  // emulator: Back on a team dashboard closed the app). React Router records
  // each entry's index in history.state.idx, so that's the reliable signal.
  await App.addListener('backButton', () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) window.history.back();
    else void App.exitApp();
  });
}
