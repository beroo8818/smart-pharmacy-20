import { useCallback } from 'react';
import AccountPassword from '../../shared/components/AccountPassword';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
export default function Account() {
  const { user }=useAuth();
  const save=useCallback(async(current:string,next:string)=>{
    if(!user?.email) throw new Error('الحساب غير متاح');
    const login=await supabase.auth.signInWithPassword({email:user.email,password:current});
    if(login.error) throw new Error('كلمة المرور الحالية غير صحيحة');
    const result=await supabase.auth.updateUser({password:next});
    if(result.error) throw result.error;
  },[user?.email]);
  return <AccountPassword save={save} />;
}
