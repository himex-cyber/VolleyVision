import { Suspense, useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useMyInvitations } from '../../hooks';
import {
  GridIcon, TeamIcon, MailIcon, UserIcon,
  BellIcon, ChevronIcon, MenuIcon, LogoutIcon, FeedbackIcon,
} from './icons';
import PageLoadingFallback from './PageLoadingFallback';
import EmailVerificationBanner from './EmailVerificationBanner';

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
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-11 h-11 rounded-xl bg-white border border-grey-200 grid place-items-center text-grey-600 hover:text-navy-700 transition-colors"
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
                isActive ? 'text-navy-700 bg-navy-100' : 'text-grey-900 hover:bg-grey-50'
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
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 pl-[5px] pr-2.5 py-[5px] min-h-[44px] rounded-xl bg-grey-50 border border-grey-200 hover:bg-grey-200/60 transition-colors"
      >
        <Initials user={user} size="sm" />
        <span className="hidden sm:block text-[13px] font-semibold text-grey-900 max-w-[120px] truncate">
          {user.firstName} {user.lastName}
        </span>
        <ChevronIcon className={`hidden sm:block w-4 h-4 text-grey-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Dropdown open={open} onClose={() => setOpen(false)} className="right-0 w-44 py-1.5">
        <Link to="/profile" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-900 hover:bg-grey-50 transition-colors">
          <UserIcon className="w-4 h-4" /> Profile
        </Link>
        <Link to="/feedback" className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-900 hover:bg-grey-50 transition-colors">
          <FeedbackIcon className="w-4 h-4" /> Feedback
        </Link>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-grey-900 hover:text-error hover:bg-grey-50 transition-colors"
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
      <header className="sticky top-[var(--vv-safe-top)] z-50 bg-white border-b border-grey-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 min-h-[44px] min-w-[44px]">
            <BrandMark />
            {/* Below sm the mark alone, as in the signed-in header: the wordmark
                plus three links doesn't fit 360px and "Sign in" wrapped. */}
            <span className="hidden sm:inline font-display font-bold text-lg tracking-tight text-navy-700">VolleyVision</span>
          </Link>
          <div className="flex items-center gap-2 whitespace-nowrap">
            <NavLink to="/teams" className={({ isActive }) => `${navPillClass(isActive)} min-h-[44px] inline-flex items-center`}>Teams</NavLink>
            <NavLink to="/login" className={({ isActive }) => `${navPillClass(isActive)} min-h-[44px] inline-flex items-center`}>Sign in</NavLink>
            <NavLink to="/register" className="btn-primary text-sm px-4 py-2 min-h-[44px] inline-flex items-center">Register</NavLink>
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
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { data: invitations } = useMyInvitations();

  // Live tracking (/matches/:matchId/track) renders inside this shell like the
  // other match pages: it carries MatchPageHeader and the Stats/Events/Track
  // tabs and relies on <main>'s padding. The old chrome-free branch keyed on
  // /track/, which is now only a redirect, so it was dead code.
  if (!user) return <PublicShell />;

  const pendingCount = invitations?.length ?? 0;

  function handleSignOut() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-grey-50">
      {/* Top nav — single row, sticky */}
      <header className="sticky top-[var(--vv-safe-top)] z-30 bg-white border-b border-grey-200">
        <div className="h-[60px] px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Left: brand + nav */}
          <div className="flex items-center gap-5 min-w-0">
            <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0 min-h-[44px] min-w-[44px]">
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

          {/* Right: bell + avatar; overflow menu on small screens */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              to="/invitations"
              aria-label={pendingCount > 0 ? `Invitations (${pendingCount} pending)` : 'Invitations'}
              className="relative w-11 h-11 rounded-xl bg-white border border-grey-200 grid place-items-center text-grey-600 hover:text-navy-700 transition-colors"
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

      <EmailVerificationBanner />

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 py-6">
        <SuspendedOutlet />
      </main>
    </div>
  );
}
