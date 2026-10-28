import AccountPassword from '../../../shared/components/AccountPassword';
import { api, tokenStore } from '@/integrations/desktop/client';
const save=async(current:string,next:string)=>{const result=await api.auth.changePassword({token:tokenStore.get(),currentPassword:current,newPassword:next});if(!result.ok)throw new Error(result.error);};
export default function Account(){return <AccountPassword save={save} />;}
