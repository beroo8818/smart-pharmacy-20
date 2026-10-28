import type {ConsumptionPeriod} from './inventoryHistory';
export type ShortageStock={key:string;itemKey:string;itemName:string;itemCode?:string;unit?:string|null;locationName:string;locationType:string;balance:number;projectedBalance?:number;adc?:number;hasBalance:boolean;hasConsumption:boolean;mixedSnapshots:boolean;snapshotDate:string;snapshotBoundary?:string|null;ledgerWarnings?:string[];consumptionPeriods:ConsumptionPeriod[]};
export type ShortageKind='hospital30'|'warehouse30'|'warehouse14'|'zero_demand'|'insufficient';
export type ShortageRecord={item:string;code:string;unit:string;location:string;period:string;balance:number|null;adc:number|null;days:number|null;threshold:number|null;state:string;warehouseBalance:number|null;branchesBalance:number|null;hospitalBalance:number|null;monthlyNeed:number|null;needed:number|null};
const main=(r:ShortageStock)=>['main_store','main_warehouse'].includes(r.locationType);
export function buildShortageReport(rows:ShortageStock[],kind:ShortageKind,query='',basis:'recorded'|'projected'='recorded',completenessWarning=''):ShortageRecord[]{
  const value=(r:ShortageStock)=>basis==='projected'?r.projectedBalance??NaN:r.balance;
  const groups=new Map<string,ShortageStock[]>();
  for(const r of rows){if(!`${r.itemName} ${r.itemCode||''}`.toLowerCase().includes(query.toLowerCase()))continue;const key=JSON.stringify([r.itemKey,(r.unit||'').trim().toLowerCase()]);const group=groups.get(key)||[];group.push(r);groups.set(key,group);}
  const records:ShortageRecord[]=[];
  for(const group of groups.values()){
    const branches=group.filter(r=>!main(r)),stores=group.filter(main),sample=group[0];
    const demandKnown=branches.length>0&&branches.every(r=>r.hasConsumption&&Number.isFinite(r.adc)&&r.adc!>=0);
    const demand=demandKnown?branches.reduce((n,r)=>n+r.adc!,0):null;
    const hospital=kind==='hospital30',selected=hospital?group:stores;
    const threshold=kind==='warehouse14'?14:kind==='hospital30'||kind==='warehouse30'?30:null;
    const dates=[...new Set(group.filter(r=>r.hasBalance).map(r=>r.snapshotDate+'|'+(r.snapshotBoundary||'unknown')))];
    const reasons:string[]=[];
    if(completenessWarning)reasons.push(completenessWarning);
    if(!sample.unit)reasons.push('الوحدة غير مؤكدة');
    if(!stores.length)reasons.push('بيانات المخزن غير مسجلة');
    if(!demandKnown)reasons.push('منصرف الفروع غير مكتمل');
    if(group.some(r=>!r.hasBalance||r.balance<0||!Number.isFinite(r.balance)))reasons.push('رصيد ناقص أو غير صالح');
    if(basis==='projected'&&group.some(r=>!Number.isFinite(value(r))||value(r)<0))reasons.push('توقع غير متاح أو غير صالح');
    if(group.some(r=>r.mixedSnapshots)||dates.length>1)reasons.push('تواريخ أو حدود أرصدة مختلفة؛ ليست جردًا موحدًا');
    if(group.some(r=>r.ledgerWarnings?.length))reasons.push('حركات تحتاج مراجعة');
    const sum=(list:ShortageStock[])=>list.length&&list.every(r=>r.hasBalance&&Number.isFinite(value(r))&&value(r)>=0)?list.reduce((n,r)=>n+value(r),0):null;
    const balance=sum(selected),warehouseBalance=sum(stores),branchesBalance=sum(branches),hospitalBalance=sum(group);
    const complete=!reasons.length;
    const days=complete&&demand!=null&&demand>0&&balance!=null?balance/demand:null;
    const record:ShortageRecord={item:sample.itemName,code:sample.itemCode||'',unit:sample.unit||'غير مؤكدة',location:hospital?'إجمالي المستشفى':'المخزن الرئيسي',period:[...new Set(group.map(r=>r.snapshotDate).filter(Boolean))].sort().join('، '),balance,adc:demand,days,threshold,warehouseBalance,branchesBalance,hospitalBalance,monthlyNeed:complete&&demand!=null?demand*30:null,needed:complete&&demand!=null&&demand>0&&balance!=null&&threshold!=null?Math.max(0,Math.ceil(demand*threshold-balance)):null,state:complete?(demand===0?'لا يوجد منصرف مسجل؛ لا يمكن حساب أيام التغطية':balance===0?'نافد مع استمرار الاحتياج':'أقل من حد التغطية'):reasons.join('؛ ')};
    if(kind==='insufficient'){if(!complete||demand===0)records.push({...record,location:'المستشفى والمخزن'});continue;}
    // Incomplete rows remain visible, not silently classified as safe or zero.
    if(!complete){records.push(record);continue;}
    if(kind==='zero_demand'){
      for(const r of group){const rate=main(r)?demand!:r.adc!;if(value(r)===0&&rate>0)records.push({...record,location:r.locationName,balance:0,adc:rate,days:0,state:basis==='projected'?'نفاد متوقع تقديري مع استمرار الاحتياج':'نافد مع استمرار الاحتياج'});}
    }else if(days!=null&&days<threshold!)records.push(record);
  }
  return records.sort((a,b)=>(a.days??Infinity)-(b.days??Infinity)||a.item.localeCompare(b.item,'ar'));
}
