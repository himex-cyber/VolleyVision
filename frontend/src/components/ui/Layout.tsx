import { Suspense, useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useViewMode } from '../../context/ViewModeContext';
import { useMyInvitations } from '../../hooks';
import { features } from '../../config/features';
import {
  GridIcon, TeamIcon, SparkIcon, MailIcon, UserIcon,
  BellIcon, ChevronIcon, MenuIcon, LogoutIcon, FeedbackIcon,
} from './icons';
import PageLoadingFallback from './PageLoadingFallback';

/**
 * Page components are code-split (see main.tsx), so the routed child suspends
 * while its chunk downloads. Boundary sits here, inside the chrome, so the top
 * nav stays mounted instead of the whole shell blanking on first navigation.
 */
function SuspendedOutlet() {
  return (
    <Suspense fallback={<PageLoadingFallback />}>
      <Outlet />
    </Suspense>
  );
}

type NavItem = {
  to: string;
  label: string;
  icon: (p: { className?: string }) => JSX.Element;
  /** Renders the pending-invitation count as a badge on this item. */
  badge?: boolean;
};

const NAV_AUTH: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: GridIcon },
  { to: '/teams', label: 'Teams', icon: TeamIcon },
  ...(features.leagues ? [{ to: '/leagues', label: 'League Hub', icon: SparkIcon }] : []),
  { to: '/invitations', label: 'Invitations', icon: MailIcon, badge: true },
  { to: '/profile', label: 'Profile', icon: UserIcon },
];

function BrandMark({ className = 'w-7 h-7' }: { className?: string }) {
  return <img src="/vv-icon.svg" alt="" className={className} />;
}

function Initials({ user, size = 'md' }: { user: { firstName: string; lastName: string }; size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'w-[30px] h-[30px] text-[12px]' : 'w-9 h-9 text-sm';
  return (
    <span
      className={`${dims} shrink-0 rounded-full bg-navy-500 border-2 border-gold-500
                  grid place-items-center font-display font-bold text-white`}
    >
      {user.firstName[0]}{user.lastName[0]}
    </span>
  );
}

/** Nav pill: active = navy-100 tint + navy text, per the mockup. */
function navPillClass(isActive: boolean) {
  return [
    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13.5px] transition-colors',
    isActive ? 'bg-navy-100 text-navy-700 font-semibold' : 'text-grey-600 font-medium hover:text-navy-700 hover:bg-grey-50',
  ].join(' ');
}

function ViewModeToggle() {
  const { viewMode, setViewMode, isDual } = useViewMode();
  if (!isDual) return null;

  const base = 'px-3 py-1 text-xs font-semibold rounded-md transition-colors';
  return (
    <div className="flex items-center gap-0.5 p-[3px] rounded-lg bg-grey-50 border border-grey-200">
      <button
        type="button"
        onClick={() => setViewMode('coach')}
        className={viewMode === 'coach' ? `${base} bg-navy-700 text-white` : `${base} text-grey-600 hover:text-navy-700`}
      >
        Coach
      </button>
      <button
        type="button"
        onClick={() => setViewMode('player')}
        className={viewMode === 'player' ? `${base} bg-navy-700 text-white` : `${base} text-grey-600 hover:text-navy-700`}
      >
        Player
      </button>
    </div>
  );
}

/** A dropdown that closes when its full-screen backdrop is clicked. */
function Dropdown({ open, onClose, children, className = '' }: {
  open: boolean; onClose: () => void; children: React.ReactNode; className?: string;
}) {
  if (!open) return null;
  return (
    <>
      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div className={`absolute z-50 mt-2 rounded-xl bg-white border border-grey-200 shadow-lg overflow-hidden ${className}`}>
        {children}
      </div>
    </>
  );
}

