import { useState, FormEvent } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../lib/api';
import LegalLinks from '../components/legal/LegalLinks';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Just deleted their account (9.4, DeleteAccountPage).
  const deleted = new URLSearchParams(useLocation().search).has('deleted');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't sign you in. Check your email and password, then try again."));
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

        {/* Hero — the one place uppercase display type is allowed */}
        <div className="text-center mb-6">
          <p className="font-display font-bold text-2xl text-navy-700 uppercase tracking-wide leading-tight">
            See the game.<br />Raise your game.
          </p>
          <p className="text-chalk-400 text-sm mt-1.5">Track every touch.</p>
        </div>

        <div className="card p-6">
          <h1 className="text-lg font-semibold text-chalk-100 mb-1">Welcome back</h1>
          <p className="text-chalk-500 text-sm mb-6">Sign in to your account</p>

          {deleted && !error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-success/10 text-success-strong text-sm" role="status">
              Your account has been deleted. Thanks for using VolleyVision.
            </div>
          )}
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
            <div>
              <label className="block text-chalk-400 text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-chalk-500 text-sm mt-4">
            <Link to="/forgot-password" className="text-navy-700 hover:text-navy-700 font-medium">
              Forgot password?
            </Link>
          </p>
        </div>

        <p className="text-center text-chalk-500 text-sm mt-4">
          Don't have an account?{' '}
          <Link to="/register" className="text-navy-700 hover:text-navy-700 font-medium">
            Create one
          </Link>
        </p>
        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}
