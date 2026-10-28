import StockAlerts from '../../shared/components/StockAlerts';
import {loadContinuousAnalysis} from '@/lib/continuousAnalysis';
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../shared/accessPolicy';
export default function Alerts(){const {roles,access}=useAuth();return <StockAlerts load={loadContinuousAnalysis} local={false} canExport={hasPermission(roles,access,'report.export')}/>;}
