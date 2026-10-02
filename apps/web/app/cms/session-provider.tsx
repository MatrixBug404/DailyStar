'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { SafeUser } from '@dailystar/types';
import { API_BASE } from '../../lib/api';

const AUTH_API_BASE = API_BASE.replace(/\/v1\/?$/, ''); // e.g. http://localhost:3001/api

export interface SessionContextValue {
  user: SafeUser | null;
  roles: string[];
  permissions: string[];
  accessToken: string | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const hasRefreshed = useRef(false);

  const fetchMe = async (token: string): Promise<SafeUser | null> => {
    try {
      const res = await fetch(`${AUTH_API_BASE}/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
      });
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  };

  const refresh = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${AUTH_API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        const token = data.accessToken;
        const me = await fetchMe(token);
        if (me) {
          setAccessToken(token);
          setUser(me);
          setRoles(me.roles || []);
          setPermissions(me.permissions || []);
          setStatus('authenticated');
          return token;
        }
      }
    } catch {
      // Ignore network errors here
    }
    setAccessToken(null);
    setUser(null);
    setRoles([]);
    setPermissions([]);
    setStatus('unauthenticated');
    return null;
  };

  useEffect(() => {
    if (!hasRefreshed.current) {
      hasRefreshed.current = true;
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    setStatus('loading');
    try {
      const res = await fetch(`${AUTH_API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let errMsg = 'Login failed';
        try {
          const errData = await res.json();
          errMsg = errData.message || errMsg;
        } catch { /* empty */ }
        throw new Error(errMsg);
      }

      const data = await res.json();
      const token = data.accessToken;

      const me = await fetchMe(token);
      if (!me) {
        throw new Error('Failed to verify user profile');
      }

      setAccessToken(token);
      setUser(me);
      setRoles(me.roles || []);
      setPermissions(me.permissions || []);
      setStatus('authenticated');
    } catch (error) {
      setAccessToken(null);
      setUser(null);
      setRoles([]);
      setPermissions([]);
      setStatus('unauthenticated');
      throw error;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch(`${AUTH_API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* empty */ }

    setAccessToken(null);
    setUser(null);
    setRoles([]);
    setPermissions([]);
    setStatus('unauthenticated');
  };

  const value: SessionContextValue = {
    user,
    roles,
    permissions,
    accessToken,
    status,
    login,
    logout,
    refresh,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
