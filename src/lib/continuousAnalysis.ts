import {createAnalysisCache} from "../../shared/analysisCache";
import {createAnalysisWorker} from "../../shared/analysisWorker";
import {inventoryDataVersion} from "../../shared/inventoryRefresh";
import { fetchPagedRows } from "./pagedQuery";
import {analysisSource,selectAnalysisBatches} from '../../shared/analysisSource';
import { buildInventoryHistory, locationKey, stockBalances, todayISO, movementPeriodDays, type ConsumptionPeriod } from "../../shared/inventoryHistory";
import { applyStockLedger,forecastForUncoveredDays } from "../../shared/stockLedger";
import { supabase } from "@/integrations/supabase/client";
import {
  type AnalysisRow,
  type AlertKind,
  type Movement,
  type UploadBatch,
  itemKey,
  itemKeyAliases,
  itemDisplayName,
  itemTradeNames,
  normalize,
  num,
  isMainLocation,
  fetchActiveIngredientDictionary,
  enrichMovementsWithDictionary,
  sortBatchesForAnalysis,
} from "./batchAnalysis";
import { classifyBranch as classifyBranchDays, classifyMain as classifyMainDays } from "@/lib/statusRules";

import type {computeContinuousAnalysis,BatchWithSnapshot,StockTxn,ContinuousDataset,ContinuousOptions} from "./continuousEngine";
export {CONFIDENCE_LABEL,CONFIDENCE_CLASS,TXN_LABEL} from "./continuousEngine";
export type {Confidence,BatchWithSnapshot,StockTxn,ProjectedRow,ContinuousDataset,ContinuousOptions} from "./continuousEngine";

export async function fetchRecentBatches(months = 6): Promise<BatchWithSnapshot[]> {
  const data = await fetchPagedRows<BatchWithSnapshot>(() => (supabase as any)
    .from("upload_batches").select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind,issued_from,issued_to,received_from,received_to,snapshot_boundary")
    .eq("status", "saved").order("created_at", { ascending: false }).order("id", { ascending: false }));
  return sortBatchesForAnalysis(data);
}

/** Map normalized item_code -> first_active_date (ISO). */
export async function fetchFirstActiveDates(): Promise<Map<string, string>> {
  const { data, error } = await (supabase as any)
    .from("item_master")
    .select("item_code,first_active_date")
    .not("first_active_date", "is", null)
    .range(0, 99999);
  if (error) throw error;
  const map = new Map<string, string>();
  (data || []).forEach((r: any) => {
    if (r.item_code && r.first_active_date) map.set(normalize(r.item_code), r.first_active_date);
  });
  return map;
}

export async function fetchMovementsForBatches(batchIds: string[],enrich=true): Promise<Movement[]> {
  if (!batchIds.length) return [];
  const data: Movement[] = [];
  for (let start = 0; start < batchIds.length; start += 50) {
    data.push(...await fetchPagedRows<Movement>(() => (supabase as any)
      .from("inventory_movements")
      .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance,upload_batches(issued_from,issued_to)")
      .in("upload_batch_id", batchIds.slice(start, start + 50)).order("id", { ascending: true })));
  }
  if(!enrich)return data;
  const dict = await fetchActiveIngredientDictionary();
  return enrichMovementsWithDictionary(data.map((m:any)=>({...m,issued_from:m.upload_batches?.issued_from,issued_to:m.upload_batches?.issued_to})), dict);
}

export async function fetchStockTransactions(sinceISO?: string): Promise<StockTxn[]> {
  return fetchPagedRows<StockTxn>(() => {
    let query = (supabase as any).from('stock_transactions').select('*').order('txn_date',{ascending:false}).order('id',{ascending:true});
    if(sinceISO) query=query.gte('txn_date',sinceISO);
    return query;
  });
}

