import {useCallback,useMemo,useState} from 'react';
import {useLiveInventory} from '../useLiveInventory';
import InventoryRefreshStatus from './InventoryRefreshStatus';
import {csvCell,type ReportStock} from '../operationalReports';
import {todayISO} from '../inventoryHistory';
const labels:Record<string,string>={critical:'خطر شديد',danger:'نقص متوقع',below:'أقل من الهدف',over:'زيادة',very_over:'زيادة كبيرة',deadstock:'بدون منصرف مسجل',no_data:'بيانات تحتاج مراجعة',safe:'ضمن الهدف'};
export default function StockAlerts({load,local=false,canExport=true}:{load:(options:{monthsWindow:number;targetDays:number})=>Promise<{rows:ReportStock[]}>;local?:boolean;canExport?:boolean}){
  const [basis,setBasis]=useState('recorded');
  const [months,setMonths]=useState(3),[target,setTarget]=useState(30),[query,setQuery]=useState(''),[site,setSite]=useState('all'),[kind,setKind]=useState('all');
  const loader=useCallback(()=>load({monthsWindow:months,targetDays:target}),[load,months,target]);
  const {data,error,loading,updatedAt}=useLiveInventory(loader);
  const rows=useMemo(()=>(data?.rows||[]).map(r=>({...r,kind:basis==='projected'?r.projectedKind||'no_data':r.kind})),[data,basis]);
  const sites=[...new Set(rows.map(r=>r.locationName))].sort();
  const selected=useMemo(()=>rows.filter(r=>r.kind!=='safe'&&(kind==='all'||r.kind===kind)&&(site==='all'||r.locationName===site)&&`${r.itemName} ${r.itemCode||''} ${r.locationName}`.toLowerCase().includes(query.toLowerCase())),[rows,kind,site,query]);
  const cell=(v:number|null|undefined)=>v==null?'غير متاح':v.toLocaleString('ar-EG',{maximumFractionDigits:1});
  const link=(path:string)=>(local?'#':'')+path;
  function exportRows(){const lines=[['تنبيهات المخزون',todayISO(),basis==='projected'?'حالة متوقعة تقديرية':'حالة حسب المسجل'],['آخر حساب ناجح',updatedAt?.toISOString()||''],['الصنف','الكود','الموقع','الوحدة','تاريخ الرصيد','الرصيد المسجل','الرصيد المتوقع','تغطية مسجلة','تغطية متوقعة','الحالة'],...selected.map(r=>[r.itemName,r.itemCode||'',r.locationName,r.unit||'',r.snapshotDate,r.hasBalance?r.balance:null,r.hasBalance?r.projectedBalance??null:null,r.days??null,r.projectedDays??null,labels[r.kind]||r.kind])];const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='stock-alerts-'+todayISO()+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <div className="p-6 space-y-5" dir="rtl"><h1 className="text-2xl font-bold">التنبيهات</h1>
    <p>متابعة حسب الرصيد المسجل والحركات الفعلية. التغطية المتوقعة تقدير منفصل، وليست جردًا مؤكدًا.</p>
    <InventoryRefreshStatus updatedAt={updatedAt} loading={loading}/>
    <div className="flex gap-3 flex-wrap"><a className="underline" href={link('/report-center')}>تقارير النقص والمخزن والمستشفى</a><a className="underline" href={link('/alerts/advanced')}>العرض المتقدم السابق</a><a className="underline" href={link('/workflows')}>خطوات الشغل</a></div>
    <section className="border rounded p-4 grid md:grid-cols-3 gap-3">
      <label>أساس حالة التنبيه<select className="border rounded p-2 w-full bg-background" value={basis} onChange={e=>setBasis(e.target.value)}><option value="recorded">الرصيد المسجل مع الحركات</option><option value="projected">الرصيد المتوقع اليوم - تقديري</option></select></label>
      <label>نافذة الاستهلاك<select className="border rounded p-2 w-full bg-background" value={months} onChange={e=>setMonths(Number(e.target.value))}><option value={1}>آخر شهر مسجل</option><option value={3}>آخر 3 أشهر مسجلة</option><option value={6}>آخر 6 أشهر مسجلة</option></select></label>
      <label>هدف التغطية (يوم)<input className="border rounded p-2 w-full bg-background" type="number" min={1} value={target} onChange={e=>setTarget(Math.max(1,Number(e.target.value)||30))}/></label>
      <label>الصيدلية أو المخزن<select className="border rounded p-2 w-full bg-background" value={site} onChange={e=>setSite(e.target.value)}><option value="all">كل المواقع المتاحة</option>{sites.map(name=><option key={name}>{name}</option>)}</select></label>
      <label>الحالة<select className="border rounded p-2 w-full bg-background" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">كل الحالات التي تحتاج متابعة</option>{Object.entries(labels).filter(([k])=>k!=='safe').map(([k,t])=><option value={k} key={k}>{t}</option>)}</select></label>
      <label>اسم الصنف أو الكود<input className="border rounded p-2 w-full bg-background" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </section>
    <div className="flex gap-4 flex-wrap"><span>تحت الهدف: {rows.filter(r=>['critical','danger','below'].includes(r.kind)).length}</span><span>بيانات تحتاج مراجعة: {rows.filter(r=>r.kind==='no_data').length}</span><span>صفوف العرض: {selected.length}</span></div>
    <p className="text-sm">لا تجمع كميات أصناف أو وحدات مختلفة. اختلاف تواريخ الرصيد أو نقصه لا يعتبر أمانًا. التوقع لا يسجل حركة منصرف. عند وجود منصرف فعلي غير محدد التغطية الزمنية يتوقف الخصم التقديري لتجنب التكرار؛ راجع تفاصيل الصنف.</p>
    {error&&<p role="alert">{error}</p>}
    {canExport&&<button className="border rounded p-2" disabled={loading||!!error} onClick={exportRows}>تصدير التنبيهات إلى Excel عبر CSV</button>}
    {loading?<p>جارٍ تحميل البيانات...</p>:!error&&<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['الصنف','الموقع','تاريخ الرصيد','الرصيد المسجل','تغطية مسجلة (يوم)','تغطية متوقعة (يوم)','الحالة'].map(t=><th className="text-right border-b p-2" key={t}>{t}</th>)}</tr></thead><tbody>{selected.map(r=><tr key={r.key}><td className="border-b p-2"><a className="underline" href={link('/items/'+encodeURIComponent(r.itemKey))}>{r.itemName}</a><div>{r.itemCode} | {r.unit||'وحدة غير مؤكدة'}</div></td><td className="border-b p-2">{r.locationName}</td><td className="border-b p-2">{r.snapshotDate||'غير مسجل'}</td><td className="border-b p-2">{r.hasBalance?cell(r.balance):'غير مؤكد'}</td><td className="border-b p-2">{cell(r.days)}</td><td className="border-b p-2">{cell(r.projectedDays)}</td><td className="border-b p-2">{labels[r.kind]}<div>{r.ledgerWarnings?.join('؛ ')}</div></td></tr>)}</tbody></table>{!selected.length&&<p>لا توجد صفوف مطابقة للعرض؛ هذا لا يثبت اكتمال بيانات المستشفى.</p>}</div>}
  </div>;
}
