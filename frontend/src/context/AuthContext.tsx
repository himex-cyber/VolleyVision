import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import type { User } from '../types';
import { authApi } from '../lib/api';
import { getToken, setToken as storeToken, clearToken } from '../lib/tokenStorage';
import { cacheUser, cachedUser, cachedUserId, clearOfflineCache } from '../lib/offlineCache';
import { forgetSession, purgeUserQueue } from '../lib/eventQueue';
import { setLeaveGuard } from '../lib/leaveGuard';
import { flushStorage } from '../lib/nativeStorage';

/** The user id inside a stored JWT (read locally; the server still verifies it). */
function tokenUserId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload?.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}

/** Another account signing in on this device: the last one's cached data goes. */
function switchCache(u: User) {
  if (cachedUserId() !== u.id) {
    clearOfflineCache();
    forgetSession();
  }
  cacheUser(u);
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; signupIntent?: string | null }) => Promise<void>;
  logout: () => void;
  /** Re-fetches /auth/me — used after verifying an email so the banner drops. */
  refreshUser: () => Promise<void>;
  onAccountDeleted: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getToken());
  const [isLoading, setIsLoading] = useState(true);

  // On mount, restore session from stored token. Only a 401 ends the session
  // (revoked or expired: the server said so). With no signal the tracker must
  // still open offline and keep its queued taps (6.6a), so the token stays and
  // the cached name and role stand in until /auth/me answers again.
  useEffect(() => {
    const stored = getToken();
    if (!stored) { setIsLoading(false); return; }
    const restore = () => authApi.me().then((u) => { cacheUser(u); setUser(u); });
    const retryOnline = () => { restore().catch(() => {}); };
    restore()
      .catch((err) => {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          clearToken();
          clearOfflineCache();
          setToken(null);
          return;
        }
        // Only the account this token belongs to: a cache left by someone
        // else must never pair with this token (their queue, their rosters).
        const cached = cachedUser();
        if (cached && cached.id === tokenUserId(stored)) setUser(cached);
        window.addEventListener('online', retryOnline, { once: true });
      })
      .finally(() => setIsLoading(false));
    return () => window.removeEventListener('online', retryOnline);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    storeToken(res.token);
    switchCache(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (data: { email: string; password: string; firstName: string; lastName: string; signupIntent?: string | null }) => {
    const res = await authApi.register(data);
    storeToken(res.token);
    switchCache(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    clearToken();
    // Queued taps stay (keyed by this user, no names); the cached user and
    // match rosters don't.
    clearOfflineCache();
    forgetSession();
    void flushStorage(); // the apps: the token removal reaches Preferences now
    setToken(null);
    setUser(null);
  }, []);

  // Account deleted (9.4): the token is already dead server-side, so no logout
  // call. Unlike sign-out, this account's queued taps go too: nothing of it
  // stays on the device. Other accounts' queues on a shared device stay. A
  // full reload, not a route change: it drops every in-memory copy (query
  // cache included), and RequireAuth can't redirect first and lose the notice.
  const onAccountDeleted = useCallback(() => {
    const id = user?.id;
    clearToken();
    clearOfflineCache();
    if (id) purgeUserQueue(id);
    else forgetSession();
    try { sessionStorage.removeItem('vv_verify_banner_dismissed'); } catch { /* storage blocked: nothing kept */ }
    setLeaveGuard(null);
    // In the apps the removals above are queued native writes: let them land
    // before the reload, or Preferences would keep the token and taps.
    void flushStorage().finally(() => window.location.replace('/login?deleted=1'));
  }, [user?.id]);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    const u = await authApi.me();
    cacheUser(u);
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, refreshUser, onAccountDeleted }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook belongs with the context/provider it reads, splitting it out would be a bigger refactor for no benefit
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
