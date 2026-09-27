import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authApi, getApiErrorMessage } from '../lib/api';

/**
 * Step 1 of the reset flow. The confirmation is deliberately generic and shows
 * for any submitted address — mirroring the backend, which responds identically
 * whether or not an account exists, so neither layer leaks who's registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't send a reset link. Try again in a moment."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-court-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <img src="/vv-icon.svg" alt="" className="w-9 h-9" />
          <span className="font-display font-bold text-xl text-navy-700 tracking-tight">VolleyVision</span>
        </div>

        <div className="card p-6">
          {sent ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Check your inbox</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">
                If an account exists for that email, we've sent a reset link. Check your inbox.
              </p>
              <p className="text-chalk-500 text-xs mt-4 leading-relaxed">
                The link expires in 1 hour. Didn't get it? Check your spam folder, or{' '}
                <button
                  type="button"
                  className="text-navy-700 hover:text-navy-700 font-medium"
                  onClick={() => { setSent(false); setError(''); }}
                >
                  try another email
                </button>.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Forgot your password?</h1>
              <p className="text-chalk-500 text-sm mb-6">
                Enter your email and we'll send you a link to set a new one.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-error/30 border border-error text-error text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-chalk-400 text-sm font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    autoComplete="email"
                    className="input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-chalk-500 text-sm mt-4">
          Remembered it?{' '}
          <Link to="/login" className="text-navy-700 hover:text-navy-700 font-medium">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
