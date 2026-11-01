import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken } from "./api";

export const POC_KEY = "sched_poc";

export function isPoc() {
  try {
    return sessionStorage.getItem(POC_KEY) === "1";
  } catch {
    return false;
  }
}

const USER_KEY = "sched_user";

export type AuthUser = {
  name?: string;
  email?: string;
  username?: string;
  roles: string[];
  erp_staff_id?: number | null;
  can_construct: boolean;
  institution?: string;
  erp_database?: string;
};

export function profileFromMe(m: {
  name?: string;
  email?: string;
  username?: string;
  roles?: string[];
  erp_staff_id?: number | null;
  can_construct?: boolean;
  institution?: string;
  erp_database?: string;
}, roles?: string[]): AuthUser {
  return {
    name: m.name,
    email: m.email,
    username: m.username,
    roles: m.roles || roles || [],
    erp_staff_id: m.erp_staff_id,
    can_construct: !!m.can_construct,
    institution: m.institution,
    erp_database: m.erp_database,
  };
}

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeStoredUser(user: AuthUser | null) {
  try {
    if (!user) localStorage.removeItem(USER_KEY);
    else localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  logout: () => void;
  setToken: (t: string) => void;
  setUser: (u: AuthUser | null) => void;
};

const empty: AuthState = {
  token: null,
  user: null,
  logout: () => undefined,
  setToken: () => undefined,
  setUser: () => undefined,
};

const Ctx = createContext<AuthState>(empty);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTok] = useState<string | null>(getToken());
  const [user, setUserState] = useState<AuthUser | null>(() => (getToken() ? readStoredUser() : null));
  const [ready, setReady] = useState(false);
  const setUser = (next: AuthUser | null) => {
    writeStoredUser(next);
    setUserState(next);
  };

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const me = await api("/v1/me", {}, { busy: false });
        const profile = profileFromMe(me);
        writeStoredUser(profile);
        if (!cancel) setUserState(profile);
      } catch {
        /* stay on login */
      }
      if (!cancel) setReady(true);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      token,
      user,
      setUser,
      setToken: (t: string) => {
        localStorage.setItem("sched_token", t);
        setTok(t);
      },
      logout: () => {
        clearToken();
        writeStoredUser(null);
        setTok(null);
        setUserState(null);
      },
    }),
    [token, user]
  );
  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
