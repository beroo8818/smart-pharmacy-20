import SettingsOverview from '../../../shared/components/SettingsOverview';
import {useAuth} from '@/hooks/useAuth';
export default function Settings(){const {roles,access,user}=useAuth();return <SettingsOverview local roles={roles} access={access} name={user?.full_name||user?.username||'حسابي'}/>;}
