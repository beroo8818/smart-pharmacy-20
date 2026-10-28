import ReportCenterView from "../../../shared/components/ReportCenter";
import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../../shared/accessPolicy';
import {operationsCall} from '@/lib/operationsClient';
const load = async () => (await loadContinuousAnalysis({ groupBy: "sku" })).rows;
const loadFreshness=()=>operationsCall('freshness');
export default function ReportCenter() { const {roles,access}=useAuth();return <ReportCenterView load={load} loadFreshness={loadFreshness} local canExport={hasPermission(roles,access,'report.export')} canPrint={hasPermission(roles,access,'report.print')}/>; }
