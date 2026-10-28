import { dateRangeDays,locationKey, validISODate, type HistoryCell } from './inventoryHistory';

export type LedgerTransaction = {
  id: string; txn_date: string; txn_type: string; item_key: string; item_code?: string | null;
  item_name?: string | null; unit?: string | null; qty: number | string;
  from_location_name: string | null; from_location_type: string | null;
  to_location_name: string | null; to_location_type: string | null;
  issued_from?:string|null;issued_to?:string|null;
};
export type StockAdjustments = { receipts: number; issues: number; patientIssues: number; transfersIn: number; transfersOut: number; returns: number;issueRanges:{from:string;to:string}[];unknownIssueCoverage:boolean };
const empty = (): StockAdjustments => ({receipts:0,issues:0,patientIssues:0,transfersIn:0,transfersOut:0,returns:0,issueRanges:[],unknownIssueCoverage:false});
export function forecastForUncoveredDays(adc:number,days:number,adjustments:StockAdjustments){
  if(adjustments.unknownIssueCoverage)return {expected:0,suppressed:true,coveredDays:0};
  const ranges=[...adjustments.issueRanges].sort((a,b)=>a.from.localeCompare(b.from));
  let coveredDays=0,last='';
  for(const range of ranges){
    const start=last&&range.from<=last?new Date(Date.parse(last+'T00:00:00Z')+86400000).toISOString().slice(0,10):range.from;
    if(start<=range.to)coveredDays+=dateRangeDays(start,range.to);
    if(range.to>last)last=range.to;
  }
  return {expected:adc*Math.max(0,days-coveredDays),suppressed:false,coveredDays};
}
export const ledgerCellKey = (item: string, name: string, type: string) => item + '|' + locationKey(name,type);

