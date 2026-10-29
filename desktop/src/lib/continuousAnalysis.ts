import {todayISO} from "../../../shared/inventoryHistory";
import {analysisSource,selectAnalysisBatches} from "../../../shared/analysisSource";
import {createAnalysisCache} from "../../../shared/analysisCache";
import {createAnalysisWorker} from "../../../shared/analysisWorker";
import {inventoryDataVersion} from "../../../shared/inventoryRefresh";
import {api,tokenStore,type UploadBatch} from "@/integrations/desktop/client";
import {isMainLocation} from "./desktopAnalytics";
import type {computeContinuousAnalysis,ContinuousDataset,ContinuousOptions} from "./continuousEngine";
export {CONFIDENCE_LABEL,CONFIDENCE_CLASS} from "./continuousEngine";
export type {Confidence,ProjectedRow,ContinuousDataset,ContinuousOptions} from "./continuousEngine";
export {isMainLocation};

type Input=Parameters<typeof computeContinuousAnalysis>[0];
type Raw=Omit<Input,'opts'>;
const rawCache=createAnalysisCache<Raw>(1,Infinity),resultCache=createAnalysisCache<ContinuousDataset>(3,Infinity);
const calculator=createAnalysisWorker<Input,ContinuousDataset>(
 ()=>new Worker(new URL('./continuous.worker.ts',import.meta.url),{type:'module'}),
 async input=>(await import('./continuousEngine')).computeContinuousAnalysis(input),
);

async function authorization(token:string){
 if(!api.auth?.me)return null;
 const result=await api.auth.me({token});
 if(!result.ok||!result.user)throw new Error('تعذر التحقق من صلاحيات الحساب؛ سجل الدخول مجددًا');
 return JSON.stringify([token,result.user.id,result.user.role,result.user.assigned_location_id,result.user.access]);
}
async function databaseRevision(token:string){
 if(!api.queries.inventoryRevision)return null;
 const result=await api.queries.inventoryRevision({token});
 if(!result.ok||!result.revision)throw new Error('تعذر التحقق من آخر تحديث لقاعدة البيانات');
 return result.revision;
}
async function readData(opts:ContinuousOptions,token:string):Promise<Raw>{
 const asOf=opts.asOf!;
 const batchesResult=await api.queries.listBatchesContinuous({token,limit:10000});
 if(batchesResult.ok===false)throw new Error('تعذر قراءة الملفات المحفوظة');
 const selected=selectAnalysisBatches((batchesResult.batches||[]) as UploadBatch[],asOf,opts.batchIds);
 if(!selected.length)return {selected,movements:[],txns:[],dictionary:[]};
 const result=await api.queries.movementsByBatchIds({token,batchIds:selected.map(b=>b.id),compact:true});
 if(!result.ok)throw new Error('تعذر قراءة بيانات الأرصدة');
 let dictionary:Input['dictionary']=[];
 if(api.operations?.call){
  const entries=await api.operations.call({token,action:'local_table',payload:{table:'active_ingredient_dictionary',operation:'select',filters:[]}});
  if(!entries.ok)throw new Error(entries.error||'تعذر قراءة القاموس المحلي');
  dictionary=entries.rows||[];
 }
 const earliest=selected.reduce((date,b)=>(b.snapshot_date||b.month)<date?(b.snapshot_date||b.month):date,asOf);
 const transactions=await api.stockTxn.list({token,sinceISO:earliest,all:true});
 if(!transactions.ok)throw new Error('تعذر قراءة الحركات الفعلية');
 return {selected,movements:result.movements||[],txns:transactions.rows||[],dictionary};
}
export async function loadContinuousAnalysis(options:ContinuousOptions={}):Promise<ContinuousDataset>{
 const opts={...options,asOf:options.asOf??todayISO(),monthsWindow:options.monthsWindow??3,targetDays:options.targetDays??30};
 const token=tokenStore.get(),version=inventoryDataVersion();
 let auth:string|null;
 try{auth=await authorization(token);}catch(error){rawCache.clear();resultCache.clear();throw error;}
 const revision=await databaseRevision(token);
 const scope=JSON.stringify([auth,version,revision??Math.floor(Date.now()/45000)]),rawKey=JSON.stringify([opts.asOf,analysisSource(),opts.batchIds]);
 const key=JSON.stringify([rawKey,opts.groupBy||'scientific',opts.monthsWindow,opts.targetDays]);
 const calculate=async()=>{
  const input=auth?await rawCache.get(rawKey,scope,()=>readData(opts,token)):await readData(opts,token);
  return calculator.run({...input,opts});
 };
 const result=auth?await resultCache.get(key,scope,calculate):await calculate();
 if(token!==tokenStore.get()||version!==inventoryDataVersion()||(auth&&auth!==await authorization(token))||(revision&&revision!==await databaseRevision(token))){
  rawCache.clear();resultCache.clear();
  throw new Error('تغيرت البيانات أو الصلاحيات أثناء الحساب؛ أعد فتح الشاشة');
 }
 return structuredClone(result);
}
