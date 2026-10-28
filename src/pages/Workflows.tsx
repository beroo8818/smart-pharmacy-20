import WorkflowGuide from '../../shared/components/WorkflowGuide';
import {useAuth} from '@/hooks/useAuth';
export default function Workflows(){const {roles,access}=useAuth();return <WorkflowGuide roles={roles} access={access}/>;}
