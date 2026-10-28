import SettingsOverview from '../../shared/components/SettingsOverview';
import {useAuth} from '@/hooks/useAuth';
export default function Settings(){const {roles,access,user}=useAuth();return <SettingsOverview roles={roles} access={access} name={user?.email||'حسابي'}/>;}
