import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import './index.css';

import { AuthProvider } from './context/AuthContext';
import { ViewModeProvider } from './context/ViewModeContext';
import { features } from './config/features';
import Layout from './components/ui/Layout';
import RequireAuth from './components/ui/RequireAuth';
import PageLoadingFallback from './components/ui/PageLoadingFallback';

// Fail-soft: unset VITE_SENTRY_DSN is normal in local dev (see
// backend/src/instrument.ts for the equivalent backend guard). Session
// Replay stays off on purpose: this app shows match footage and chat that
// can include minors, and DOM/video capture is exactly the second copy of
// that data Sentry must not become.
// Drop query strings from anything Sentry is about to send. Only the fields
// touched are described, so this needs no type that @sentry/react does not
// export.
type ScrubbableEvent = {
  request?: { url?: string; query_string?: unknown };
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
};

// Copy of backend/src/lib/scrubUrl.ts (tested there; the frontend can't import
// backend code and has no test runner). Path only, plus the two API path
// segments that are credentials: a join code and an invitation token.
const CREDENTIAL_SEGMENTS: Array<[RegExp, string]> = [
  [/\/invitations\/lookup\/[^/]+/g, '/invitations/lookup/:code'],
  [/\/invitations\/[^/]+\/(accept|decline)(?=\/|$)/g, '/invitations/:token/$1'],
];
const scrubUrl = (url: string) => {
  let out = url.split('?')[0].split('#')[0];
  for (const [pattern, replacement] of CREDENTIAL_SEGMENTS) out = out.replace(pattern, replacement);
  return out;
};

function scrubUrls<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }
  // fetch/xhr breadcrumbs carry `url`; navigation breadcrumbs carry `from` and
  // `to`. Scrubbing only `url` let a team join code from
  // /redeem-invitation?code=... (or a reset/verify token) ride along on any
  // later error in the same browser session.
  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    for (const key of ['url', 'from', 'to']) {
      const value = data[key];
      if (typeof value === 'string') data[key] = scrubUrl(value);
    }
  }
  return event;
}

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    // VITE_SENTRY_ENVIRONMENT=staging on the staging site, which builds in
    // production mode; MODE (Vite's NODE_ENV equivalent) otherwise.
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    sendDefaultPii: false,
    // Free-tier Sentry quota; keep sampling low. See backend/src/instrument.ts.
    tracesSampleRate: 0.1,
    // sendDefaultPii: false is NOT "attach nothing" in SDK v10 - it switches
    // the SDK to a deny-list that filters by KEY NAME. The page URL is not
    // filtered at all, and this app puts live secrets in query strings:
    // /reset-password?token=<a working password-reset token>, and
    // /redeem-invitation?...  A JS error on either page would otherwise ship
    // that token to Sentry, where it stays readable until it expires.
    //
    // Breadcrumbs carry the same thing from the other side: the SDK records
    // every fetch, and any query string on it. Path only, on both. See backend/src/instrument.ts for
    // the server half and the SDK source this is based on.
    beforeSend: scrubUrls,
    beforeSendTransaction: scrubUrls,
  });
}

