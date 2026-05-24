import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi } from "../api/endpoints.js";
import { getToken, setToken } from "../api/client.js";
import type { User } from "../types.js";

interface OrgRef {
  id: string;
  slug: string;
}

interface AuthContextValue {
  user: User | null;
  org: OrgRef | null;
  token: string | null;
  status: "loading" | "ready";
  login: (orgSlug: string, email: string, password: string) => Promise<{ orgSlug: string }>;
  register: (input: {
    organizationName: string;
    organizationSlug?: string;
    name: string;
    email: string;
    password: string;
  }) => Promise<{ orgSlug: string }>;
  setSessionFromToken: (token: string) => Promise<{ orgSlug: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [org, setOrg] = useState<OrgRef | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus("ready");
      return;
    }
    authApi.me()
      .then((r) => {
        if (cancelled) return;
        setUser(r.user);
        setOrg(r.organization);
      })
      .catch(() => { setToken(null); setTokenState(null); setUser(null); setOrg(null); })
      .finally(() => { if (!cancelled) setStatus("ready"); });
    return () => { cancelled = true; };
  }, [token]);

  const value = useMemo<AuthContextValue>(() => ({
    user, org, token, status,
    login: async (orgSlug, email, password) => {
      const r = await authApi.login(orgSlug, email, password);
      setToken(r.token); setTokenState(r.token);
      setUser(r.user);
      setOrg({ id: r.organization.id, slug: r.organization.slug });
      return { orgSlug: r.organization.slug };
    },
    register: async (input) => {
      const r = await authApi.register(input);
      setToken(r.token); setTokenState(r.token);
      setUser(r.user);
      setOrg({ id: r.organization.id, slug: r.organization.slug });
      return { orgSlug: r.organization.slug };
    },
    setSessionFromToken: async (t) => {
      setToken(t); setTokenState(t);
      const r = await authApi.me();
      setUser(r.user);
      setOrg({ id: r.organization.id, slug: r.organization.slug });
      return { orgSlug: r.organization.slug };
    },
    logout: () => { setToken(null); setTokenState(null); setUser(null); setOrg(null); },
  }), [user, org, token, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside <AuthProvider>");
  return ctx;
}
