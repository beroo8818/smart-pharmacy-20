import ReportCenterView from "../../shared/components/ReportCenter";
import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../shared/accessPolicy';
import {supabase} from '@/integrations/supabase/client';
const load = async () => (await loadContinuousAnalysis({ groupBy: "sku" })).rows;
const loadFreshness=async()=>{const {data,error}=await supabase.rpc('hospital_reporting_freshness' as any);if(error)throw error;return data as any;};
export default function ReportCenter() { const {roles,access}=useAuth();return <ReportCenterView load={load} loadFreshness={loadFreshness} canExport={hasPermission(roles,access,'report.export')} canPrint={hasPermission(roles,access,'report.print')}/>; }
