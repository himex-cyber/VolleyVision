import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '../types';
import { authApi } from '../lib/api';
import { getToken, setToken as storeToken, clearToken } from '../lib/tokenStorage';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; password: string; firstName: string; lastName: string; signupIntent?: string | null }) => Promise<void>;
  logout: () => void;
  /** Re-fetches /auth/me — used after verifying an email so the banner drops. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getToken());
  const [isLoading, setIsLoading] = useState(true);

  // On mount, restore session from stored token
  useEffect(() => {
    const stored = getToken();
    if (!stored) { setIsLoading(false); return; }
    authApi.me()
      .then((u) => setUser(u))
      .catch(() => {
        clearToken();
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    storeToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (data: { email: string; password: string; firstName: string; lastName: string; signupIntent?: string | null }) => {
    const res = await authApi.register(data);
    storeToken(res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    clearToken();
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    const u = await authApi.me();
    setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, refreshUser }}>
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
