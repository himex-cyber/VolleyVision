import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { teamsApi, membershipsApi, playerPortalApi } from '../lib/api';

export type ViewMode = 'coach' | 'player';

const STORAGE_KEY = 'vv_view_mode';

const COACH_TEAM_ROLES = ['HEAD_COACH', 'ASSISTANT_COACH', 'STATISTICIAN'];

interface ViewModeContextValue {
  /** Active portal the UI should render. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** User owns or staffs at least one team. */
  canCoach: boolean;
  /** User has a PLAYER membership or a linked player record. */
  canPlay: boolean;
  /** User can act as both — only then do we show a toggle. */
  isDual: boolean;
  /** Capability queries still resolving. */
  isLoading: boolean;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

function readStored(): ViewMode | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'coach' || v === 'player' ? v : null;
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const enabled = !!user;

  // Reuse the same query keys/functions as the app hooks so the cache is shared.
  const ownedTeams = useQuery({ queryKey: ['teams', 'my-teams'], queryFn: teamsApi.myTeams, enabled });
  const memberships = useQuery({ queryKey: ['memberships', 'me'], queryFn: membershipsApi.myTeams, enabled });
  const playerDash = useQuery({ queryKey: ['player', 'dashboard'], queryFn: playerPortalApi.dashboard, enabled });

  const canCoach = useMemo(() => {
    if (!user) return false;
    const owns = (ownedTeams.data?.length ?? 0) > 0;
    const staffs = (memberships.data ?? []).some((m) => COACH_TEAM_ROLES.includes(m.role));
    return owns || staffs;
  }, [user, ownedTeams.data, memberships.data]);

  const canPlay = useMemo(() => {
    if (!user) return false;
    const playsOnTeam = (memberships.data ?? []).some((m) => m.role === 'PLAYER');
    const hasLinkedRecord = (playerDash.data?.players?.length ?? 0) > 0;
    return playsOnTeam || hasLinkedRecord;
  }, [user, memberships.data, playerDash.data]);

  const isDual = canCoach && canPlay;
  const isLoading = enabled && (ownedTeams.isLoading || memberships.isLoading || playerDash.isLoading);

  const [stored, setStored] = useState<ViewMode | null>(() => readStored());

  // Resolve the effective view mode: a single-capability user is locked to that
  // capability; only a genuine tie (both capabilities, or none yet) falls back
  // to the user's stored toggle and then to their signup intent.
  //
  // ponytail: mirrors backend/src/lib/viewMode.ts, which is the tested copy of
  // this rule — no shared package and no frontend test runner exist. Change
  // both, or collapse them once either does.
  const viewMode: ViewMode = useMemo(() => {
    if (canCoach && !canPlay) return 'coach';
    if (canPlay && !canCoach) return 'player';
    if (stored) return stored;
    return user?.signupIntent === 'PLAYER' ? 'player' : 'coach';
  }, [canCoach, canPlay, stored, user?.signupIntent]);

  const setViewMode = (mode: ViewMode) => {
    setStored(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  };

  // Persist the resolved default for a dual user so the toggle has something to
  // read back. Writes `viewMode`, not a hardcoded 'coach' — otherwise this would
  // immediately overwrite a PLAYER-intent user's default on their first render.
  useEffect(() => {
    if (isDual && !stored) {
      localStorage.setItem(STORAGE_KEY, viewMode);
    }
  }, [isDual, stored, viewMode]);

  const value: ViewModeContextValue = {
    viewMode,
    setViewMode,
    canCoach,
    canPlay,
    isDual,
    isLoading,
  };

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error('useViewMode must be used inside <ViewModeProvider>');
  return ctx;
}
