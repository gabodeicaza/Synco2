import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  borrarSesion,
  guardarSesion,
  guardarUsuarioCacheado,
  leerToken,
  leerUsuarioCacheado,
} from '@/src/utils/sessionKeys';
import { api, setAuthTokenCache, User } from '@/src/api';
import {
  registerForPushNotificationsAsync,
  clearCachedPushToken,
} from '@/src/utils/pushNotifications';

export type Role = 'coordinador_general' | 'jefe_proyecto' | 'sub_coordinador' | 'especialista';
export type { User };

interface Ctx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  acceptInvite: (token: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
      await guardarUsuarioCacheado(JSON.stringify(me));
    } catch {
      setUser(null);
      setAuthTokenCache(null);
      await borrarSesion();
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      // Produccion HTTPS (Batch V2): sin escape hatch de red. Se salta
      // directo a hidratar la sesion desde el storage.
      const cached = await leerUsuarioCacheado();
      if (cached && mounted) {
        try { setUser(JSON.parse(cached)); } catch {}
      }
      const tok = await leerToken();
      setAuthTokenCache(tok || null);
      if (tok) await refresh();
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [refresh]);

  // Cuando el usuario queda autenticado, registramos el Expo Push Token.
  // Se ejecuta una sola vez por cambio de usuario y nunca bloquea la UI.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await registerForPushNotificationsAsync();
        if (!cancelled && token && __DEV__) {
          console.log('[push] Token activo:', token);
        }
      } catch (err) {
        if (__DEV__) console.warn('[push] register error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await api.login(email, password);
    setAuthTokenCache(token);
    await guardarSesion(token, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const acceptInvite = useCallback(async (token: string, password: string) => {
    const { token: jwt, user: u } = await api.acceptInvite(token, password);
    setAuthTokenCache(jwt);
    await guardarSesion(jwt, JSON.stringify(u));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    setAuthTokenCache(null);
    await borrarSesion();
    await clearCachedPushToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, acceptInvite, logout, refresh }),
    [user, loading, login, acceptInvite, logout, refresh],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
