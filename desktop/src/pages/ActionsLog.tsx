import ActionLog from '../../../shared/components/ActionLog';
import {loadNativeActions} from '../../../shared/recommendationActions';
import {operationsCall} from '@/lib/operationsClient';
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../../shared/accessPolicy';
import LegacyDecisionImport from '@/components/LegacyDecisionImport';
const load=()=>loadNativeActions(operationsCall);
export default function ActionsLog(){const {roles,access}=useAuth();return <ActionLog load={load} canExport={hasPermission(roles,access,'report.export')} extra={hasPermission(roles,access,'users.manage')&&hasPermission(roles,access,'decisions.write')&&hasPermission(roles,access,'screen.daily')?<LegacyDecisionImport/>:undefined}/>;}
