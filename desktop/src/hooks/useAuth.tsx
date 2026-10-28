import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, tokenStore, type SessionUser } from "@/integrations/desktop/client";
import type {AccessProfile} from '../../../shared/accessPolicy';
import {subscribeInventoryRefresh} from '../../../shared/inventoryRefresh';
import {useQueryClient} from '@tanstack/react-query';

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
  access:AccessProfile|null;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  hasRole: (r: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient=useQueryClient();
  const accessFingerprint=useRef('');
  function acceptSession(token:string,user:SessionUser){
    const fingerprint=JSON.stringify([user.id,user.role,user.access]);
    if(accessFingerprint.current&&accessFingerprint.current!==fingerprint)queryClient.clear();
    accessFingerprint.current=fingerprint;
    setSession({token,user});setRoles([user.role as Role]);
  }
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
        if (cancelled||tokenStore.get()!==token) return;
        if (res.ok && res.user) {
          acceptSession(token,res.user);
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
    queryClient.clear();
    acceptSession(res.token,res.user);
    return { ok: true };
  };

  const signOut = async () => {
    queryClient.clear();
    const token = tokenStore.get();
    if (token) await api.auth.logout({ token });
    tokenStore.clear();
    setSession(null);
    setRoles([]);
  };
  useEffect(()=>subscribeInventoryRefresh(()=>{
    const token=tokenStore.get();if(!token)return;
    void api.auth.me({token}).then(res=>{if(tokenStore.get()!==token)return;if(res.ok&&res.user){acceptSession(token,res.user);}else{queryClient.clear();accessFingerprint.current='';tokenStore.clear();setSession(null);setRoles([]);}}).catch(()=>{if(tokenStore.get()!==token)return;queryClient.clear();accessFingerprint.current='';setSession(null);setRoles([]);});
  }),[]);

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        roles,
        access:session?.user.access||null,
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
