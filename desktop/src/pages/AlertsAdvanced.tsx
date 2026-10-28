
import { useCallback, useMemo, useState } from "react";
import {useLiveInventory} from '../../../shared/useLiveInventory';
import { type UploadBatch } from "@/integrations/desktop/client";
import { fmtMonth, fmtNum, KIND_CLASS, KIND_LABEL, normalize } from "@/lib/desktopAnalytics";
import { loadContinuousAnalysis, CONFIDENCE_LABEL, CONFIDENCE_CLASS, type ProjectedRow } from "@/lib/continuousAnalysis";
import { useNavigate } from "react-router-dom";
import ItemIdentity from "@/components/ItemIdentity";

export default function Alerts() {
  const navigate = useNavigate();
  const [monthsWindow, setMonthsWindow] = useState(3);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(30);
  const [severity, setSeverity] = useState("all");
  const [location, setLocation] = useState("all");
  const loader=useCallback(()=>loadContinuousAnalysis({monthsWindow,targetDays:target}),[monthsWindow,target]);
  const {data,loading,error}=useLiveInventory(loader);
  const batch=data?.latestBatch||null,rows=data?.rows||[],preliminary=data?.preliminary||false;
  const alerts = useMemo(()=>rows.filter(r=>r.kind!=="safe"),[rows]);
  const locations = useMemo(()=>Array.from(new Set(alerts.map(a=>a.locationName))).sort(),[alerts]);
  const filtered = alerts.filter(r=>(severity==="all"||r.severity===severity)&&(location==="all"||r.locationName===location)&&normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.locationName}`).includes(normalize(q)));
  const counts = { high: alerts.filter(a=>a.severity==="high").length, medium: alerts.filter(a=>a.severity==="medium").length, low: alerts.filter(a=>a.severity==="low").length };
  if(error)return <p role="alert" className="p-6">تعذر تحديث التنبيهات: {error}.</p>;
  return <div className="p-6 space-y-5">
    <header className="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold">التنبيهات</h1>
        <p className="text-sm text-muted-fg mt-1">الأصناف التي تحتاج متابعة بناءً على الرصيد المتوقع لليوم.</p>
      </div>
      <label className="text-sm flex items-center gap-2">
        <span className="text-muted-fg">نافذة:</span>
        <select className="input py-1" value={monthsWindow} onChange={(e) => setMonthsWindow(Number(e.target.value))}>
          <option value={1}>آخر شهر</option><option value={3}>آخر 3 شهور</option><option value={6}>آخر 6 شهور</option>
        </select>
      </label>
    </header>
    {preliminary && <div className="text-xs p-2 rounded border border-warn/30 bg-warn-soft text-warn">تنبؤ مبدئي — يحتاج بيانات أشهر إضافية.</div>}
    <section className="card p-5 grid md:grid-cols-4 gap-3 items-end">
      <label><span className="label">هدف التغطية</span><input className="input" type="number" value={target} onChange={e=>setTarget(Number(e.target.value)||30)} /></label>
      <label><span className="label">الخطورة</span><select className="input" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">كل الدرجات</option><option value="high">عالية</option><option value="medium">متوسطة</option><option value="low">منخفضة</option></select></label>
      <label><span className="label">الصيدلية / المخزن</span><select className="input" value={location} onChange={e=>setLocation(e.target.value)}><option value="all">كل المواقع</option>{locations.map(l=><option key={l} value={l}>{l}</option>)}</select></label>
      <label><span className="label">بحث</span><input className="input" value={q} onChange={e=>setQ(e.target.value)} placeholder="صنف أو صيدلية" /></label>
    </section>
    {loading ? <div className="card p-8 text-center text-muted-fg">جارٍ التحميل...</div>
      : !batch ? <div className="card p-8 text-center">لا توجد بيانات محفوظة.</div>
      : <>
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4"><div className="text-xs text-muted-fg">عالية</div><div className="text-xl font-bold text-danger">{fmtNum(counts.high)}</div></div>
          <div className="card p-4"><div className="text-xs text-muted-fg">متوسطة</div><div className="text-xl font-bold text-warn">{fmtNum(counts.medium)}</div></div>
          <div className="card p-4"><div className="text-xs text-muted-fg">منخفضة</div><div className="text-xl font-bold">{fmtNum(counts.low)}</div></div>
        </div>
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border flex justify-between gap-3 text-sm">
            <span>آخر ملف: {batch.file_name} — رصيد {batch.snapshot_date || fmtMonth(batch.month)}</span>
            <button className="btn-outline py-1" onClick={()=>navigate(`/transfers`)}>عرض التحويلات</button>
          </div>
          <div className="overflow-auto max-h-[62vh]">
            <table className="w-full text-xs">
              <thead className="bg-muted text-muted-fg sticky top-0">
                <tr><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الموقع</th><th className="p-2">الحالة</th><th className="p-2">الثقة</th><th className="p-2 text-right">السبب</th><th className="p-2 text-right">المطلوب</th></tr>
              </thead>
              <tbody>
                {filtered.map(r=><tr key={r.key} className="border-b border-border/60">
                  <td className="p-2"><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} /></td>
                  <td className="p-2">{r.locationName}</td>
                  <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                  <td className="p-2 text-center"><span className={`px-1.5 py-0.5 rounded text-[10px] ${CONFIDENCE_CLASS[r.confidence]}`}>{CONFIDENCE_LABEL[r.confidence]}</span></td>
                  <td className="p-2">{r.why}</td>
                  <td className="p-2">{r.action}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </>}
  </div>;
}
