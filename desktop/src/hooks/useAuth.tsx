import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, tokenStore, type SessionUser } from "@/integrations/desktop/client";

type Role =
  | "system_admin"
  | "pharmacy_manager"
  | "sub_pharmacist"
  | "warehouse_keeper"
  | "viewer";

interface AuthCtx {
  session: { token: string; user: SessionUser } | null;
  user: SessionUser | null;
  roles: Role[];
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (r: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ token: string; user: SessionUser } | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      const token = tokenStore.get();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await api.auth.me({ token });
        if (cancelled) return;
        if (res.ok && res.user) {
          setSession({ token, user: res.user });
          setRoles([res.user.role as Role]);
        } else {
          tokenStore.clear();
          setSession(null);
          setRoles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.auth.login({ username, password });
    if (!res.ok || !res.token || !res.user) return { ok: false, error: res.error || "فشل تسجيل الدخول" };
    tokenStore.set(res.token);
    setSession({ token: res.token, user: res.user });
    setRoles([res.user.role as Role]);
    return { ok: true };
  };

  const signOut = async () => {
    const token = tokenStore.get();
    if (token) await api.auth.logout({ token });
    tokenStore.clear();
    setSession(null);
    setRoles([]);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        roles,
        loading,
        login,
        signOut,
        hasRole: (r) => roles.includes(r),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
};