import { numericValue } from './inventoryHistory';
import { validateReport, type OpsRow } from './operations';

export type CatalogItem = Pick<OpsRow,'item_code'|'item_name'|'unit'>;
export type BranchColumns = { code:number; name:number; unit:number; balance:number; issued:number; location:number };
export type BranchSheet = { columns:BranchColumns; dataStart:number; headers:string[]; wide:boolean };
const norm=(v:unknown)=>String(v??'').trim().toLowerCase().replace(/[\u064B-\u065F\u0670]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[()]/g,' ').replace(/\s+/g,' ').trim();
export function branchNameKey(value:unknown) {
  const name=norm(value).replace(/^(?:ال)?صيدليه\s+/,'');
  const inside=name.match(/^(?:ال)?داخلي\s*([abاب])$/);
  if(inside)return `internal-${['a','ا'].includes(inside[1])?'a':'b'}`;
  return name;
}
const aliases:Record<keyof BranchColumns,string[]>={
  code:['كود الصنف','كود','رمز الصنف','item code','item_code','code','sku'],
  name:['اسم الصنف','اسم الدواء','الاسم الاصلي','الاسم كما بالمنظومه','اسم كما بالمنظومه','item name','item_name','name'],
  unit:['الوحده','unit','uom'],balance:['الرصيد','رصيد','الرصيد الحالي','رصيد حالي','current balance','current_balance','balance','closing','closing_balance'],
  issued:['المنصرف','منصرف','صرف','منصرف الشهر','issued','issued_qty','issued_quantity','consumption'],
  location:['الصيدليه','اسم الصيدليه','الصيدليه الفرعيه','الموقع','location','pharmacy'],
};
function matches(value:unknown,field:keyof BranchColumns){const n=norm(value);return aliases[field].includes(n)||(field==='balance'&&/^رصيد\s+\d/.test(n));}
const blank=():BranchColumns=>({code:-1,name:-1,unit:-1,balance:-1,issued:-1,location:-1});
export function detectBranchSheet(matrix:unknown[][],branchName:string,kind:string):BranchSheet {
  let best:BranchSheet|null=null,score=0;
  for(let r=0;r<Math.min(matrix.length,30);r++){
    const columns=blank(),row=matrix[r];
    for(const field of Object.keys(columns) as (keyof BranchColumns)[]){const found=row.flatMap((value,i)=>matches(value,field)?[i]:[]);if(found.length===1)columns[field]=found[0];}
    const rank=Object.values(columns).filter(v=>v>=0).length;
    if((columns.balance>=0||kind==='period_consumption'&&columns.issued>=0)&&(columns.code>=0||columns.name>=0)&&columns.unit>=0&&rank>score){best={columns,dataStart:r+1,headers:row.map(String),wide:false};score=rank;}
  }
  if(best)return best;
  for(let r=1;r<Math.min(matrix.length,30);r++){
    const columns=blank(),max=Math.max(...matrix.slice(0,r+1).map(row=>row.length));
    const previous=matrix.slice(Math.max(0,r-6),r).map(row=>{let last:unknown='';return Array.from({length:max},(_,i)=>{if(String(row[i]??'').trim())last=row[i];return last;});});
    const headers=Array.from({length:max},(_,c)=>[...previous.map(row=>row[c]),matrix[r][c]].map(v=>String(v??'')).filter(Boolean).join(' / '));
    const candidates:{balance:number[];issued:number[]}={balance:[],issued:[]};
    for(let c=0;c<max;c++){
      for(const field of ['code','name','unit'] as const) if(columns[field]<0&&matrix.slice(Math.max(0,r-6),r+1).some(row=>matches(row[c],field)))columns[field]=c;
      if(!previous.some(row=>branchNameKey(row[c])===branchNameKey(branchName)))continue;
      if(matches(matrix[r][c],'balance'))candidates.balance.push(c);
      if(matches(matrix[r][c],'issued'))candidates.issued.push(c);
    }
    if((candidates.balance.length===1||kind==='period_consumption')&&(kind==='partial_update'||candidates.issued.length===1)&&(columns.code>=0||columns.name>=0)&&columns.unit>=0){columns.balance=candidates.balance[0]??-1;columns.issued=candidates.issued[0]??-1;return{columns,dataStart:r+1,headers,wide:true};}
  }
  throw new Error('تعذر تحديد الأعمدة أو أعمدة الصيدلية المختارة. استخدم قالب الفرع أو راجع اسم الصيدلية وعناوين الأعمدة.');
}
export function readBranchRows(matrix:unknown[][],format:BranchSheet,catalog:CatalogItem[],branchName:string,kind:string){
  const rows:OpsRow[]=[],issues:{row:number;message:string}[]=[],seen=new Map<string,OpsRow>();
  const unknownItems:{row:number;item_code:string;item_name:string;unit:string}[]=[];
  let skipped=0,excluded=0,duplicates=0,ignoredIssues=0;
  const c=format.columns;
  if(matrix.length-format.dataStart>5000)throw new Error('الملف أكبر من 5000 صف؛ قسّمه إلى ملفات أصغر');
  if((kind!=='period_consumption'&&c.balance<0)||c.unit<0||(c.code<0&&c.name<0)||(kind!=='partial_update'&&c.issued<0))throw new Error('أعمدة الكود أو الاسم والوحدة والكميات المطلوبة غير مكتملة');
  for(let i=format.dataStart;i<matrix.length;i++){
    const source=matrix[i],at=(index:number)=>index<0?null:source[index],has=(v:unknown)=>v!=null&&String(v).trim()!=='';
    if(!source.some(has)){skipped++;continue;}
    if(c.location>=0){if(!has(at(c.location))){issues.push({row:i+1,message:'اسم الصيدلية فارغ'});continue;}if(branchNameKey(at(c.location))!==branchNameKey(branchName)){excluded++;continue;}}
    if(kind==='period_consumption'?!has(at(c.issued)):!has(at(c.balance))&&(kind!=='monthly'||!has(at(c.issued)))){skipped++;continue;}
    const code=String(at(c.code)??'').trim(),name=norm(at(c.name)),unit=norm(at(c.unit));
    let found=catalog.filter(item=>code?norm(item.item_code)===norm(code):norm(item.item_name)===name);
    const identityCount=found.length;
    found=found.filter(item=>norm(item.unit)===unit);
    const unique=[...new Map(found.map(item=>[`${item.item_code}|${item.unit}`,item])).values()];
    if(unique.length!==1){issues.push({row:i+1,message:'الصنف أو الوحدة غير معروفين أو المطابقة غير فريدة؛ لا يتم التخمين أو تحويل الوحدات'});if(!identityCount&&name&&unit)unknownItems.push({row:i+1,item_code:code,item_name:String(at(c.name)).trim(),unit:String(at(c.unit)).trim()});continue;}
    const item=unique[0],row:OpsRow={...item,balance:kind==='period_consumption'?null:numericValue(at(c.balance)),issued:kind!=='partial_update'?numericValue(at(c.issued)):null};
    try{
      validateReport([row],kind);
      if(kind==='partial_update'&&has(at(c.issued)))ignoredIssues++;
      const old=seen.get(item.item_code);
      if(old){if(old.balance!==row.balance||old.issued!==row.issued||old.unit!==row.unit)issues.push({row:i+1,message:`قيم متعارضة لنفس الكود ${item.item_code}`});else duplicates++;continue;}
      seen.set(item.item_code,row);rows.push(row);
    }catch(e){issues.push({row:i+1,message:(e as Error).message});}
  }
  if(!rows.length&&!issues.length)issues.push({row:format.dataStart+1,message:'لا توجد كميات للصيدلية المختارة في هذا الملف'});
  return{rows,issues,skipped,excluded,duplicates,ignoredIssues,unknownItems};
}