type Input=Parameters<typeof computeContinuousAnalysis>[0];
type Raw=Omit<Input,'opts'>;
const rawCache=createAnalysisCache<Raw>(1),resultCache=createAnalysisCache<ContinuousDataset>(3);
const calculator=createAnalysisWorker<Input,ContinuousDataset>(
 ()=>new Worker(new URL('./continuous.worker.ts',import.meta.url),{type:'module'}),
 async input=>(await import('./continuousEngine')).computeContinuousAnalysis(input),
);
async function authorization(){
 if(!supabase.auth?.getSession)return null;
 const {data:session}=await supabase.auth.getSession();
 if(!session.session)return null;
 const {data,error}=await supabase.rpc('hospital_operations' as any,{p_action:'access_self',p_payload:{}} as any);
 if(error||!(data as any)?.ok)return null;
 return JSON.stringify([session.session.access_token,data]);
}
async function readData(opts:ContinuousOptions):Promise<Raw>{
 const asOf=opts.asOf!,batches=await fetchRecentBatches(opts.monthsWindow??3);
 const selected=selectAnalysisBatches(batches,asOf,opts.batchIds);
 if(!selected.length)return {selected,movements:[],txns:[],firstActiveMap:new Map()};
 const earliest=selected.reduce((date,b)=>(b.snapshot_date||b.month)<date?(b.snapshot_date||b.month):date,asOf);
 const movements=await fetchMovementsForBatches(selected.map(b=>b.id),false);
 const dictionary=await fetchActiveIngredientDictionary();
 const firstActiveMap=await fetchFirstActiveDates(),txns=await fetchStockTransactions(earliest);
 return {selected,movements,txns,dictionary,firstActiveMap};
}
export async function loadContinuousAnalysis(options:ContinuousOptions={}):Promise<ContinuousDataset>{
 const opts={...options,asOf:options.asOf??todayISO(),monthsWindow:options.monthsWindow??3,targetDays:options.targetDays??30};
 const version=inventoryDataVersion(),auth=await authorization();
 const scope=JSON.stringify([auth,version]),rawKey=JSON.stringify([opts.asOf,analysisSource(),opts.batchIds]);
 const key=JSON.stringify([rawKey,opts.groupBy||'scientific',opts.monthsWindow,opts.targetDays]);
 if(!auth){rawCache.clear();resultCache.clear();}
 const calculate=async()=>{
  const raw=auth?await rawCache.get(rawKey,scope,()=>readData(opts)):await readData(opts);
  return calculator.run({...raw,opts});
 };
 const result=auth?await resultCache.get(key,scope,calculate):await calculate();
 if(version!==inventoryDataVersion()||(auth&&auth!==await authorization())){
  rawCache.clear();resultCache.clear();
  throw new Error('تغيرت البيانات أو الصلاحيات أثناء الحساب؛ أعد فتح الشاشة');
 }
 return structuredClone(result);
}
/** Month-over-month comparison between two batches. */
export async function compareMonths(batchAId: string, batchBId: string, targetDays = 30) {
  const movements = await fetchMovementsForBatches([batchAId, batchBId]);
  type Agg = { issuedA: number; balanceA: number; issuedB: number; balanceB: number; adcA:number;adcB:number; sample: Movement; locName: string; locType: string };
  const map = new Map<string, Agg>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    let a = map.get(key);
    if (!a) {
      a = { issuedA: 0, balanceA: 0, issuedB: 0, balanceB: 0, adcA:0,adcB:0, sample: m, locName: m.location_name, locType: m.location_type };
      map.set(key, a);
    }
    const days=movementPeriodDays(m),daily=days>0?num(m.issued_quantity)/days:0;
    if (m.upload_batch_id === batchAId) { a.issuedA += num(m.issued_quantity); a.balanceA = num(m.current_balance);a.adcA+=daily; }
    else { a.issuedB += num(m.issued_quantity); a.balanceB = num(m.current_balance);a.adcB+=daily; }
  }

  const items = Array.from(map.values()).map((a) => {
    const adcA = a.adcA, adcB = a.adcB;
    const daysA = adcA > 0 ? a.balanceA / adcA : null;
    const daysB = adcB > 0 ? a.balanceB / adcB : null;
    const becameRisky =
      classifyBranchDays(daysB, a.balanceB, a.issuedB, targetDays) === "safe" &&
      ["critical","danger","below"].includes(classifyBranchDays(daysA, a.balanceA, a.issuedA, targetDays));
    const improved =
      ["critical","danger","below"].includes(classifyBranchDays(daysB, a.balanceB, a.issuedB, targetDays)) &&
      classifyBranchDays(daysA, a.balanceA, a.issuedA, targetDays) === "safe";
    return {
      itemName: itemDisplayName(a.sample),
      locationName: a.locName,
      locationType: a.locType,
      issuedDelta: a.issuedA - a.issuedB,
      balanceDelta: a.balanceA - a.balanceB,
      coverageDeltaDays: (daysA ?? 0) - (daysB ?? 0),
      becameRisky,
      improved,
      isMain: isMainLocation(a.locType),
    };
  });

  return {
    items,
    becameRisky: items.filter((i) => i.becameRisky),
    improved: items.filter((i) => i.improved),
    worsePharmacies: Object.entries(
      items.filter((i) => !i.isMain && i.coverageDeltaDays < 0)
        .reduce<Record<string, number>>((acc, i) => { acc[i.locationName] = (acc[i.locationName] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}
