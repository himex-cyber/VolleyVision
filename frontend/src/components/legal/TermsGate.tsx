import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { profileApi, getApiErrorMessage } from '../../lib/api';
import TermsConsent from './TermsConsent';

/**
 * One screen after sign-in for accounts that haven't accepted the current
 * Terms (9.3): accounts from before v9.17.0, or after the Terms change. Posting
 * in team chat needs it (the server enforces it); signing out stays possible.
 */
export default function TermsGate() {
  const { user, refreshUser, logout } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setSaving(true);
    setError('');
    try {
      await profileApi.acceptTerms();
      await refreshUser();
    } catch (err) {
      setError(getApiErrorMessage(err, "Couldn't save that. Check your connection and try again."));
      setSaving(false);
    }
  }

  return (
    <div className="flex justify-center px-4 py-8">
      <div className="card p-6 w-full max-w-md space-y-4">
        <h1 className="font-display text-2xl text-grey-900">Before you carry on</h1>
        <p className="text-grey-700 text-sm">
          Hi {user?.firstName}. VolleyVision now has Terms and a Privacy Policy. Please read them and confirm below to
          keep using the app, including team chat.
        </p>
        <TermsConsent checked={agreed} onChange={setAgreed} />
        {error && <p className="text-sm text-error-strong" role="alert">{error}</p>}
        <button type="button" className="btn-primary w-full min-h-[44px]" disabled={!agreed || saving} onClick={accept}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" className="btn-secondary w-full min-h-[44px]" onClick={logout}>
          Sign out
        </button>
        <p className="text-sm text-grey-600 text-center">
          Don't agree? <Link to="/profile/delete-account" className="inline-flex items-center min-h-[44px] text-navy-700 font-medium underline">Delete your account</Link>
        </p>
      </div>
    </div>
  );
}
