import StockAssistant from '../../../shared/components/StockAssistant';
import {loadContinuousAnalysis} from '@/lib/continuousAnalysis';
const load=async()=>(await loadContinuousAnalysis({groupBy:'sku'})).rows;
export default function Assistant(){return <StockAssistant load={load}/>;}
