// The Android and iOS apps (Capacitor) run this same SPA in a WebView. The native
// bridge sets window.Capacitor before our code loads, so this needs no import.
// Never import @capacitor/* statically from code on the web entry path: the
// web build must not pull it in. Dynamic-import it inside `if (isNative())`.
import { confirmLeave } from './leaveGuard';

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const capacitor = () => (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

export const isNative = (): boolean => capacitor()?.isNativePlatform?.() === true;

/** 'android' or 'ios' in the apps, 'web' in a browser. */
export const nativePlatform = (): string => capacitor()?.getPlatform?.() ?? 'web';

/** Native-only setup, called from main.tsx inside `if (isNative())`. */
export async function initNative(): Promise<void> {
  // iPhones have no Back button (every screen has an in-app way back), and
  // swipe-back stays off: it would skip the tracker's leave guard.
  if (nativePlatform() !== 'android') return;
  // Dynamic import: the web bundle never loads @capacitor/app.
  const { App } = await import('@capacitor/app');
  // Android's back gesture/button walks the app's history, and leaves the app
  // from the first screen instead of doing nothing. The event's canGoBack is the
  // WebView's native history, which missed in-app route changes (found on the
  // emulator: Back on a team dashboard closed the app). React Router records
  // each entry's index in history.state.idx, so that's the reliable signal.
  await App.addListener('backButton', () => {
    // An open pop-up menu closes first, as Android users expect from Back.
    const openMenu = document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
    if (openMenu) {
      openMenu.click();
      return;
    }
    // The tracker asks first while taps are waiting to send (6.9).
    if (!confirmLeave()) return;
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) window.history.back();
    else void App.exitApp();
  });
}
