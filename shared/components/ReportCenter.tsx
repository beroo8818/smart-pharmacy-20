import { useMemo, useState } from "react";
import {useLiveInventory} from '../useLiveInventory';
import InventoryRefreshStatus from './InventoryRefreshStatus';
import TablePagination,{usePagedRows} from './TablePagination';
import {analysisSource} from '../analysisSource';
import {reportingFreshness,type ReportingLocation} from '../reportingFreshness';
const noFreshness=async()=>null;
import { buildOperationalReport, csvCell, type ReportStock } from "../operationalReports";
import { previousMonth, todayISO } from "../inventoryHistory";
import {buildShortageReport,type ShortageKind} from '../shortageReports';

export const REPORT_TITLES: Record<string,string> = { balance: 'آخر رصيد مسجل', consumption: 'المنصرف الشهري الفعلي', shortages: 'الأصناف المهددة بالنفاد', quality: 'بيانات تحتاج مراجعة',hospital30:'المستشفى: أقل من 30 يومًا',warehouse30:'المخزن: أقل من 30 يومًا',warehouse14:'المخزن: أقل من 14 يومًا',zero_demand:'نافد مع استمرار الاحتياج',insufficient:'بيانات غير كافية لحساب التغطية' };
const titles=REPORT_TITLES;
const numberFormat=new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2});
export default function ReportCenter({ load,initialKind='balance',canExport=true,canPrint=true,local=false,loadFreshness }: { load: () => Promise<ReportStock[]>;initialKind?:string;canExport?:boolean;canPrint?:boolean;local?:boolean;loadFreshness?:()=>Promise<{locations:ReportingLocation[];completeScope:boolean}> }) {
  const {data,error,loading,updatedAt}=useLiveInventory(load);
  const freshness=useLiveInventory(loadFreshness||noFreshness);
  const lateSites=reportingFreshness(freshness.data?.locations||[]).filter(l=>l.late);
  const completenessWarning=!loadFreshness?'':freshness.error||freshness.loading?'لم يكتمل التحقق من حداثة تقارير المواقع':!freshness.data?.completeScope?'نطاق الحساب لا يثبت اكتمال المستشفى':lateSites.length?'تقارير مواقع متأخرة أو غير مسجلة؛ التغطية غير مؤكدة':'';
  const rows=useMemo(()=>data||[],[data]);
  const [basis,setBasis]=useState<'recorded'|'projected'>('recorded');
  const [kind, setKind] = useState(initialKind), [scope, setScope] = useState('branches'), [query, setQuery] = useState(''), [aggregate, setAggregate] = useState(false);
  const [from, setFrom] = useState(previousMonth(todayISO())), [to, setTo] = useState(previousMonth(todayISO()));
  const records = useMemo(() => buildOperationalReport(rows, { kind, scope, query, aggregate, from, to }), [rows, kind, scope, query, aggregate, from, to]);
  const coverage=['hospital30','warehouse30','warehouse14','zero_demand','insufficient'].includes(kind);
  const coverageRows=useMemo(()=>coverage?buildShortageReport(rows,kind as ShortageKind,query,basis,completenessWarning):[],[rows,kind,query,coverage,basis,completenessWarning]);
  const columns=coverage?['الصنف','الكود','الموقع','الوحدة','تواريخ الرصيد',basis==='projected'?'الرصيد المتوقع - تقديري':'الرصيد المسجل','رصيد المخزن حسب الأساس','رصيد الفروع حسب الأساس','رصيد المستشفى حسب الأساس','متوسط يومي','متوسط شهري معياري 30 يومًا',basis==='projected'?'تغطية متوقعة (يوم)':'تغطية مسجلة (يوم)','الحد (يوم)','كمية استكمال الهدف، تقريب لأعلى','جودة البيانات']:['الصنف','الكود','الموقع','الوحدة',kind==='consumption'?'فترة المنصرف':'تاريخ الرصيد','الكمية','جودة البيانات'];
  const values=useMemo(()=>coverage?coverageRows.map(r=>[r.item,r.code,r.location,r.unit,r.period,r.balance,r.warehouseBalance,r.branchesBalance,r.hospitalBalance,r.adc,r.monthlyNeed,r.days,r.threshold,r.needed,r.state]):records.map(r=>[r.item,r.code,r.location,r.unit,r.period,r.quantity,r.state]),[coverage,coverageRows,records]);
  const paging=usePagedRows(values);
  const sites = useMemo(()=>[...new Set(rows.map((r) => r.locationName))].sort(),[rows]);
  function download() {
    if(!canExport)return;
    const lines = [[titles[kind]], ['مصدر التحليل',analysisSource()==='latest_file'?'آخر ملف محفوظ فقط وحركات أصنافه؛ ليس كامل المستشفى':'كل الرفعات المحفوظة؛ آخر رصيد معروف لكل صنف وموقع'], ['تاريخ استخراج التقرير',todayISO()],['آخر حساب ناجح',updatedAt?.toISOString()||''],['أساس الحساب',coverage&&basis==='projected'?'متوقع تقديري لليوم وليس حركة منصرف':'مسجل فعلي مع الحركات'], ['التغطية','المواقع والأصناف المتاحة لحساب المستخدم فقط؛ الغائب ليس صفرًا'], columns,...values];
    const blob = new Blob(['\uFEFF' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download=`hospital-${kind}-${todayISO()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return <div className="p-6 space-y-5" dir="rtl"><h1 className="text-2xl font-bold">مركز التقارير</h1>
    <p>تقرير حسب النوع والصيدلية والصنف. الأرصدة هي آخر مسجل لكل موقع، والمنصرف يخص الأشهر المختارة فعلًا، وليس متوسط 30 يومًا.</p>
    <InventoryRefreshStatus updatedAt={updatedAt} loading={loading}/>
    <p className="border p-3">إجمالي الأرقام وحده لا يثبت اكتمال تقارير كل الصيدليات. <a className="underline" href={(local?'#':'')+'/data-freshness'}>راجع الصيدليات المتأخرة والتقارير غير المسجلة</a>.</p>
    {loadFreshness&&<p className="border p-3">متابعة المواقع حاليًا، بمعيار 35 يومًا للتقرير الكامل، وليس اكتمال شهر تاريخي محدد: {freshness.error?'تعذر التحقق من تقارير الصيدليات':freshness.loading?'جارٍ التحقق...':`${lateSites.length} موقع متأخر أو بدون تقرير كامل`}. {completenessWarning||'التواريخ داخل المدة؛ لا يعتبر هذا إثباتًا لاكتمال كل أصناف كل ملف.'}</p>}
    <div className="flex flex-wrap gap-2 print:hidden">{['hospital30','warehouse30','warehouse14','zero_demand','insufficient'].map(key=><button key={key} className="border rounded p-2" onClick={()=>setKind(key)}>{titles[key]}</button>)}</div>
    <section className="grid md:grid-cols-3 gap-3 p-4 border rounded print:hidden">
      <label>نوع التقرير<select className="border rounded p-2 w-full bg-background" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(titles).map(([key,title]) => <option key={key} value={key}>{title}</option>)}</select></label>
      {coverage&&<label>أساس حساب التغطية<select className="border rounded p-2 w-full bg-background" value={basis} onChange={e=>setBasis(e.target.value as 'recorded'|'projected')}><option value="recorded">الرصيد المسجل مع الحركات</option><option value="projected">الرصيد المتوقع اليوم - تقديري</option></select></label>}
      {!coverage&&<label>النطاق<select className="border rounded p-2 w-full bg-background" value={scope} onChange={(e) => setScope(e.target.value)}><option value="branches">الفروع المتاحة لحسابي</option><option value="warehouse">المخزن المتاح لحسابي</option><option value="hospital">كل المواقع المتاحة لحسابي</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label>}
      <label>اسم الصنف أو الكود<input className="border rounded p-2 w-full bg-background" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      {kind === 'consumption' && <><label>من شهر<input className="border rounded p-2 w-full bg-background" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>إلى شهر<input className="border rounded p-2 w-full bg-background" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></label></>}
      {!coverage&&<label><input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} /> تجميع الصنف بنفس الوحدة عبر المواقع المختارة</label>}
    </section>
    {error && <p role="alert">{error}</p>}{kind === 'consumption' && from > to && <p role="alert">شهر البداية يجب ألا يكون بعد شهر النهاية.</p>}
    <section className="border rounded p-4 space-y-2"><h2 className="font-bold">{titles[kind]}</h2><p>تاريخ الاستخراج: {todayISO()} | صفوف التقرير: {values.length} | النطاق: {coverage?'تجميع الصنف بنفس الوحدة عبر المواقع المتاحة':scope === 'branches' ? 'الفروع المتاحة' : scope === 'warehouse' ? 'المخزن المتاح' : scope === 'hospital' ? 'المواقع المتاحة' : scope}</p>
      {coverage&&<p>أساس الحساب: {basis==='projected'?'متوقع تقديري لليوم، وليس جردًا أو حركة منصرف':'مسجل فعلي مع الحركات'}. التغطية = الرصيد المختار ÷ مجموع متوسط منصرف الفروع. لا يفترض التوقع تحويلًا من المخزن للفروع، ولا يخصم استهلاك الفروع من المخزن مرة ثانية. نقص البيانات يظهر للمراجعة. الحدود أقل من 30 أو 14، وليس أقل من أو يساوي.</p>}
      {kind === 'consumption' ? <p>الأشهر المختارة: {from} إلى {to}. راجع نطاق الأيام بكل صف؛ قد تكون فترة جزئية. صرف المخزن للفروع مستبعد من إجمالي المنصرف.</p> : <p>لا يوجد تاريخ جرد موحد مفترض. راجع تاريخ كل رصيد؛ هذا التقرير ليس إعادة بناء لرصيد تاريخ قديم.</p>}
      <p>اكتمال البيانات نسبي للأصناف والمواقع المعروفة، وليس إثباتًا بأن جميع صيدليات المستشفى أبلغت. لا تُجمع وحدات مختلفة، ولا تتحول القيم الغائبة إلى صفر.</p>
    </section>
    <div className="flex gap-3 print:hidden">{canExport&&<button className="border rounded p-2" disabled={loading || !!error} onClick={download}>تصدير CSV يفتح في Excel</button>}{canPrint&&<button className="border rounded p-2" disabled={loading || !!error} onClick={() => window.print()}>طباعة</button>}</div>
    {!loading&&!error&&<TablePagination {...paging}/>}
    {loading ? <p>جارٍ تحميل البيانات...</p> : !error&&<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{columns.map(title=><th className="p-3 text-right border-b" key={title}>{title}</th>)}</tr></thead><tbody>{paging.visible.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j} className="p-3 border-b">{value==null?'غير متاح':typeof value==='number'?numberFormat.format(value):value}</td>)}</tr>)}</tbody></table>{!values.length && <p className="p-5">لا توجد بيانات مطابقة. تحقق من الفترة والصلاحية، ولا تعتبر ذلك منصرفًا صفرًا.</p>}</div>}
    <style>{'@media print { aside, nav { display:none !important; } main { overflow:visible !important; } table { border-collapse:collapse; } thead { display:table-header-group; } tr { break-inside:avoid; } }'}</style>
  </div>;
}
