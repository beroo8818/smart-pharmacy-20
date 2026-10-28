import {useState} from 'react';
import {useLiveInventory} from '../useLiveInventory';
import {reportingFreshness,type ReportingLocation} from '../reportingFreshness';
import InventoryRefreshStatus from './InventoryRefreshStatus';
export default function ReportingFreshness({load}:{load:()=>Promise<{locations:ReportingLocation[];completeScope:boolean}>}){
  const {data,error,loading,updatedAt}=useLiveInventory(load);
  const [maxAge,setMaxAge]=useState(35);
  const rows=reportingFreshness(data?.locations||[],maxAge),late=rows.filter(r=>r.type==='sub_pharmacy'&&r.late),lateSites=rows.filter(r=>r.late);
  return <div className="p-6 space-y-4" dir="rtl"><h1 className="text-2xl font-bold">متابعة تحديث الصيدليات</h1>
    <InventoryRefreshStatus updatedAt={updatedAt} loading={loading}/>
    <label>الحد الأقصى لعمر تقرير الرصيد الكامل (يوم)<input className="border rounded p-2 mx-2" type="number" min={1} max={365} value={maxAge} onChange={e=>setMaxAge(Math.min(365,Math.max(1,Number(e.target.value)||35)))}/></label>
    <p>الافتراضي 35 يومًا للتقرير الشهري. تحديث أصناف حرجة فقط لا يثبت اكتمال باقي أصناف الصيدلية، ولا يغيّر تاريخ آخر تقرير كامل.</p>
    {!data?.completeScope&&<p className="border p-3">النطاق هو المواقع المسموحة لحسابك فقط، وليس إثباتًا لاكتمال المستشفى.</p>}
    {error?<p role="alert">تعذر التحقق من اكتمال البيانات: {error}</p>:loading?<p>جارٍ التحقق...</p>:<>
    <p className="border p-3">صيدليات متأخرة أو لم تقدم تقريرًا كاملًا: {late.length} من {rows.filter(r=>r.type==='sub_pharmacy').length}. مواقع متأخرة شاملة المخزن: {lateSites.length}. {lateSites.length?'لا تعتبر إجمالي المستشفى مكتمل البيانات.':'التواريخ داخل المدة، لكن ذلك لا يثبت اكتمال كل أصناف كل ملف أو مطابقته للجرد.'}</p>
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['الموقع','آخر تقرير رصيد كامل','آخر رصيد بأي نوع','آخر تحديث جزئي','نهاية آخر فترة منصرف','عمر الكامل (يوم)','الحالة'].map(x=><th className="p-2 border-b text-right" key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>{[r.name,r.last_full_balance||'غير مسجل',r.last_balance||'غير مسجل',r.last_partial_balance||'غير مسجل',r.last_consumption||'غير مسجل',r.age??'غير معروف',r.state].map((v,i)=><td className="p-2 border-b" key={i}>{v}</td>)}</tr>)}</tbody></table></div></>}
  </div>;
}
