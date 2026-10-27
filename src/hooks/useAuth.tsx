import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import type { Role } from "@/lib/permissions";

export type { Role };

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  /** الموقع المخصّص للمستخدم (للصيدلي الفرعي) من جدول profiles. */
  assignedLocationId: string | null;
  /** يجب على المستخدم تغيير كلمة المرور الافتراضية قبل المتابعة. */
  mustChangePassword: boolean;
  /** إعادة تحميل بيانات الملف الشخصي (الأدوار/الموقع/علامة كلمة المرور). */
  refreshProfile: () => Promise<void>;
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (r: Role) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignedLocationId, setAssignedLocationId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listener FIRST, then getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => fetchProfile(s.user.id), 0);
      } else {
        setRoles([]);
        setAssignedLocationId(null);
        setMustChangePassword(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) fetchProfile(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function fetchProfile(uid: string) {
    const [rolesRes, profileRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("assigned_location_id,must_change_password").eq("id", uid).maybeSingle(),
    ]);
    setRoles((rolesRes.data || []).map((r) => r.role as Role));
    setAssignedLocationId(profileRes.data?.assigned_location_id ?? null);
    setMustChangePassword(!!profileRes.data?.must_change_password);
  }

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await fetchProfile(data.session.user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        roles,
        assignedLocationId,
        mustChangePassword,
        refreshProfile,
        loading,
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