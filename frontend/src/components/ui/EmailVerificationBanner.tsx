import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useResendVerification } from '../../hooks';

const DISMISS_KEY = 'vv_verify_banner_dismissed';

/** Dismissal is per browser session only — a real fix (verifying) is the only
 *  way to make it go away for good; refreshing the tab brings it back. */
export default function EmailVerificationBanner() {
  const { user, refreshUser } = useAuth();
  const resend = useResendVerification();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');
  const [status, setStatus] = useState<'idle' | 'sent' | 'limited' | 'error'>('idle');

  if (!user || user.emailVerified !== false || dismissed) return null;

  async function handleResend() {
    setStatus('idle');
    try {
      const res = await resend.mutateAsync();
      if (res && typeof res === 'object' && res.verified) {
        // Already verified server-side (e.g. verified in another tab) — refresh
        // so the banner drops instead of claiming to have sent an email.
        await refreshUser();
      } else {
        setStatus('sent');
      }
    } catch (err: any) {
      setStatus(err?.response?.status === 429 ? 'limited' : 'error');
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="bg-gold-500/10 border-b border-gold-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap text-sm">
      <p className="text-grey-900">Verify your email to join teams — check your inbox.</p>

      <div className="flex items-center gap-3 shrink-0">
        <span aria-live="polite" className="text-xs">
          {status === 'sent' && <span className="text-success">Sent — check your inbox.</span>}
          {status === 'limited' && <span className="text-error">Too many requests — try again later.</span>}
          {status === 'error' && <span className="text-error">Couldn't resend. Try again.</span>}
        </span>
        <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={handleResend} disabled={resend.isPending}>
          {resend.isPending ? 'Sending…' : 'Resend email'}
        </button>
        <button type="button" aria-label="Dismiss verification reminder" className="text-grey-500 hover:text-grey-900" onClick={dismiss}>
          ✕
        </button>
      </div>
    </div>
  );
}
