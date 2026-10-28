import {useMemo,useState,type ReactNode} from 'react';
import {useLiveInventory} from '../useLiveInventory';
import {DECISION_LABEL,type DecisionStatus,type RecommendationAction} from '../recommendationActions';
import {csvCell} from '../operationalReports';
export default function ActionLog({load,canExport=false,extra}:{load:()=>Promise<RecommendationAction[]>;canExport?:boolean;extra?:ReactNode}){
 const {data,error,loading}=useLiveInventory(load),rows=error?[]:data||[];
 const [query,setQuery]=useState(''),[status,setStatus]=useState(''),[visible,setVisible]=useState(200);
 const filtered=useMemo(()=>rows.filter(r=>(!status||r.status===status)&&[r.item_name,r.item_code,r.from_location,r.to_location,r.note,r.actor_name].join(' ').toLowerCase().includes(query.trim().toLowerCase())),[rows,query,status]);
 const counts=Object.fromEntries(Object.keys(DECISION_LABEL).map(key=>[key,rows.filter(r=>r.status===key).length]));
 function download(){
  if(error||loading||!canExport)return;
  const lines=[['التاريخ','الحالة','الصنف','الكود','الوحدة','من','إلى','مقترح','منفذ','المستخدم','المصدر','التاريخ الأصلي','ملاحظة'],...filtered.map(r=>[r.acted_at,DECISION_LABEL[r.status],r.item_name,r.item_code||'',r.unit||'غير مؤكدة',r.from_location,r.to_location,r.suggested_qty,r.executed_qty,r.actor_name||r.acted_by,r.source||'current',r.original_at||'',r.override_reason||r.note])];
  const blob=new Blob(['\ufeff'+lines.map(row=>row.map(v=>csvCell(v??null)).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='dawa-actions.csv';link.click();URL.revokeObjectURL(url);
 }
 return <div className="p-6 space-y-4" dir="rtl"><h1 className="text-2xl font-bold">سجل القرارات والإجراءات</h1>
 <p>الحالات توثيق للقرارات فقط؛ تسجيل «منفذ» هنا لا يخصم رصيدًا ولا ينشئ تحويلًا. حركة المخزون تسجل مرة واحدة من سجل الحركات.</p>
 {extra}
 <div className="flex flex-wrap gap-3">{Object.entries(DECISION_LABEL).map(([key,label])=><p className="border rounded p-3" key={key}>{label}: {counts[key]||0}</p>)}</div>
 <div className="flex flex-wrap gap-3"><label>بحث<input className="border rounded p-2 mx-2" value={query} onChange={e=>{setQuery(e.target.value);setVisible(200);}}/></label><label>الحالة<select className="border rounded p-2 mx-2" value={status} onChange={e=>{setStatus(e.target.value);setVisible(200);}}><option value="">كل الحالات</option>{Object.entries(DECISION_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{canExport&&<button disabled={loading||!!error} onClick={download} className="border rounded p-2">تصدير السجل CSV</button>}</div>
 {error?<p role="alert">تعذر تحديث السجل: {error}</p>:loading?<p>جارٍ تحديث السجل...</p>:!filtered.length?<p>لا توجد قرارات محفوظة ضمن نطاقك.</p>:<><p>عرض {Math.min(visible,filtered.length)} من {filtered.length} سجلًا. التصدير يشمل كل نتائج البحث المتاحة.</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['التاريخ','الحالة','الصنف','الوحدة','من','إلى','مقترح','منفذ','المستخدم','المصدر','ملاحظة'].map(h=><th className="p-2 border text-right" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice(0,visible).map(r=><tr key={r.id}>
 <td className="p-2 border whitespace-nowrap">{new Date(r.acted_at).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</td><td className="p-2 border">{DECISION_LABEL[r.status as DecisionStatus]||'حالة قديمة'}</td><td className="p-2 border">{r.item_name||r.item_code||'غير مسجل'}</td><td className="p-2 border">{r.unit||'غير مؤكدة'}</td><td className="p-2 border">{r.from_location||'-'}</td><td className="p-2 border">{r.to_location||'-'}</td><td className="p-2 border">{r.suggested_qty??'غير مسجل'}</td><td className="p-2 border">{r.executed_qty??'غير مسجل'}</td><td className="p-2 border">{r.actor_name||r.acted_by.slice(0,8)}</td><td className="p-2 border">{r.source==='legacy_local'?'قديم مستورد؛ المؤلف الأصلي غير مثبت':'مسجل في القاعدة'}{r.original_at&&<small className="block">{r.original_at}</small>}</td><td className="p-2 border">{r.override_reason||r.note||'-'}</td>
 </tr>)}</tbody></table></div>{visible<filtered.length&&<button className="border rounded p-2" onClick={()=>setVisible(v=>v+200)}>عرض 200 سجل إضافي</button>}</>}
 </div>;
}
