import { useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import JoinByCodeCard from '../components/team/JoinByCodeCard';
import { getApiErrorMessage } from '../lib/api';

/**
 * Public entry point for the join-code flow (Stabilization Pass 2).
 * Works for brand-new / logged-out users: they authenticate here (sign in or
 * create an account), then enter their code in the shared JoinByCodeCard —
 * which handles both personal email invitations and reusable team codes,
 * identically to the in-app Invitations page.
 */
export default function RedeemInvitationPage() {
  const [params] = useSearchParams();
  const { user, login, register } = useAuth();

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Logged out — authenticate first; once `user` is set the join card renders.
  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (authMode === 'login') {
        await login(email, password);
      } else {
        if (password.length < 8) { setError('Password must be at least 8 characters.'); setBusy(false); return; }
        await register({ email, password, firstName, lastName });
      }
    } catch (err) {
      setError(getApiErrorMessage(err, authMode === 'login'
        ? "Couldn't sign you in. Check your email and password, then try again."
        : "Couldn't create your account. Check your details and try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-grey-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-6">
          <img src="/vv-icon.svg" alt="" className="w-9 h-9" />
          <span className="font-display font-bold text-xl text-navy-700 tracking-tight">VolleyVision</span>
        </div>

        {user ? (
          <div className="space-y-3">
            <div className="card p-6 pb-2">
              <h1 className="text-lg font-semibold text-chalk-100 mb-1">Join a team</h1>
              <p className="text-chalk-500 text-sm">Enter your join code to join your team.</p>
            </div>
            <JoinByCodeCard initialCode={params.get('code') ?? ''} />
          </div>
        ) : (
          <div className="card p-6">
            <h1 className="text-lg font-semibold text-chalk-100 mb-1">Join a team</h1>
            <p className="text-chalk-500 text-sm mb-5">Sign in or create an account, then enter your join code.</p>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-xl bg-error/30 border border-error text-error text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-1 mb-4 p-1 rounded-xl bg-navy-700">
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className={`flex-1 text-sm py-1.5 rounded-lg transition-colors ${authMode === 'login' ? 'bg-navy-500 text-chalk-100' : 'text-chalk-400'}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('register')}
                className={`flex-1 text-sm py-1.5 rounded-lg transition-colors ${authMode === 'register' ? 'bg-navy-500 text-chalk-100' : 'text-chalk-400'}`}
              >
                Create account
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-3">
              {authMode === 'register' && (
                <div className="grid grid-cols-2 gap-3">
                  <input className="input" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  <input className="input" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              )}
              <input className="input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="input" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <p className="text-chalk-600 text-xs">If your invitation came by email, use the address it was sent to.</p>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? 'Signing in…' : authMode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-chalk-500 text-sm mt-4">
          <Link to="/login" className="text-navy-700 hover:text-navy-700 font-medium">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