/** Overflow menu for the nav items below the pill breakpoint. */
function NavOverflow({ pendingCount }: { pendingCount: number }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        className="w-10 h-10 rounded-xl bg-white border border-grey-200 grid place-items-center text-grey-600 hover:text-navy-700 transition-colors"
      >
        <MenuIcon className="w-5 h-5" />
      </button>
      <Dropdown open={open} onClose={() => setOpen(false)} className="left-0 w-52 py-1.5">
        {NAV_AUTH.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'text-navy-700 bg-navy-100' : 'text-grey-700 hover:bg-grey-50'
              }`}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            {label}
            {badge && pendingCount > 0 && (
              <span className="ml-auto badge bg-gold-500 text-navy-900">{pendingCount}</span>
            )}
          </NavLink>
        ))}
      </Dropdown>
    </div>
  );
}

/** Avatar chip that opens a Profile / Sign out dropdown. */
function AvatarMenu({ user, onSignOut }: {
  user: { firstName: string; lastName: string }; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 pl-[5px] pr-2.5 py-[5px] rounded-xl bg-grey-50 border border-grey-200 hover:bg-grey-200/60 transition-colors"
      >
        <Initials user={user} size="sm" />
        <span className="hidden sm:block text-[13px] font-semibold text-grey-900 max-w-[120px] truncate">
          {user.firstName} {user.lastName}
        </span>
        <ChevronIcon className={`hidden sm:block w-4 h-4 text-grey-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Dropdown open={open} onClose={() => setOpen(false)} className="right-0 w-44 py-1.5">
        <Link to="/profile" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-700 hover:bg-grey-50 transition-colors">
          <UserIcon className="w-4 h-4" /> Profile
        </Link>
        <Link to="/feedback" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-700 hover:bg-grey-50 transition-colors">
          <FeedbackIcon className="w-4 h-4" /> Feedback
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-700 hover:text-error hover:bg-grey-50 transition-colors"
        >
          <LogoutIcon className="w-4 h-4" /> Sign out
        </button>
      </Dropdown>
    </div>
  );
}

/** Logged-out chrome: same top-nav visual language, no app nav. */
function PublicShell() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-white border-b border-grey-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-display font-bold text-lg tracking-tight text-navy-700">VolleyVision</span>
          </Link>
          <div className="flex items-center gap-2">
            <NavLink to="/teams" className={({ isActive }) => navPillClass(isActive)}>Teams</NavLink>
            <NavLink to="/login" className={({ isActive }) => navPillClass(isActive)}>Sign in</NavLink>
            <NavLink to="/register" className="btn-primary text-sm px-4 py-2">Register</NavLink>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        <SuspendedOutlet />
      </main>
    </div>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { data: invitations } = useMyInvitations();

  const isTracking = location.pathname.startsWith('/track/');

  // The tracking screen is chrome-free and tablet-optimised — never wrapped.
  if (isTracking) return <SuspendedOutlet />;
  if (!user) return <PublicShell />;

  const pendingCount = invitations?.length ?? 0;

  function handleSignOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-grey-50">
      {/* Top nav — single row, sticky */}
      <header className="sticky top-0 z-30 bg-white border-b border-grey-200">
        <div className="h-[60px] px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Left: brand + nav */}
          <div className="flex items-center gap-5 min-w-0">
            <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0">
              <BrandMark />
              <span className="font-display font-bold text-lg tracking-tight text-navy-700 hidden sm:block">
                VolleyVision
              </span>
            </Link>
            <nav className="hidden lg:flex items-center gap-0.5">
              {NAV_AUTH.map(({ to, label, icon: Icon, badge }) => (
                <NavLink key={to} to={to} className={({ isActive }) => navPillClass(isActive)}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                  {badge && pendingCount > 0 && (
                    <span className="badge bg-gold-500 text-navy-900 ml-0.5">{pendingCount}</span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Right: view toggle + bell + avatar; overflow menu on small screens */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:block"><ViewModeToggle /></div>

            <Link
              to="/invitations"
              aria-label={pendingCount > 0 ? `Invitations (${pendingCount} pending)` : 'Invitations'}
              className="relative w-10 h-10 rounded-xl bg-white border border-grey-200 grid place-items-center text-grey-600 hover:text-navy-700 transition-colors"
            >
              <BellIcon className="w-[18px] h-[18px]" />
              {pendingCount > 0 && (
                <span className="absolute top-2 right-2.5 w-[7px] h-[7px] rounded-full bg-gold-500 border-[1.5px] border-white" />
              )}
            </Link>

            <AvatarMenu user={user} onSignOut={handleSignOut} />
            <NavOverflow pendingCount={pendingCount} />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6">
        <SuspendedOutlet />
      </main>
    </div>
  );
}
