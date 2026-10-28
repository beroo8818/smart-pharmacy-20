import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, tokenStore, type Movement, type UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, fmtMonth, fmtNum, KIND_CLASS, KIND_LABEL, normalize, isMainLocation, type AnalysisRow } from "@/lib/desktopAnalytics";
import { loadContinuousAnalysis, type ProjectedRow } from "@/lib/continuousAnalysis";
import { classifyStatus } from "@/lib/statusRules";
import ItemIdentity from "@/components/ItemIdentity";
import {useInventoryRevision} from '../../../shared/useLiveInventory';

export default function Items() {
  const revision=useInventoryRevision();
  const [searchParams] = useSearchParams();
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [batchId, setBatchId] = useState(searchParams.get("batch") || "");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [current, setCurrent] = useState<ProjectedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(30);
  const [kind, setKind] = useState("all");
  const [scope, setScope] = useState("branches");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const token = tokenStore.get();
        const bs = await api.queries.listBatches({ token });
        if (!bs.ok) throw new Error("تعذر قراءة الملفات");
        if (!cancelled) setBatches(bs.batches || []);
        if (batchId) {
          const data = await api.queries.movementsByBatch({ token, batchId });
          if (!data.ok) throw new Error("تعذر قراءة بيانات الملف");
          if (!cancelled) setMovements(data.movements || []);
        } else {
          const data = await loadContinuousAnalysis({ targetDays: target });
          if (!cancelled) setCurrent(data.rows);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "تعذر قراءة البيانات");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [batchId, target, revision]);

  const rows = useMemo(() => batchId ? analyzeMovements(movements, target) : current, [batchId, movements, current, target]);
  const locations = useMemo(() => Array.from(new Set(rows.filter((r) => !isMainLocation(r.locationType)).map((r) => r.locationName))), [rows]);
  const scoped = useMemo(() => {
    if (scope.startsWith("branch:")) return rows.filter((r) => r.locationName === scope.slice(7));
    const groups = new Map<string, AnalysisRow[]>();
    for (const row of rows) {
      const list = groups.get(row.itemKey) || [];
      list.push(row); groups.set(row.itemKey, list);
    }
    return Array.from(groups.values()).flatMap((list) => {
      const branches = list.filter((r) => !isMainLocation(r.locationType));
      const selected = scope === "main" ? list.filter((r) => isMainLocation(r.locationType)) : scope === "hospital" ? list : branches;
      if (!selected.length) return [];
      const adc = branches.reduce((sum, r) => sum + r.adc, 0);
      const balance = selected.reduce((sum, r) => sum + r.balance, 0);
      const days = adc > 0 ? balance / adc : null;
      const dates = new Set(selected.map((r) => (r as ProjectedRow).snapshotDate).filter(Boolean));
      const incomplete = selected.some((r) => r.kind === "no_data") || dates.size > 1;
      const status = incomplete ? "no_data" : classifyStatus({ balance, issued: adc * 30, days, targetDays: target, locationType: scope === "branches" ? "sub_pharmacy" : "main_warehouse" });
      return [{ ...selected[0], hasBalance: selected.every((row) => !("hasBalance" in row) || row.hasBalance), balance, adc, days: incomplete ? null : days, issued: adc * 30, kind: status,
        locationName: scope === "main" ? "المخزن الرئيسي" : scope === "hospital" ? "إجمالي المستشفى" : "إجمالي الصيدليات الفرعية",
        tradeNames: Array.from(new Set(selected.flatMap((r) => r.tradeNames))),
        why: incomplete ? "بيانات ناقصة أو أرصدة بتواريخ مختلفة؛ راجع التفاصيل." : "التغطية محسوبة من استهلاك الفروع فقط." }];
    });
  }, [rows, scope, target]);
  const filtered = scoped.filter((r) => (kind === "all" || r.kind === kind) && normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode} ${r.locationName}`).includes(normalize(q)));
  const summary = useMemo(() => scoped.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {} as Record<string, number>), [scoped]);

  return <div className="p-6 space-y-5">
    <header>
      <h1 className="text-2xl font-bold">تحليل الأصناف</h1>
      <p className="text-sm text-muted-fg mt-1">أرصدة كل صنف على حدة، بنفس الوحدة. إجمالي المستشفى = المخزن + الفروع.</p>
    </header>
    <section className="card p-5 grid md:grid-cols-3 gap-3 items-end">
      <label><span className="label">مصدر البيانات</span>
        <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          <option value="">آخر رصيد لكل صنف وموقع</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{fmtMonth(b.month)} - {b.file_name}</option>)}
        </select>
      </label>
      <label><span className="label">نطاق العرض</span>
        <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="branches">إجمالي الصيدليات الفرعية</option>
          <option value="main">المخزن الرئيسي</option>
          <option value="hospital">إجمالي المستشفى</option>
          {locations.map((name) => <option key={name} value={`branch:${name}`}>{name}</option>)}
        </select>
      </label>
      <label><span className="label">هدف التغطية بالأيام</span><input className="input" type="number" min={1} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 30))} /></label>
      <label><span className="label">الحالة</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="label">بحث</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الصنف أو الموقع" /></label>
    </section>
    <p className="text-xs text-muted-fg">الرصيد المسجل منفصل عن التوقع. اختلاف تواريخ التحديث أو نقص البيانات يمنع اعتبار التغطية مؤكدة. افتح الصنف لمراجعة المواقع.</p>
    {error ? <div role="alert" className="card p-4 text-danger">{error}</div> : loading ? <div className="text-muted-fg">جارٍ التحميل...</div> : !rows.length ? <div className="card p-8 text-center">لا توجد بيانات محفوظة. ابدأ من صفحة رفع البيانات.</div> : <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Object.entries(KIND_LABEL).slice(0, 5).map(([k, v]) => <div key={k} className="card p-3"><div className="text-xs text-muted-fg">{v}</div><div className="text-xl font-bold">{fmtNum(summary[k] || 0)}</div></div>)}</div>
      <section className="card overflow-hidden">
        <div className="overflow-auto max-h-[62vh]"><table className="w-full text-xs">
          <thead className="bg-muted text-muted-fg sticky top-0"><tr><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الموقع</th><th className="p-2">الرصيد المسجل</th><th className="p-2">متوسط الصرف اليومي</th><th className="p-2">أيام التغطية</th><th className="p-2">الحالة</th><th className="p-2 text-right">ملاحظات</th></tr></thead>
          <tbody>{filtered.map((r) => <tr key={r.key} className="border-b border-border/60">
            <td className="p-2"><Link className="text-primary underline" to={`/items/${encodeURIComponent(r.itemKey)}`}><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} /></Link></td>
            <td className="p-2">{r.locationName}</td><td className="p-2 text-center">{("hasBalance" in r && !r.hasBalance) ? "غير مسجل" : fmtNum(r.balance)}</td>
            <td className="p-2 text-center">{fmtNum(r.adc, 2)}</td><td className="p-2 text-center">{r.days == null ? "-" : fmtNum(r.days, 1)}</td>
            <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
            <td className="p-2">{r.why}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>}
  </div>;
}
