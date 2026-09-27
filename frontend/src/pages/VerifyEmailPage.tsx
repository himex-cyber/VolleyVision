import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useResendVerification } from '../hooks';
import { authApi, getApiErrorMessage, isRateLimitedError } from '../lib/api';

/**
 * Reached from the emailed verification link. Mirrors ResetPasswordPage's
 * layout and public-standalone routing. Unlike reset-password this can fire
 * while the user is already logged in, so on success it refreshes the auth
 * user (if any) so Layout's verification banner drops immediately.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refreshUser } = useAuth();

  const resend = useResendVerification();

  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [error, setError] = useState('');
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'limited' | 'error'>('idle');

  // Guard against React StrictMode's double-invoke of effects in dev, which
  // would otherwise POST the single-use token twice and show a false failure.
  const ranRef = useRef(false);

  useEffect(() => {
    if (!token || ranRef.current) return;
    ranRef.current = true;
    // A plain call, not useMutation: per-call mutate() callbacks are dropped when
    // StrictMode remounts the component, which left the page stuck on "Verifying".
    authApi.verifyEmail({ token })
      .then(async () => {
        setStatus('success');
        if (user) await refreshUser();
      })
      .catch((err: unknown) => {
        setStatus('error');
        setError(getApiErrorMessage(err, 'This verification link is invalid or has expired.'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleResend() {
    setResendStatus('idle');
    try {
      await resend.mutateAsync();
      setResendStatus('sent');
    } catch (err) {
      setResendStatus(isRateLimitedError(err) ? 'limited' : 'error');
    }
  }

  return (
    <div className="min-h-screen bg-court-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src="/vv-icon.svg" alt="" className="w-9 h-9" />
          <span className="font-display font-bold text-xl text-navy-700 tracking-tight">VolleyVision</span>
        </div>

        <div className="card p-6">
          {!token ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Link not valid</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">
                This verification link is missing its token. Request a new one below.
              </p>
              {user && (
                <button type="button" className="btn-primary w-full mt-5" onClick={handleResend} disabled={resend.isPending}>
                  {resend.isPending ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
              <p className="text-sm mt-3" aria-live="polite">
                {resendStatus === 'sent' && <span className="text-success">Sent — check your inbox.</span>}
                {resendStatus === 'limited' && <span className="text-error">Too many requests — try again later.</span>}
                {resendStatus === 'error' && <span className="text-error">Couldn't resend. Try again.</span>}
              </p>
            </>
          ) : status === 'pending' ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Verifying your email…</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">Just a moment.</p>
            </>
          ) : status === 'success' ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Email verified</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">
                You're all set — you can now join teams by invitation or join code.
              </p>
              <Link to={user ? '/dashboard' : '/login'} className="btn-primary w-full text-center mt-5 block">
                {user ? 'Go to dashboard' : 'Go to sign in'}
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Couldn't verify your email</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">{error}</p>

              {user && (
                <>
                  <button type="button" className="btn-primary w-full mt-5" onClick={handleResend} disabled={resend.isPending}>
                    {resend.isPending ? 'Sending…' : 'Resend verification email'}
                  </button>
                  <p className="text-sm mt-3" aria-live="polite">
                    {resendStatus === 'sent' && <span className="text-success">Sent — check your inbox.</span>}
                    {resendStatus === 'limited' && <span className="text-error">Too many requests — try again later.</span>}
                    {resendStatus === 'error' && <span className="text-error">Couldn't resend. Try again.</span>}
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <p className="text-center text-chalk-500 text-sm mt-4">
          <Link to="/login" className="text-navy-700 hover:text-navy-700 font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
