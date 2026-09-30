import { useMemo, useState, useEffect } from 'react';
import { useProfile, useUpdateProfile, usePlayerBests, usePlayerDashboard } from '../hooks';
import type { PlayerBestEntry, Position, DevelopmentPoint } from '../types';
import { POSITION_FULL_LABELS } from '../types';
import { getApiErrorMessage } from '../lib/api';
import PlayerRadarChart from '../components/charts/PlayerRadarChart';
import TeamTrendChart from '../components/charts/TeamTrendChart';
import PlayerRecordsManager from '../components/player/PlayerRecordsManager';
import { Link } from 'react-router-dom';
import { legalHref } from '../lib/legal';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin', COACH: 'Coach', PLAYER: 'Player', VIEWER: 'Viewer',
};

const POSITIONS: Position[] = ['SETTER', 'OUTSIDE_HITTER', 'OPPOSITE', 'MIDDLE_BLOCKER', 'LIBERO', 'DEFENSIVE_SPECIALIST'];

function BestStatCard({ label, entry, format }: { label: string; entry: PlayerBestEntry | null; format?: (v: number) => string }) {
  if (!entry) return null;
  return (
    <div className="bg-grey-50 border border-grey-200 rounded-lg p-3 text-center">
      <div className="font-bold tabular-nums text-xl text-navy-700">{format ? format(entry.value) : entry.value}</div>
      <div className="text-xs text-grey-600 mt-0.5">{label}</div>
      <div className="text-xs text-grey-400 mt-1 truncate" title={`vs ${entry.opponent}`}>vs {entry.opponent}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { data: profile, isLoading } = useProfile();
  const { data: bests } = usePlayerBests();
  const { data: dashboard } = usePlayerDashboard();
  const updateProfile = useUpdateProfile();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', bio: '', phoneNumber: '', city: '', country: '',
    dateOfBirth: '', heightCm: '', weightKg: '', preferredPosition: '',
  });
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        bio: profile.bio ?? '',
        phoneNumber: profile.phoneNumber ?? '',
        city: profile.city ?? '',
        country: profile.country ?? '',
        dateOfBirth: profile.dateOfBirth ? profile.dateOfBirth.split('T')[0] : '',
        heightCm: profile.heightCm != null ? String(profile.heightCm) : '',
        weightKg: profile.weightKg != null ? String(profile.weightKg) : '',
        preferredPosition: profile.preferredPosition ?? '',
      });
    }
  }, [profile]);

  // Career skill data for the radar + a development trend, from the player dashboard.
  const careerStats = dashboard?.careerStats;
  const hasCareer = !!careerStats && careerStats.totalEvents > 0;
  const trendData = useMemo(() => {
    const metrics = [...(dashboard?.developmentMetrics ?? [])].sort(
      (a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime(),
    );
    return metrics.map((d: DevelopmentPoint) => ({
      opponent: d.opponent.length > 10 ? `${d.opponent.slice(0, 10)}…` : d.opponent,
      kills: d.kills,
    }));
  }, [dashboard?.developmentMetrics]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess(false);
    try {
      await updateProfile.mutateAsync({
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        bio: form.bio || undefined,
        phoneNumber: form.phoneNumber || undefined,
        city: form.city || undefined,
        country: form.country || undefined,
        dateOfBirth: form.dateOfBirth || null,
        heightCm: form.heightCm === '' ? null : Number(form.heightCm),
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
        preferredPosition: (form.preferredPosition || null) as Position | null,
      });
      setEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(getApiErrorMessage(err, "Couldn't save your profile. Check your connection and try again."));
    }
  }

  if (isLoading) return <p className="text-grey-600">Loading profile…</p>;
  if (!profile) return <p className="text-error">Couldn't load profile.</p>;

  const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl text-grey-900">Profile</h1>
        <p className="text-grey-600 text-sm mt-0.5">Manage your information, preferences, and linked player records</p>
      </div>

      {saveSuccess && (
        <div className="bg-success/15 border border-success/40 rounded-xl px-4 py-3 text-success-strong text-sm">
          Profile updated successfully.
        </div>
      )}

      {/* Identity card */}
      <div className="card p-6">
        <div className="flex items-center gap-5">
          {profile.profileImage ? (
            <img src={profile.profileImage} alt={`${profile.firstName} ${profile.lastName}`} className="w-16 h-16 rounded-full object-cover ring-2 ring-grey-200" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-navy-500 border-2 border-gold-500 grid place-items-center text-xl font-display font-bold text-white">
              {initials}
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold text-grey-900">{profile.firstName} {profile.lastName}</h2>
            <p className="text-grey-600 text-sm">{profile.email}</p>
            <span className="badge badge-neutral mt-1 inline-block">{ROLE_LABELS[profile.role] ?? profile.role}</span>
          </div>
        </div>

        {profile.bio && <p className="mt-4 text-grey-900 text-sm border-t border-grey-200 pt-4">{profile.bio}</p>}

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-grey-200 pt-4">
          <span className="text-grey-600">Preferred position</span>
          <span className="text-grey-900 font-medium">
            {profile.preferredPosition ? POSITION_FULL_LABELS[profile.preferredPosition] : <span className="text-grey-400 font-normal">Not set</span>}
          </span>
          {profile.phoneNumber && (<><span className="text-grey-600">Phone</span><span className="text-grey-900">{profile.phoneNumber}</span></>)}
          {(profile.city || profile.country) && (
            <><span className="text-grey-600">Location</span><span className="text-grey-900">{[profile.city, profile.country].filter(Boolean).join(', ')}</span></>
          )}
          {profile.dateOfBirth && (<><span className="text-grey-600">Date of Birth</span><span className="text-grey-900">{new Date(profile.dateOfBirth).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span></>)}
          {profile.heightCm != null && (<><span className="text-grey-600">Height</span><span className="text-grey-900">{profile.heightCm} cm</span></>)}
          {profile.weightKg != null && (<><span className="text-grey-600">Weight</span><span className="text-grey-900">{profile.weightKg} kg</span></>)}
          <span className="text-grey-600">Member since</span>
          <span className="text-grey-900">{new Date(profile.createdAt).toLocaleDateString()}</span>
        </div>

        <button className="btn-secondary text-sm mt-4" onClick={() => setEditing(!editing)}>
          {editing ? 'Cancel' : 'Edit Profile'}
        </button>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="card p-6">
          <h2 className="font-display font-semibold text-grey-900 mb-4">Edit Profile</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-grey-600 mb-1">First Name</label>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">Last Name</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="block text-xs text-grey-600 mb-1">Preferred position</label>
              <select className="input" value={form.preferredPosition} onChange={(e) => setForm({ ...form, preferredPosition: e.target.value })}>
                <option value="">No preference</option>
                {POSITIONS.map((p) => <option key={p} value={p}>{POSITION_FULL_LABELS[p]}</option>)}
              </select>
              <p className="text-xs text-grey-400 mt-1">Your own preference — separate from the position a coach assigns you on a roster.</p>
            </div>

            <div>
              <label className="block text-xs text-grey-600 mb-1">Bio</label>
              <textarea className="input min-h-[80px] resize-y" value={form.bio} placeholder="Tell your team about yourself…" onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-grey-600 mb-1">Phone Number</label>
                <input className="input" type="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">Date of Birth</label>
                <input className="input" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">City</label>
                <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">Country</label>
                <input className="input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">Height (cm)</label>
                <input className="input" type="number" min={100} max={250} placeholder="e.g. 185" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-grey-600 mb-1">Weight (kg)</label>
                <input className="input" type="number" min={30} max={200} placeholder="e.g. 78" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} />
              </div>
            </div>

            {saveError && <p className="text-error text-sm">{saveError}</p>}

            <button type="submit" className="btn-primary" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>
      )}

      {/* Career snapshot — complements (doesn't duplicate) the Player Dashboard */}
      {hasCareer && careerStats && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PlayerRadarChart stats={careerStats} />
          {trendData.length >= 2 ? (
            <TeamTrendChart title="Kills per match" data={trendData} dataKey="kills" />
          ) : (
            <div className="card p-6 grid place-items-center text-sm text-grey-600 min-h-[220px]">
              Play more matches to see your development trend.
            </div>
          )}
        </div>
      )}

      {/* Top game stats */}
      {bests && (bests.kills || bests.aces || bests.blocks || bests.digs || bests.hittingPercentage) && (
        <div className="card p-6">
          <h2 className="font-display font-semibold text-grey-900 mb-1">Top game stats</h2>
          <p className="text-grey-600 text-xs mb-4">Career-best single-match performances</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <BestStatCard label="Kills" entry={bests.kills} />
            <BestStatCard label="Aces" entry={bests.aces} />
            <BestStatCard label="Blocks" entry={bests.blocks} format={(v) => v.toFixed(1)} />
            <BestStatCard label="Digs" entry={bests.digs} />
            <BestStatCard label="Hitting %" entry={bests.hittingPercentage} format={(v) => v.toFixed(3)} />
          </div>
        </div>
      )}

      {/* Linked player records (moved here from the Player Dashboard) */}
      <PlayerRecordsManager />

      {/* Account (9.2/9.4): the legal pages and account deletion */}
      <div className="card p-5">
        <h2 className="font-display text-xl text-grey-900 mb-2">Account</h2>
        <div className="flex flex-wrap gap-x-5">
          <a href={legalHref('privacy')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] text-sm text-navy-700 font-medium">Privacy Policy</a>
          <a href={legalHref('terms')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] text-sm text-navy-700 font-medium">Terms</a>
          <a href={legalHref('support')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] text-sm text-navy-700 font-medium">Support</a>
        </div>
        <Link to="/profile/delete-account" className="inline-flex items-center min-h-[44px] text-sm text-error-strong font-medium">Delete account</Link>
      </div>
    </div>
  );
}
