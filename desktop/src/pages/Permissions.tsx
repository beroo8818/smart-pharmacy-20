import PermissionEditor from '../../../shared/components/PermissionEditor';
import {operationsCall} from '@/lib/operationsClient';
export default function Permissions(){return <PermissionEditor call={operationsCall}/>;}
