import {notifyInventoryChanged} from './inventoryRefresh';
import type {HistoryBatch} from './inventoryHistory';

export type AnalysisSource = 'history' | 'latest_file';
export const ANALYSIS_SOURCE_KEY = 'dawa-analysis-source';
let fallback:AnalysisSource='history';

export function analysisSource():AnalysisSource {
  try { return localStorage.getItem(ANALYSIS_SOURCE_KEY)==='latest_file'?'latest_file':'history'; }
  catch { return fallback; }
}

export function setAnalysisSource(source:AnalysisSource) {
  fallback=source;
  try { localStorage.setItem(ANALYSIS_SOURCE_KEY,source); } catch { /* Session-only selection remains available. */ }
  notifyInventoryChanged();
}

// A partial upload is a selectable view, never a replacement for absent stock.
export function selectAnalysisBatches<T extends HistoryBatch>(batches:T[],asOf:string,batchIds?:string[],source=analysisSource()):T[] {
  const eligible=batches.filter(b=>(b.snapshot_date||b.month)<=asOf&&(!batchIds||batchIds.includes(b.id)));
  if(batchIds||source==='history')return eligible;
  return [...eligible].sort((a,b)=>(b.uploaded_at||b.created_at||'').localeCompare(a.uploaded_at||a.created_at||'')||b.id.localeCompare(a.id)).slice(0,1);
}
