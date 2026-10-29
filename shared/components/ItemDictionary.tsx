import {useCallback,useEffect,useState} from 'react';
import type {OpsCall} from '../operations';
import ItemCreateForm,{type DictionaryItem} from './ItemCreateForm';
export default function ItemDictionary({call}:{call:OpsCall}){
 const [data,setData]=useState<{items:DictionaryItem[];can_create:boolean}|null>(null),[query,setQuery]=useState(''),[error,setError]=useState('');
 const load=useCallback(async()=>{const result=await call('dictionary_list');setData(result);setError('');},[call]);
 useEffect(()=>{load().catch(error=>setError(error.message));},[load]);
 const filtered=(data?.items||[]).filter(item=>[item.item_code,item.item_name,item.unit,item.active_ingredient||''].join(' ').toLowerCase().includes(query.toLowerCase()));
 return <div className="p-6 space-y-5 max-w-[1400px]" dir="rtl"><h1 className="text-2xl font-bold">قاموس الأصناف</h1>
  <p>تعريفات الأصناف المعروفة، وليست رصيد مخزون. الصنف الجديد يظهر في التحليل بعد تسجيل رصيده ومنصرفه.</p>
  {error&&<p role="alert">{error} في الويب يلزم تطبيق تحديث قاعدة البيانات؛ لا يوجد حفظ بديل بلا تحقق.</p>}
  {data?.can_create?<ItemCreateForm call={call} onCreated={async()=>{await load();}}/>:data&&<p>إضافة الأصناف تحتاج صلاحية «تعديل تعريفات الأصناف». اطلبها من المدير.</p>}
  <label>بحث في القاموس<input className="block border rounded p-2 w-full bg-background" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  {!data&&!error?<p>جارٍ تحميل القاموس...</p>:<><p>عدد التعريفات المعروضة: {filtered.length}</p><div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm"><thead><tr>{['الكود','اسم الصنف','الوحدة','التركيز','الشكل','المادة الفعالة'].map(label=><th className="p-2 border-b text-right" key={label}>{label}</th>)}</tr></thead><tbody>{filtered.map((item,index)=><tr key={[item.item_code,item.unit,index].join('|')}>{[item.item_code,item.item_name,item.unit,item.strength,item.dosage_form,item.active_ingredient].map((value,i)=><td className="p-2 border-b" key={i}>{value||'—'}</td>)}</tr>)}</tbody></table></div></>}
 </div>;
}
