import {useState} from 'react';
import type {OpsCall} from '../operations';
export type DictionaryItem={id?:string;item_code:string;item_name:string;unit:string;strength?:string|null;dosage_form?:string|null;active_ingredient?:string|null};
export default function ItemCreateForm({call,initial={},onCreated}:{call:OpsCall;initial?:Partial<DictionaryItem>;onCreated:(item:DictionaryItem)=>void|Promise<void>}){
 const empty={item_code:'',item_name:'',unit:'',strength:'',dosage_form:'',active_ingredient:''};
 const [value,setValue]=useState({...empty,item_code:initial.item_code||'',item_name:initial.item_name||'',unit:initial.unit||'',strength:initial.strength||'',dosage_form:initial.dosage_form||'',active_ingredient:initial.active_ingredient||''});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const labels={item_code:'كود الصنف (اختياري)',item_name:'اسم الصنف الكامل',unit:'الوحدة',strength:'التركيز (اختياري)',dosage_form:'الشكل الصيدلي (اختياري)',active_ingredient:'المادة الفعالة (اختياري)'};
 return <form className="border rounded-lg p-4 space-y-3" aria-label="إضافة صنف للقاموس" onSubmit={async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{const result=await call('dictionary_create',value);await onCreated(result.item);setMessage(result.duplicate?'الصنف موجود بالفعل؛ تم استخدام تعريفه بدون تكرار':'تم تعريف الصنف. ارفع أو راجع ملف الرصيد والمنصرف ليظهر في التحليل.');setValue(empty);}
  catch(error){setError(error instanceof Error?error.message:'تعذر إضافة الصنف');}finally{setBusy(false);}
 }}>
  <h2 className="font-bold text-lg">إضافة صنف جديد للقاموس</h2>
  <p className="text-sm">اكتب الاسم كاملًا بالتركيز والشكل. الإضافة تعريف فقط؛ لا تضيف رصيدًا أو منصرفًا. اترك الكود فارغًا لتوليده، أو اكتب نفس الكود الموجود في Excel.</p>
  <fieldset disabled={busy} className="grid md:grid-cols-2 gap-3">{(Object.keys(labels)as(keyof typeof labels)[]).map(key=><label key={key}>{labels[key]}<input className="border rounded p-2 w-full bg-background" value={value[key]} required={key==='item_name'||key==='unit'} maxLength={key==='item_name'||key==='active_ingredient'?500:key==='unit'?80:120} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}</fieldset>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <button className="border rounded px-4 py-2 bg-primary text-primary-foreground disabled:opacity-50" disabled={busy||!value.item_name.trim()||!value.unit.trim()}>{busy?'جارٍ الحفظ...':'حفظ الصنف بالقاموس'}</button>
 </form>;
}
