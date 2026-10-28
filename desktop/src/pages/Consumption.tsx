import { useEffect, useMemo, useState } from "react";
import { loadContinuousAnalysis, type ProjectedRow } from "@/lib/continuousAnalysis";
import { summarizeConsumption } from "../../../shared/consumptionReport";
import {consumptionPeriodLabel} from '../../../shared/inventoryHistory';

const fmt = (value: number) => value.toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function Consumption() {
  const [rows, setRows] = useState<ProjectedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [item, setItem] = useState("");
  const [month, setMonth] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadContinuousAnalysis().then((data) => {
      if (!cancelled) setRows(data.rows);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "تعذر قراءة المنصرف");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const items = useMemo(() => {
    const byItem = new Map<string, { key: string; name: string; unit: string }>();
    for (const row of rows) if (!byItem.has(row.itemKey)) byItem.set(row.itemKey, { key: row.itemKey, name: row.itemName, unit: row.unit || "وحدة غير مؤكدة" });
    return Array.from(byItem.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [rows]);
  const filteredItems = items.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedItem = filteredItems.some((entry) => entry.key === item) ? item : filteredItems[0]?.key || "";
  const months = useMemo(() => Array.from(new Set(rows.filter((row) => row.itemKey === selectedItem)
    .flatMap((row) => row.consumptionPeriods.map((period) => period.month)))).sort().reverse(), [rows, selectedItem]);
  const selectedMonth = months.includes(month) ? month : months[0] || "";
  const report = useMemo(() => summarizeConsumption(rows, selectedItem, selectedMonth), [rows, selectedItem, selectedMonth]);
  return <div className="p-6 space-y-5 max-w-[1400px]" dir="rtl">
    <header>
      <h1 className="text-2xl font-bold">منصرف الصنف على مستوى المستشفى</h1>
      <p className="text-sm text-muted-foreground mt-2">المنصرف المسجل للشهر المختار، وليس متوسط استهلاك أو توقعًا. النقل من المخزن إلى الفروع لا يدخل في هذا الإجمالي.</p>
    </header>
    {error && <div role="alert" className="p-4 border rounded text-red-700">{error}</div>}
    <section className="p-5 border rounded-lg grid md:grid-cols-3 gap-3">
      <label className="grid gap-2">بحث عن الصنف<input className="border rounded p-2 bg-background" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label className="grid gap-2">الصنف<select className="border rounded p-2 bg-background" value={selectedItem} onChange={(e) => setItem(e.target.value)}>
        {!filteredItems.length && <option value="">لا توجد أصناف</option>}
        {filteredItems.map((entry) => <option key={entry.key} value={entry.key}>{entry.name} ({entry.unit})</option>)}
      </select></label>
      <label className="grid gap-2">شهر المنصرف<select className="border rounded p-2 bg-background" value={selectedMonth} onChange={(e) => setMonth(e.target.value)}>
        {!months.length && <option value="">لا يوجد منصرف شهري مسجل</option>}
        {months.map((period) => <option key={period} value={period}>{period.slice(0, 7)}</option>)}
      </select></label>
    </section>
    {loading ? <p>جارٍ تحميل البيانات...</p> : <>
      <section className="p-5 border rounded-lg space-y-2">
        <h2 className="font-bold">إجمالي المنصرف المسجل في الفروع</h2>
        <div className="text-3xl font-bold" data-testid="hospital-issued-total">{report.total == null ? "غير متاح" : fmt(report.total)} {report.total != null && report.unit}</div>
        <p className="text-sm">الفترة: {selectedMonth ? selectedMonth.slice(0, 7) : "غير محددة"}. صيدليات لها منصرف مسجل: {fmt(report.reportedCount)} من {fmt(report.locations.length)} مواقع معروفة لهذا الصنف.</p>
        {report.total != null && !report.complete && <p role="status" className="text-amber-700">الإجمالي جزئي: توجد بيانات غير مسجلة أو غير مكتملة. لا تعتبر الخلايا الفارغة صفرًا.</p>}
        {!report.unitCompatible && report.reportedCount > 0 && <p role="status" className="text-red-700">الوحدات ناقصة أو مختلفة؛ لا يمكن جمع الكميات قبل مراجعتها.</p>}
      </section>
      <div className="overflow-auto border rounded-lg">
        <table className="w-full text-sm"><thead><tr className="border-b"><th className="text-right p-3">الصيدلية الفرعية</th><th className="text-right p-3">منصرف الشهر المختار</th><th className="text-right p-3">الوحدة</th><th className="text-right p-3">اكتمال التقرير</th></tr></thead>
          <tbody>{report.locations.map(({ row, period }) => <tr key={row.key} className="border-b">
            <td className="p-3">{row.locationName}</td>
            <td className="p-3">{period ? fmt(period.issued) : "غير مسجل"}</td>
            <td className="p-3">{row.unit || "غير مؤكدة"}</td>
            <td className="p-3">{!period ? "لم يسجل منصرف للفترة" : period.reportedSkus < period.totalSkus || period.partial ? "جزئي" : "مسجل"}{period&&<div className="text-xs">{consumptionPeriodLabel(period)}</div>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">المقصود هو منصرف الفروع المدوّن في التقارير الشهرية. لا يثبت وحده عدد الجرعات المعطاة للمرضى إذا كان يتضمن تحويلات داخلية أو تسويات غير مفصولة في المصدر.</p>
    </>}
  </div>;
}
