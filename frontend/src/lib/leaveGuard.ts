// Leaving the tracker with taps still waiting to send (6.9). The app uses
// BrowserRouter, not a data router, so react-router's useBlocker isn't
// available: the tracker registers a check here, and the links out of it (and
// Android's Back) ask first. Leaving is never blocked outright: the queue is
// kept on the device and the root flusher keeps sending it.

let guard: (() => string | null) | null = null;

/** The tracker's check: a warning while taps are waiting, else null. */
export function setLeaveGuard(fn: (() => string | null) | null): void {
  guard = fn;
}

/** For beforeunload: is anything waiting right now? */
export function leaveWarning(): string | null {
  return guard?.() ?? null;
}

/** True when it's fine to go: nothing waiting, or the user said so. */
export function confirmLeave(): boolean {
  const warning = guard?.();
  return !warning || window.confirm(warning);
}
