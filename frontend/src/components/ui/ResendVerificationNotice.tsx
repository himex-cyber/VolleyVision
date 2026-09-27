import { useState } from 'react';
import { useResendVerification } from '../../hooks';
import { isRateLimitedError } from '../../lib/api';

/** Shown in place of a generic failure message wherever joining a team can
 *  403 with EMAIL_NOT_VERIFIED (redeem invitation, join code, claim player). */
export default function ResendVerificationNotice() {
  const resend = useResendVerification();
  const [status, setStatus] = useState<'idle' | 'sent' | 'limited' | 'error'>('idle');

  async function handleResend() {
    setStatus('idle');
    try {
      await resend.mutateAsync();
      setStatus('sent');
    } catch (err) {
      setStatus(isRateLimitedError(err) ? 'limited' : 'error');
    }
  }

  return (
    <div className="text-xs space-y-1.5">
      <p className="text-error">Verify your email first — check your inbox for the link.</p>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={handleResend} disabled={resend.isPending}>
          {resend.isPending ? 'Sending…' : 'Resend email'}
        </button>
        <span aria-live="polite">
          {status === 'sent' && <span className="text-success">Sent — check your inbox.</span>}
          {status === 'limited' && <span className="text-error">Too many requests — try again later.</span>}
          {status === 'error' && <span className="text-error">Couldn't resend. Try again.</span>}
        </span>
      </div>
    </div>
  );
}
