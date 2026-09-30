import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { SignupIntent } from '../types';
import { getApiErrorMessage } from '../lib/api';
import TermsConsent from '../components/legal/TermsConsent';
import clsx from 'clsx';

// ── Onboarding redirect — isolated so it's obvious this is a one-time nudge,
// never part of permission or auth logic. Call only immediately after registration.
function onboardingPath(intent: SignupIntent | null): string {
  if (intent === 'COACH')  return '/onboarding/coach';
  if (intent === 'PLAYER') return '/onboarding/player';
  return '/teams'; // UNSURE or null → existing default
}

interface IntentOption {
  value: SignupIntent;
  label: string;
  description: string;
}

const INTENT_OPTIONS: IntentOption[] = [
  { value: 'COACH',  label: 'Coach a team',      description: "I'll be running a team" },
  { value: 'PLAYER', label: 'Play for a team',    description: "I'll be joining a team" },
  { value: 'UNSURE', label: "Not sure yet",       description: "I'll figure it out later" },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [intent, setIntent]       = useState<SignupIntent | null>(null);
  const [agreed, setAgreed]       = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

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
      await register({ email, password, firstName, lastName, signupIntent: intent });
      navigate(onboardingPath(intent), { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't create your account. Check your details and try again."));
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
          <h1 className="text-lg font-semibold text-chalk-100 mb-1">Create account</h1>
          <p className="text-chalk-500 text-sm mb-6">Start tracking your team's performance</p>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-error/30 border border-error text-error text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-chalk-400 text-sm font-medium mb-1.5">First name</label>
                <input
                  type="text"
                  autoComplete="given-name"
                  className="input"
                  placeholder="Alex"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-chalk-400 text-sm font-medium mb-1.5">Last name</label>
                <input
                  type="text"
                  autoComplete="family-name"
                  className="input"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                />
              </div>
            </div>

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

            {/* ── Sign-up intent picker ── */}
            <div>
              <label className="block text-chalk-400 text-sm font-medium mb-2">I'm signing up to…</label>
              <p className="text-grey-600 text-xs mb-2">
                This just tailors your welcome. You can create or join teams either way.
              </p>
              <div className="space-y-2">
                {INTENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setIntent(intent === opt.value ? null : opt.value)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors',
                      intent === opt.value
                        ? 'bg-spike-500/15 border-spike-500/50 text-chalk-100'
                        : 'bg-court-800 border-court-700 text-chalk-300 hover:border-court-600'
                    )}
                  >
                    <span
                      className={clsx(
                        'w-4 h-4 rounded-full border-2 shrink-0 transition-colors',
                        intent === opt.value
                          ? 'border-spike-400 bg-spike-400'
                          : 'border-court-600'
                      )}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium leading-tight">{opt.label}</span>
                      <span className="block text-xs text-chalk-500 mt-0.5">{opt.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <TermsConsent checked={agreed} onChange={setAgreed} />

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading || !agreed}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-chalk-500 text-sm mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-navy-700 hover:text-navy-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