// Unknown opening stock stays unknown. A transaction-only cell exposes its net movement, never an invented zero opening.
export function applyStockLedger<T>(input: HistoryCell<T>[], transactions: LedgerTransaction[], asOf: string,
  itemKey: (sample:T)=>string, aliases:(sample:T)=>string[], normalize:(value:unknown)=>string, samples:T[] = []) {
  const cells = [...input];
  const index = new Map(cells.map(c => [ledgerCellKey(itemKey(c.sample),c.locName,c.locType),c]));
  const templates = new Map(cells.map(c => [itemKey(c.sample),c]));
  const aliasMap = new Map<string,string>();
  const ambiguous = new Set<string>();
  for (const sample of [...input.map(c=>c.sample),...samples]) for (const alias of [...aliases(sample),itemKey(sample)]) {
    const key=normalize(alias), canonical=itemKey(sample), old=aliasMap.get(key);
    if(old && old!==canonical) ambiguous.add(key); else aliasMap.set(key,canonical);
  }
  const adjustments = new Map<string,StockAdjustments>();
  const warnings = new Map<string,Set<string>>();
  const warn=(key:string,message:string)=>{const list=warnings.get(key)||new Set<string>();list.add(message);warnings.set(key,list);};
  const seen = new Set<string>();
  for (const txn of transactions) {
    if (txn.id && seen.has(txn.id)) continue;
    if (txn.id) seen.add(txn.id);
    if (!validISODate(txn.txn_date) || txn.txn_date>asOf) continue;
    const raw=normalize(txn.item_code||txn.item_key||txn.item_name);
    if(ambiguous.has(raw)){
      const affected = new Set([...input.map(c=>c.sample),...samples].filter(sample=>[...aliases(sample),itemKey(sample)].some(alias=>normalize(alias)===raw)).map(itemKey));
      for(const c of cells) if(affected.has(itemKey(c.sample))) warn(ledgerCellKey(itemKey(c.sample),c.locName,c.locType),'تعريف الصنف في الحركة ملتبس بين مجموعات مختلفة؛ لم تطبق الكمية');
      continue;
    }
    const canonical=aliasMap.get(raw);
    const template=canonical?templates.get(canonical):null;
    if(!canonical||!template) continue;
    const q=Number(txn.qty);
    if(!Number.isFinite(q)||q<=0) continue;
    type Side = {name:string|null;type:string;field:keyof StockAdjustments;issue?:boolean};
    const from=(type:string,field:keyof StockAdjustments,issue=false):Side=>({name:txn.from_location_name,type:txn.from_location_type||type,field,issue});
    const to=(type:string,field:keyof StockAdjustments):Side=>({name:txn.to_location_name,type:txn.to_location_type||type,field});
    let sides:Side[];
    switch(txn.txn_type){
      case 'warehouse_receipt':sides=[to('main_warehouse','receipts')];break;
      case 'warehouse_issue_to_pharmacy':sides=[from('main_warehouse','issues'),to('sub_pharmacy','receipts')];break;
      case 'pharmacy_transfer':sides=[from('sub_pharmacy','transfersOut'),to('sub_pharmacy','transfersIn')];break;
      case 'warehouse_return':case 'pharmacy_return_to_warehouse':sides=[from('sub_pharmacy','issues'),to('main_warehouse','receipts')];break;
      case 'pharmacy_issue':sides=[from('sub_pharmacy','issues',true)];break;
      default:continue;
    }
    if(sides.some(s=>!s.name?.trim())) {
      for(const s of sides) if(s.name) warn(ledgerCellKey(canonical,s.name,s.type),'حركة ناقصة الطرف الآخر؛ راجع المستند');
      continue;
    }
    for(const side of sides){
      const key=ledgerCellKey(canonical,side.name!,side.type);
      let cell=index.get(key);
      if(!cell){
        cell={...template,locName:side.name!,locType:side.type,latestBalance:0,latestSnapshot:'',latestUploadedAt:'',snapshotBoundary:null,
          adc:0,issuedAverage:0,monthsOfData:0,activeDays:0,hasBalance:false,hasConsumption:false,mixedSnapshots:false,consumptionPeriods:[]};
        cells.push(cell);index.set(key,cell);
      }
      const unit=(cell.sample as {unit?:unknown}).unit;
      if(!txn.unit||normalize(txn.unit)!==normalize(unit)) {warn(key,'وحدة الحركة غير مؤكدة أو مختلفة؛ لم تطبق الكمية');continue;}
      if(cell.mixedSnapshots){warn(key,'تواريخ أو حدود الأرصدة مختلفة؛ راجع الحركة');continue;}
      if(cell.hasBalance){
        if(side.issue&&(txn.issued_from||txn.issued_to)){
          if(!dateRangeDays(txn.issued_from||'',txn.issued_to||'')||txn.issued_to!>txn.txn_date){warn(key,'فترة المنصرف الفعلي غير صالحة');continue;}
          if(txn.issued_to!<cell.latestSnapshot||(txn.issued_to===cell.latestSnapshot&&cell.snapshotBoundary==='end_of_day'))continue;
          if(txn.issued_from!<cell.latestSnapshot||(txn.issued_from===cell.latestSnapshot&&cell.snapshotBoundary!=='start_of_day')){warn(key,'فترة المنصرف تتداخل مع رصيد الجرد؛ لا يمكن فصل الجزء المشمول من إجمالي الفترة');continue;}
        }
        if(txn.txn_date<cell.latestSnapshot) continue;
        if(txn.txn_date===cell.latestSnapshot){
          if(cell.snapshotBoundary==='end_of_day') continue;
          if(cell.snapshotBoundary!=='start_of_day'){warn(key,'حركة في نفس يوم رصيد قديم دون تحديد بداية أو نهاية اليوم؛ يلزم تأكيد الرصيد');continue;}
        }
      } else warn(key,'رصيد أساسي غير مسجل؛ المعروض صافي الحركات فقط وليس رصيدًا مؤكدًا');
      const agg=adjustments.get(key)||empty();
      if(side.issue&&txn.issued_from&&txn.issued_to&&agg.issueRanges.some(range=>range.from<=txn.issued_to!&&range.to>=txn.issued_from!)){warn(key,'فترات منصرف فعلي متداخلة؛ راجع السجل قبل اعتماد الرصيد');continue;}
      agg[side.field as 'receipts'|'issues'|'transfersIn'|'transfersOut'|'returns']+=q;
      if(side.issue){
        agg.patientIssues+=q;
        if(txn.issued_from&&txn.issued_to)agg.issueRanges.push({from:txn.issued_from,to:txn.issued_to});else agg.unknownIssueCoverage=true;
      }
      adjustments.set(key,agg);
    }
  }
  return cells.map(cell=>{
    const key=ledgerCellKey(itemKey(cell.sample),cell.locName,cell.locType);
    return {...cell,adjustments:adjustments.get(key)||empty(),ledgerWarnings:[...warnings.get(key)||[]]};
  });
}
