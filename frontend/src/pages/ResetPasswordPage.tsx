import { useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi, getApiErrorMessage } from '../lib/api';

/**
 * Step 2 of the reset flow, reached from the emailed link. Calls authApi
 * directly rather than going through AuthContext: unlike login/register this
 * doesn't mint a session — the user still signs in afterwards — so there's no
 * token or `user` state to centralise.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't reset your password. Request a new link and try again."));
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
          {!token ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Link not valid</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">
                This reset link is invalid. Request a new one.
              </p>
              <Link to="/forgot-password" className="btn-primary w-full text-center mt-5 block">
                Request a new link
              </Link>
            </>
          ) : done ? (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Password updated</h1>
              <p className="text-chalk-400 text-sm leading-relaxed">
                Your password has been changed. Sign in with your new password to continue.
              </p>
              <Link to="/login" className="btn-primary w-full text-center mt-5 block">
                Go to sign in
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Set a new password</h1>
              <p className="text-chalk-500 text-sm mb-6">Choose a password you haven't used before.</p>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-error/30 border border-error text-error text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-chalk-400 text-sm font-medium mb-1.5">New password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="input"
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-chalk-400 text-sm font-medium mb-1.5">Confirm password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="input"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>
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
