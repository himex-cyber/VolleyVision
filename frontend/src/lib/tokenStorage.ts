// Single abstraction point for auth-token persistence. Nothing outside this
// file may read or write the token key directly. The web uses localStorage;
// the apps use native Preferences once hydrated (9.8, nativeStorage.ts).
import { nativeStore } from './nativeStorage';

const TOKEN_KEY = 'vv_token';

export function getToken(): string | null {
  const native = nativeStore();
  return native ? native.get(TOKEN_KEY) : localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  const native = nativeStore();
  if (native) native.set(TOKEN_KEY, token);
  else localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  const native = nativeStore();
  if (native) native.remove(TOKEN_KEY);
  else localStorage.removeItem(TOKEN_KEY);
}
