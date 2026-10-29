import { useEffect,useMemo,useState } from 'react';
import * as XLSX from 'xlsx';
import { detectBranchSheet,readBranchRows,type BranchSheet,type CatalogItem } from '../branchExcel';
import type { OpsRow } from '../operations';
import type {OpsCall} from '../operations';
import ItemCreateForm,{type DictionaryItem} from './ItemCreateForm';

export default function BranchExcelUpload({catalog,branchName,kind,onRows,disabled=false,createCall,onCatalogCreated}:{catalog:CatalogItem[];branchName:string;kind:string;onRows:(rows:OpsRow[])=>void;disabled?:boolean;createCall?:OpsCall;onCatalogCreated?:()=>Promise<void>}){
  const [newItem,setNewItem]=useState<Partial<DictionaryItem>|null>(null);
  const [book,setBook]=useState<XLSX.WorkBook|null>(null),[sheet,setSheet]=useState(''),[filename,setFilename]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[overrides,setOverrides]=useState<BranchSheet|null>(null);
  useEffect(()=>{setOverrides(null);setNewItem(null);},[branchName,kind]);
  const parsed=useMemo(()=>{if(!book||!sheet)return null;try{const matrix=XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet],{header:1,defval:null,raw:true});const format=overrides||detectBranchSheet(matrix,branchName,kind);return{...readBranchRows(matrix,format,catalog,branchName,kind),format};}catch(e){return{error:(e as Error).message};}},[book,sheet,branchName,kind,catalog,overrides]);
  function template(){const balance=kind!=='period_consumption',issued=kind!=='partial_update';const header=['كود الصنف','اسم الصنف','الوحدة',...(balance?['الرصيد']:[]),...(issued?['المنصرف']:[])];const data=[header,...catalog.map(item=>[item.item_code,item.item_name,item.unit,...(balance?[null]:[]),...(issued?[null]:[])])];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),'تحديث الفرع');XLSX.writeFile(wb,issued?'branch-consumption-template.xlsx':'branch-balance-template.xlsx');}
  return <section className="border rounded-lg p-4 space-y-3" data-testid="branch-excel-upload">
    <div className="flex gap-3 flex-wrap"><h3 className="font-bold">تحديث من ملف Excel</h3><button className="border rounded px-3 py-1" disabled={disabled||!catalog.length} onClick={template}>تحميل قالب بالأصناف المعروفة</button></div>
    <label className="block">اختر ملف Excel أو CSV<input className="block border rounded p-2 w-full" type="file" accept=".xlsx,.xls,.csv" disabled={disabled||busy||!branchName||!catalog.length&&!createCall} onChange={async(e)=>{
      const file=e.target.files?.[0];if(!file)return;setBook(null);setFilename('');setError('');setOverrides(null);setNewItem(null);
      if(file.size>20*1024*1024){setError('الحد الأقصى لحجم الملف 20 ميجابايت');return;}setBusy(true);
      try{const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});setBook(wb);setSheet(wb.SheetNames[0]);setFilename(file.name);}catch{setError('تعذر قراءة الملف؛ احفظ نسخة Excel صالحة ثم حاول مجددًا');}finally{setBusy(false);}
    }}/></label>
    {onCatalogCreated&&<button type="button" className="border rounded p-2" disabled={disabled||busy} onClick={async()=>{setBusy(true);setError('');try{await onCatalogCreated();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>تحديث قاموس الأصناف</button>}
    {!catalog.length&&<p>{createCall?'القاموس فارغ. يمكنك رفع الملف وتعريف أصنافه الجديدة بعد مراجعتها.':'الأصناف الأساسية غير موجودة بعد. اطلب من مسؤول القاموس تعريفها أولًا.'}</p>}
    {error&&<p role="alert">{error}</p>}
    {newItem&&createCall&&<ItemCreateForm key={[newItem.item_code,newItem.item_name,newItem.unit].join('|')} call={createCall} initial={newItem} onCreated={async()=>{await onCatalogCreated?.();setNewItem(null);}}/>}
    {book&&<><label>ورقة العمل<select className="border rounded p-2 bg-background" value={sheet} onChange={e=>{setSheet(e.target.value);setOverrides(null);}}>{book.SheetNames.map(name=><option key={name}>{name}</option>)}</select></label><p>{filename} | الفرع المستهدف: {branchName}</p></>}
    {parsed&&('error'in parsed?<p role="alert">{parsed.error}</p>:<>
      <p role="status">جاهز: {parsed.rows.length} | أخطاء تحتاج مراجعة: {parsed.issues.length} | مكرر مطابق: {parsed.duplicates} | بدون كميات: {parsed.skipped} | صفوف فروع أخرى مستبعدة: {parsed.excluded}</p>
      {parsed.ignoredIssues>0&&<p>تم تجاهل المنصرف في {parsed.ignoredIssues} صف لأن النوع «تحديث رصيد فقط».</p>}
      <details><summary>الأعمدة المكتشفة وتعديلها</summary><div className="grid md:grid-cols-3 gap-2">{(['code','name','unit','balance','issued','location']as const).map(field=><label key={field}>{{code:'الكود',name:'الاسم',unit:'الوحدة',balance:'الرصيد',issued:'المنصرف',location:'الصيدلية'}[field]}<select className="block border rounded p-2 bg-background" value={parsed.format.columns[field]} onChange={e=>setOverrides({...parsed.format,columns:{...parsed.format.columns,[field]:Number(e.target.value)}})}><option value={-1}>غير موجود</option>{parsed.format.headers.map((header,index)=><option key={index} value={index}>{index+1}: {header}</option>)}</select></label>)}</div></details>
      {parsed.issues.length>0&&<ul role="alert" className="max-h-48 overflow-auto">{parsed.issues.map((issue,index)=><li key={index}>صف {issue.row}: {issue.message}</li>)}</ul>}
      {parsed.unknownItems.length>0&&<div className="border rounded p-3"><p>أصناف جديدة تحتاج تعريفًا قبل حفظ الملف. لا يتم إنشاء أصناف أو تغيير وحدات تلقائيًا.</p>{createCall?parsed.unknownItems.slice(0,20).map(item=><button type="button" className="border rounded p-2 m-1" key={item.row} disabled={disabled||busy} onClick={()=>setNewItem(item)}>تعريف {item.item_name} ({item.unit})</button>):<p>اطلب من مسؤول القاموس تعريف الأصناف ثم أعد قراءة الملف.</p>}</div>}
      <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>المنصرف</th></tr></thead><tbody>{parsed.rows.map(row=><tr key={row.item_code}><td>{row.item_code}</td><td>{row.item_name}</td><td>{row.unit}</td><td>{row.balance}</td><td>{row.issued??'لا يضاف'}</td></tr>)}</tbody></table></div>
      <button className="border rounded px-4 py-2 bg-primary text-primary-foreground disabled:opacity-50" disabled={disabled||busy||!!parsed.issues.length||!parsed.rows.length} onClick={()=>{if(confirm(`استبدال مسودة التقرير بـ ${parsed.rows.length} صنف لفرع ${branchName}؟`))onRows(parsed.rows);}}>استخدام بيانات الملف في التقرير</button>
    </>)}
  </section>;
}
