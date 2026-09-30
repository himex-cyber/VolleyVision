import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { profileApi, getApiErrorMessage } from '../lib/api';
import { hasQueued } from '../lib/eventQueue';
import { legalHref } from '../lib/legal';

type BlockingTeam = { id: string; name: string; reason: 'owner' | 'head_coach' };

/**
 * Profile → Delete account (9.4; Apple 5.1.1(v), Google Play). What goes and
 * what stays, the password, and a typed DELETE. The server refuses while the
 * account owns a team and lists them here.
 */
export default function DeleteAccountPage() {
  const { user, onAccountDeleted } = useAuth();
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [teams, setTeams] = useState<BlockingTeam[]>([]);
  const [deleting, setDeleting] = useState(false);
  const unsynced = user ? hasQueued(user.id) : false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setTeams([]);
    setDeleting(true);
    try {
      await profileApi.deleteAccount(password);
      onAccountDeleted(); // clears storage and reloads into /login?deleted=1
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.code === 'ACCOUNT_HAS_TEAMS') setTeams(err.response.data.teams ?? []);
      setError(getApiErrorMessage(err, "Couldn't delete your account. Check your connection and try again."));
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <Link to="/profile" className="inline-flex items-center min-h-[44px] text-sm text-navy-700 font-medium">← Back to profile</Link>
        <h1 className="font-display text-3xl text-grey-900">Delete your account</h1>
      </div>

      <div className="card p-5 space-y-3 text-sm text-grey-700">
        <p className="font-medium text-grey-900">This can't be undone.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your account, profile and sign-in are deleted.</li>
          <li>Messages you sent in team chat are erased, photos and files included. Others see "Message from a former member was removed".</li>
          <li>Your feedback, blocks and any pending invitations to your email are deleted.</li>
          <li>Stats recorded for you stay with your teams, so their totals stay right, but your name is replaced with "Former player".</li>
          <li>Invitations you sent that haven't been accepted stop working.</li>
        </ul>
        <p>
          Teams you own must be transferred or deleted first. More in the{' '}
          <a href={legalHref('privacy')} target="_blank" rel="noopener noreferrer" className="text-navy-700 font-medium underline">Privacy Policy</a>.
        </p>
      </div>

      {unsynced && (
        <div className="card p-4 text-sm bg-error/10 text-error-strong" role="alert">
          Some taps from a match haven't synced yet and will be lost. Go online and let them finish first to keep them.
        </div>
      )}

      <form onSubmit={submit} className="card p-5 space-y-4">
        <div>
          <label htmlFor="delete-password" className="block text-sm font-medium text-grey-700 mb-1">Your password</label>
          <input id="delete-password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="delete-confirm" className="block text-sm font-medium text-grey-700 mb-1">Type DELETE to confirm</label>
          <input id="delete-confirm" className="input" autoCapitalize="characters" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} required />
        </div>

        {error && (
          <div className="text-sm text-error-strong space-y-2" role="alert">
            <p>{error}</p>
            {teams.length > 0 && (
              <ul className="space-y-1">
                {teams.map((t) => (
                  <li key={t.id}>
                    <Link to={`/teams/${t.id}`} className="inline-flex items-center min-h-[44px] text-navy-700 font-medium underline">
                      {t.name}: {t.reason === 'owner' ? 'transfer or delete it' : 'ask its owner to change your role'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button type="submit" className="btn-primary w-full min-h-[44px] bg-error hover:bg-error-strong border-error" disabled={deleting || !password || typed.trim() !== 'DELETE'}>
          {deleting ? 'Deleting…' : 'Delete my account'}
        </button>
      </form>
    </div>
  );
}