// Pages are lazy-loaded so a visitor downloads only the route they landed on
// rather than all 31 screens up front. Layout / RequireAuth / the providers
// above stay eagerly imported — they're small and needed on every route, so
// splitting them would only add a request waterfall.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const RedeemInvitationPage = lazy(() => import('./pages/RedeemInvitationPage'));
const InvitationsPage = lazy(() => import('./pages/InvitationsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PlayerPortalPage = lazy(() => import('./pages/PlayerPortalPage'));
const CoachDashboardPage = lazy(() => import('./pages/CoachDashboardPage'));
const TeamsPage = lazy(() => import('./pages/TeamsPage'));
const TeamDetailPage = lazy(() => import('./pages/TeamDetailPage'));
const MatchesPage = lazy(() => import('./pages/MatchesPage'));
const TrackingPage = lazy(() => import('./pages/TrackingPage'));
const MatchDashboardPage = lazy(() => import('./pages/MatchDashboardPage'));
const MatchEventsPage = lazy(() => import('./pages/MatchEventsPage'));
const MatchWatchPage = lazy(() => import('./pages/MatchWatchPage'));
const TeamDashboardPage = lazy(() => import('./pages/TeamDashboardPage'));
const PlayersDashboardPage = lazy(() => import('./pages/PlayersDashboardPage'));
const OnboardingCoachPage = lazy(() => import('./pages/OnboardingCoachPage'));
const OnboardingPlayerPage = lazy(() => import('./pages/OnboardingPlayerPage'));
const TeamChatPage = lazy(() => import('./pages/TeamChatPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));

// Backward-compat redirect: live tracking moved under the shared match shell at
// /matches/:matchId/track. Old bookmarks to /track/:matchId land here.
// eslint-disable-next-line react-refresh/only-export-components -- this is the app entrypoint, not a component module; splitting it up isn't worth it
function LegacyTrackRedirect() {
  const { matchId } = useParams<{ matchId: string }>();
  return <Navigate to={`/matches/${matchId}/track`} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

// eslint-disable-next-line react-refresh/only-export-components -- see LegacyTrackRedirect above
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ViewModeProvider>
        {/* Outer boundary covers the standalone routes (auth, onboarding) that
            render outside Layout. Routes nested under Layout suspend against
            Layout's own inner boundary instead, so the nav chrome stays put
            while a page chunk loads. */}
        <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          {/* Auth pages — standalone, no Layout chrome */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Password reset — public; the emailed token is the credential */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Email verification — reached from the emailed link, works logged in or out */}
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {/* Invitation redemption — public so brand-new / logged-out invitees can join */}
          <Route path="/invitations/redeem" element={<RedeemInvitationPage />} />
          {/* Post-registration onboarding nudges — one-time, intent-driven */}
          <Route path="/onboarding/coach" element={<OnboardingCoachPage />} />
          <Route path="/onboarding/player" element={<OnboardingPlayerPage />} />

          {/* Main app */}
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />

            {/* Protected routes — require a logged-in user */}
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/player" element={<PlayerPortalPage />} />
              <Route path="/coach" element={<CoachDashboardPage />} />
              {/* "My Teams" merged into /teams — teams are members-only, so
                  there is no separate "browse all teams" list any more. */}
              <Route path="/my-teams" element={<Navigate to="/teams" replace />} />
              <Route path="/invitations" element={<InvitationsPage />} />
              <Route path="/feedback" element={<FeedbackPage />} />
              <Route path="/track/:matchId" element={<LegacyTrackRedirect />} />
              {/* Team-scoped routes. Teams are private to their members, so
                  every one of these 404s for a non-member on the backend —
                  there is nothing here to read while logged out. */}
              <Route path="/teams" element={<TeamsPage />} />
              <Route path="/teams/:teamId" element={<TeamDetailPage />} />
              <Route path="/teams/:teamId/matches" element={<MatchesPage />} />
              <Route path="/teams/:teamId/dashboard" element={<TeamDashboardPage />} />
              {features.teamChat && (
                <Route path="/teams/:teamId/chat" element={<TeamChatPage />} />
              )}
              <Route path="/matches/:matchId/dashboard" element={<MatchDashboardPage />} />
              <Route path="/matches/:matchId/events" element={<MatchEventsPage />} />
              <Route path="/matches/:matchId/track" element={<TrackingPage />} />
              <Route path="/matches/:matchId/watch" element={<MatchWatchPage />} />
              <Route path="/players/:playerId/dashboard" element={<PlayersDashboardPage />} />
            </Route>
          </Route>
          {/* Unknown URLs, including bookmarks to removed features like /leagues */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ViewModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

// A tab left open across a deploy still references the previous build's chunk
// files, which the deploy removed, so the next lazy route fails with "Failed to
// fetch dynamically imported module" (Sentry VOLLEYVISION-2). Reloading picks up
// the new index.html. At most once per 10s, so a chunk that is genuinely
// missing surfaces as an error instead of a reload loop. With storage blocked
// the 10s guard can't be kept, so don't reload at all: a reload there would
// loop forever on a chunk that's really gone.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'vv:chunk-reload-at';
  try {
    if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return; // storage blocked: let the error surface
  }
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
