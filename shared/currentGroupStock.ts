type Cell={key:string;itemName:string;tradeNames?:string[];unit?:string|null;locationName:string;locationType:string;balance:number;adc:number;days:number|null;hasBalance:boolean;hasConsumption:boolean;snapshotDate:string;mixedSnapshots:boolean;ledgerWarnings?:string[]};
type Definition={original_item_name:string;strength?:string|null;dosage_form?:string|null;unit?:string|null;approved?:boolean;needs_review?:boolean};
const clean=(v:unknown)=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const main=(r:Cell)=>['main_store','main_warehouse'].includes(r.locationType);
export function currentGroupStock(cells:Cell[],definitions:Definition[]){
 const names=new Set(definitions.map(d=>clean(d.original_item_name)));
 const selected=cells.filter(r=>[r.itemName,...r.tradeNames||[]].some(n=>names.has(clean(n))));
 const identity=new Set(definitions.map(d=>[d.strength,d.dosage_form,d.unit].map(clean).join('|')));
 const approved=definitions.length>0&&identity.size===1&&definitions.every(d=>!!d.strength&&!!d.dosage_form&&!!d.unit&&(!d.needs_review||d.approved));
 const reliable=(rows:Cell[])=>approved&&rows.length>0&&new Set(rows.map(r=>clean(r.unit))).size===1&&new Set(rows.map(r=>r.snapshotDate)).size===1&&rows.every(r=>r.hasBalance&&!r.mixedSnapshots&&!r.ledgerWarnings?.length&&r.balance>=0&&!!r.unit&&(main(r)||r.hasConsumption));
 const sum=(rows:Cell[])=>{
  const good=reliable(rows),balance=good?rows.reduce((n,r)=>n+r.balance,0):null;
  const branches=rows.filter(r=>!main(r));
  const adc=good?(branches.length?branches.reduce((n,r)=>n+r.adc,0):reliable(selected)?selected.filter(r=>!main(r)).reduce((n,r)=>n+r.adc,0):null):null;
  return {balance,issued:adc==null?null:adc*30,adc,days:balance!=null&&adc!=null&&adc>0?balance/adc:null};
 };
 const totals=sum(selected);
 const groups=new Map<string,Cell[]>();
 for(const row of selected){const key=approved?row.locationName:row.key;groups.set(key,[...groups.get(key)||[],row]);}
 const perPharmacy=[...groups].map(([,rows])=>({name:rows[0].locationName+(approved?'':' | '+rows[0].itemName+' ('+(rows[0].unit||'غير مؤكدة')+')'),...sum(rows)}));
 return {totals,perPharmacy,selected};
}
