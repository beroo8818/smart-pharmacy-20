import View from '../../../shared/components/ReportingFreshness';
import {operationsCall} from '@/lib/operationsClient';
const load=()=>operationsCall('freshness');
export default function ReportingFreshness(){return <View load={load}/>;}
