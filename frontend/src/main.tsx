import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';

import { AuthProvider } from './context/AuthContext';
import { ViewModeProvider } from './context/ViewModeContext';
import { features } from './config/features';
import Layout from './components/ui/Layout';
import RequireAuth from './components/ui/RequireAuth';
import PageLoadingFallback from './components/ui/PageLoadingFallback';

// Pages are lazy-loaded so a visitor downloads only the route they landed on
// rather than all 31 screens up front. Layout / RequireAuth / the providers
// above stay eagerly imported — they're small and needed on every route, so
// splitting them would only add a request waterfall.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
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
const LeagueHubPage = lazy(() => import('./pages/LeagueHubPage'));
const LeagueSeasonPage = lazy(() => import('./pages/LeagueSeasonPage'));
const LeagueSeasonStandingsPage = lazy(() => import('./pages/LeagueSeasonStandingsPage'));
const FixturesPage = lazy(() => import('./pages/FixturesPage'));
const ResultsPage = lazy(() => import('./pages/ResultsPage'));
const LeagueTeamProfilePage = lazy(() => import('./pages/LeagueTeamProfilePage'));
const LeagueSeasonRankingsPage = lazy(() => import('./pages/LeagueSeasonRankingsPage'));
const MatchCentrePage = lazy(() => import('./pages/MatchCentrePage'));
const TeamChatPage = lazy(() => import('./pages/TeamChatPage'));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'));

// Backward-compat redirect: live tracking moved under the shared match shell at
// /matches/:matchId/track. Old bookmarks to /track/:matchId land here.
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

              {features.leagues && (
                <>
                  <Route path="/leagues" element={<LeagueHubPage />} />
                  <Route path="/leagues/seasons/:seasonId" element={<LeagueSeasonPage />} />
                  <Route path="/leagues/seasons/:seasonId/standings" element={<LeagueSeasonStandingsPage />} />
                  <Route path="/leagues/seasons/:seasonId/fixtures" element={<FixturesPage />} />
                  <Route path="/leagues/seasons/:seasonId/results" element={<ResultsPage />} />
                  <Route path="/leagues/seasons/:seasonId/rankings" element={<LeagueSeasonRankingsPage />} />
                  <Route path="/leagues/seasons/:seasonId/match-centre" element={<MatchCentrePage />} />
                  <Route path="/leagues/league-teams/:leagueTeamId/profile" element={<LeagueTeamProfilePage />} />
                </>
              )}
            </Route>
          </Route>
        </Routes>
        </Suspense>
        </ViewModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
