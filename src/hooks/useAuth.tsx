import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import {useQueryClient} from '@tanstack/react-query';
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import type { Role } from "@/lib/permissions";
import type {AccessProfile} from '../../shared/accessPolicy';
import {subscribeInventoryRefresh} from '../../shared/inventoryRefresh';

export type { Role };

interface AuthCtx {
  session: Session | null;
  user: User | null;
  roles: Role[];
  access:AccessProfile|null;
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
  const queryClient=useQueryClient(),activeId=useRef<string|null>(null),profileVersion=useRef(0),accessFingerprint=useRef('');
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [access,setAccess]=useState<AccessProfile|null>(null);
  const [assignedLocationId, setAssignedLocationId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let sawAuthEvent=false;
    // Listener FIRST, then getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      sawAuthEvent=true;
      if(activeId.current!==(s?.user.id||null)){
        queryClient.clear();profileVersion.current++;accessFingerprint.current='';
        setRoles([]);setAccess(null);setAssignedLocationId(null);setMustChangePassword(false);
      }
      activeId.current=s?.user.id||null;
      setSession(s);
      if (s?.user) {
        setTimeout(() => fetchProfile(s.user.id), 0);
      } else {
        setRoles([]);
        setAccess(null);
        setAssignedLocationId(null);
        setMustChangePassword(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if(!sawAuthEvent){
        if(activeId.current!==(data.session?.user.id||null))queryClient.clear();
        activeId.current=data.session?.user.id||null;
        setSession(data.session);
        if (data.session?.user) fetchProfile(data.session.user.id);
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function fetchProfile(uid: string) {
    const version=++profileVersion.current;
    const [rolesRes, profileRes,accessRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("assigned_location_id,must_change_password").eq("id", uid).maybeSingle(),
      supabase.rpc('hospital_operations' as any,{p_action:'access_self',p_payload:{}} as any),
    ]);
    if(activeId.current!==uid||version!==profileVersion.current)return;
    const fingerprint=JSON.stringify([rolesRes.data,profileRes.data,accessRes.data]);
    if(accessFingerprint.current&&accessFingerprint.current!==fingerprint)queryClient.clear();
    accessFingerprint.current=fingerprint;
    setRoles((rolesRes.data || []).map((r) => r.role as Role));
    setAccess((accessRes.data as any)?.ok?(accessRes.data as any).access:null);
    setAssignedLocationId(profileRes.data?.assigned_location_id ?? null);
    setMustChangePassword(!!profileRes.data?.must_change_password);
  }

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await fetchProfile(data.session.user.id);
  };
  useEffect(()=>subscribeInventoryRefresh(()=>{void refreshProfile();}),[]);

  const signOut = async () => {
    queryClient.clear();activeId.current=null;
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        roles,
        access,
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
