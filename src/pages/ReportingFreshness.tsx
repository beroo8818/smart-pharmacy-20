import View from '../../shared/components/ReportingFreshness';
import {supabase} from '@/integrations/supabase/client';
const load=async()=>{const {data,error}=await supabase.rpc('hospital_reporting_freshness' as any);if(error)throw error;return data as any;};
export default function ReportingFreshness(){return <View load={load}/>;}
