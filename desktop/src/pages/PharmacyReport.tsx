import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, AlertKind, AnalysisRow, fmtMonth, fmtNum, itemKey, KIND_CLASS, KIND_LABEL, loadLatestDataset, normalize } from "@/lib/desktopAnalytics";
import ItemIdentity from "@/components/ItemIdentity";

const ORDER: AlertKind[] = ["critical", "danger", "below", "safe", "over", "very_over", "deadstock", "no_data"];
const PRIORITY: Record<AlertKind, number> = {
  critical: 0, danger: 1, below: 2, no_data: 3, deadstock: 4, very_over: 5, over: 6, safe: 7,
};
const SUMMARY_KINDS: AlertKind[] = ["critical", "danger", "below", "safe", "over", "deadstock"];

export default function PharmacyReport() {
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(30);
  const [pharmacy, setPharmacy] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  useEffect(() => { (async () => {
    try {
      const { batch, movements } = await loadLatestDataset(api, tokenStore.get());
      setBatch(batch); setMovements(movements);
    } finally { setLoading(false); }
  })(); }, []);

  const rows = useMemo(() => analyzeMovements(movements, target), [movements, target]);

  // Map item -> first movement (for scientific name / unit)
  const itemMeta = useMemo(() => {
    const map = new Map<string, { sci: string; unit: string }>();
    for (const m of movements) {
      const k = itemKey(m);
      if (!map.has(k)) map.set(k, { sci: m.active_ingredient_ar || "", unit: m.unit || "" });
    }
    return map;
  }, [movements]);

  const pharmacies = useMemo(() => {
    const set = new Set<string>(); rows.forEach((r) => set.add(r.locationName));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    return rows.filter((r) => {
      if (pharmacy !== "all" && r.locationName !== pharmacy) return false;
      if (kindFilter !== "all" && r.kind !== kindFilter) return false;
      if (s) {
        const meta = itemMeta.get(r.itemKey);
        const hay = normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${meta?.sci || ""}`);
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, pharmacy, kindFilter, q, itemMeta]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const r of filtered) {
      if (!map.has(r.locationName)) map.set(r.locationName, []);
      map.get(r.locationName)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ar")).map(([name, list]) => {
      const byKind = new Map<AlertKind, typeof list>();
      for (const r of list) {
        if (!byKind.has(r.kind)) byKind.set(r.kind, []);
        byKind.get(r.kind)!.push(r);
      }
      for (const arr of byKind.values()) arr.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
      const summary: Record<string, number> = {};
      ORDER.forEach((k) => { summary[k] = (byKind.get(k) || []).length; });
      return { pharmacy: name, byKind, summary };
    });
  }, [filtered]);

  function toSheet(list: typeof filtered) {
    return list.map((r) => {
      const meta = itemMeta.get(r.itemKey);
      return {
        الصيدلية: r.locationName,
        "اسم الصنف": r.itemName,
        "الاسم التجاري": r.tradeNames.join("، "),
        "كود الصنف": r.itemCode || "",
        "المادة الفعالة": meta?.sci || "",
        الوحدة: meta?.unit || "",
        "الرصيد الحالي": r.balance,
        "المنصرف الشهري": r.issued,
        "متوسط الصرف اليومي": Number(r.adc.toFixed(2)),
        "أيام التغطية": r.days == null ? "" : Math.round(r.days),
        الحالة: KIND_LABEL[r.kind],
        السبب: r.why,
        التوصية: r.action,
      };
    });
  }
  function styleSheet(ws: XLSX.WorkSheet) {
    ws["!cols"] = [
      { wch: 22 }, { wch: 38 }, { wch: 34 }, { wch: 14 }, { wch: 28 }, { wch: 10 },
      { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
      { wch: 40 }, { wch: 40 },
    ];
    ws["!freeze"] = { xSplit: 0, ySplit: 1 } as any;
    const ref = ws["!ref"]; if (ref) ws["!autofilter"] = { ref };
    return ws;
  }
  function exportAll() {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true } as any] };
    for (const g of grouped) {
      const list = ORDER.flatMap((k) => g.byKind.get(k) || []);
      const ws = styleSheet(XLSX.utils.json_to_sheet(toSheet(list)));
      XLSX.utils.book_append_sheet(wb, ws, g.pharmacy.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "صيدلية");
    }
    XLSX.writeFile(wb, `تقرير_حالة_${pharmacy === "all" ? "كل_الصيدليات" : pharmacy}.xlsx`);
  }
  function exportSingle(name: string, list: AnalysisRow[]) {
    const sorted = [...list].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || (a.days ?? Infinity) - (b.days ?? Infinity));
    const ws = styleSheet(XLSX.utils.json_to_sheet(toSheet(sorted)));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true } as any] };
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "صيدلية");
    XLSX.writeFile(wb, `تقرير_${name}.xlsx`);
  }
  function exportCritical() {
    const list = rows.filter((r) => r.kind === "critical" || r.kind === "danger");
    const ws = styleSheet(XLSX.utils.json_to_sheet(toSheet(list)));
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true } as any] };
    XLSX.utils.book_append_sheet(wb, ws, "الأصناف الحرجة");
    XLSX.writeFile(wb, `الأصناف_الحرجة.xlsx`);
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] print:p-0">
      <style>{`@media print {
        .no-print { display: none !important; }
        body { background: white !important; }
        .card { box-shadow: none !important; border: 1px solid #ddd !important; page-break-inside: avoid; }
        .print-break { page-break-before: always; }
      }`}</style>
      <header><h1 className="text-2xl font-bold">تقرير حالة كل صيدلية</h1><p className="text-sm text-muted-fg mt-1">حالة كل صنف داخل كل صيدلية بناءً على آخر ملف Excel محفوظ.</p></header>

      <section className="card p-4 bg-muted/30">
        {loading ? <div className="text-sm text-muted-fg">جارٍ التحميل...</div> : !batch ? <div className="text-sm text-muted-fg">لا توجد بيانات محفوظة.</div> : (
          <div className="grid md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-muted-fg">مصدر البيانات</div><div className="font-medium" dir="auto">{batch.file_name}</div></div>
            <div><div className="text-xs text-muted-fg">الشهر</div><div className="font-medium">{fmtMonth(batch.month)}</div></div>
            <div><div className="text-xs text-muted-fg">عدد الصفوف</div><div className="font-medium">{fmtNum(batch.row_count)}</div></div>
            <div><div className="text-xs text-muted-fg">هدف التغطية</div><div className="font-medium">{target} يوم</div></div>
          </div>
        )}
      </section>

      <section className="card p-4 space-y-3 no-print">
        <div className="grid md:grid-cols-4 gap-3">
          <label><span className="label">الصيدلية</span><select className="input" value={pharmacy} onChange={(e) => setPharmacy(e.target.value)}><option value="all">كل الصيدليات</option>{pharmacies.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label><span className="label">الحالة</span><select className="input" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="all">كل الحالات</option>{ORDER.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label><span className="label">هدف التغطية</span><select className="input" value={target} onChange={(e) => setTarget(Number(e.target.value))}><option value={14}>14 يوم</option><option value={30}>30 يوم</option><option value={60}>60 يوم</option><option value={90}>90 يوم</option></select></label>
          <label><span className="label">بحث</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم الصنف أو الكود..." /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" disabled={!grouped.length} onClick={exportAll}>📥 تصدير Excel</button>
          <button className="btn-outline" disabled={!rows.length} onClick={exportCritical}>📥 تصدير الأصناف الحرجة فقط</button>
          <button className="btn-outline" disabled={!grouped.length} onClick={() => window.print()}>🖨️ طباعة التقرير</button>
        </div>
      </section>

      {loading && <div className="text-muted-fg">جارٍ التحميل...</div>}
      {!loading && !grouped.length && <div className="card p-8 text-center text-muted-fg">لا توجد بيانات مطابقة.</div>}

      {grouped.map((g, gi) => {
        const list = ORDER.flatMap((k) => g.byKind.get(k) || []);
        const total = list.length;
        const top20 = [...list]
          .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || (a.days ?? Infinity) - (b.days ?? Infinity))
          .slice(0, 20);
        return (
        <section key={g.pharmacy} className={`card p-5 space-y-4 ${gi > 0 ? "print-break" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold" dir="auto">{g.pharmacy}</h2>
            <div className="flex flex-wrap gap-2 no-print">
              <button className="btn-outline text-xs" onClick={() => exportSingle(g.pharmacy, list)}>📥 تصدير تقرير هذه الصيدلية Excel</button>
              <button className="btn-outline text-xs" onClick={() => window.print()}>🖨️ طباعة التقرير</button>
            </div>
          </div>

          {/* 1. ملخص الصيدلية */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <div className="p-3 rounded border border-border bg-muted/30 text-center">
              <div className="text-xs text-muted-fg">إجمالي الأصناف</div>
              <div className="text-lg font-bold">{fmtNum(total)}</div>
            </div>
            {SUMMARY_KINDS.map((k) => (
              <div key={k} className={`p-3 rounded border text-center ${KIND_CLASS[k]}`}>
                <div className="text-xs">{KIND_LABEL[k]}</div>
                <div className="text-lg font-bold">{fmtNum(g.summary[k] || 0)}</div>
              </div>
            ))}
          </div>

          {/* 2. ابدأ بهذه الأصناف */}
          {top20.length > 0 && (
            <div>
              <div className="font-bold mb-2">ابدأ بهذه الأصناف (أخطر {top20.length})</div>
              <div className="overflow-x-auto border border-border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted text-muted-fg"><tr>
                    <th className="p-2 text-right w-8">#</th>
                    <th className="p-2 text-right min-w-[240px]">الصنف</th>
                    <th className="p-2 whitespace-nowrap">الرصيد</th>
                    <th className="p-2 whitespace-nowrap">المنصرف</th>
                    <th className="p-2 whitespace-nowrap">يكفي (يوم)</th>
                    <th className="p-2">الحالة</th>
                    <th className="p-2 text-right min-w-[220px]">الإجراء</th>
                  </tr></thead>
                  <tbody>{top20.map((r, i) => (
                    <tr key={`top-${r.key}`} className="border-t border-border/40 align-top">
                      <td className="p-2 text-center">{i + 1}</td>
                      <td className="p-2"><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} /></td>
                      <td className="p-2 text-center whitespace-nowrap">{fmtNum(r.balance)}</td>
                      <td className="p-2 text-center whitespace-nowrap">{fmtNum(r.issued)}</td>
                      <td className="p-2 text-center font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                      <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                      <td className="p-2 text-muted-fg leading-snug" dir="auto">{r.action}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. أقسام حسب الحالة */}
          {ORDER.map((k) => {
            const list = g.byKind.get(k); if (!list || !list.length) return null;
            return (
              <div key={k}>
                <div className={`inline-flex items-center px-3 py-1 rounded text-xs font-semibold border mb-2 ${KIND_CLASS[k]}`}>{KIND_LABEL[k]} ({list.length})</div>
                <div className="overflow-x-auto border border-border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted text-muted-fg"><tr>
                      <th className="p-2 text-right min-w-[240px]">الصنف</th>
                      <th className="p-2 whitespace-nowrap">الرصيد</th>
                      <th className="p-2 whitespace-nowrap">المنصرف</th>
                      <th className="p-2 whitespace-nowrap">متوسط يومي</th>
                      <th className="p-2 whitespace-nowrap">أيام التغطية</th>
                      <th className="p-2">الحالة</th>
                      <th className="p-2 text-right min-w-[220px]">التوصية</th>
                      <th className="p-2 text-right min-w-[240px]">لماذا؟</th>
                    </tr></thead>
                    <tbody>{list.map((r) => {
                      const meta = itemMeta.get(r.itemKey);
                      return (
                      <tr key={r.key} className="border-t border-border/40 align-top">
                        <td className="p-2">
                          <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
                          {meta?.sci && <div className="text-[10px] text-muted-fg" dir="auto">{meta.sci}</div>}
                        </td>
                        <td className="p-2 text-center whitespace-nowrap">{fmtNum(r.balance)}</td>
                        <td className="p-2 text-center whitespace-nowrap">{fmtNum(r.issued)}</td>
                        <td className="p-2 text-center whitespace-nowrap">{fmtNum(r.adc, 1)}</td>
                        <td className="p-2 text-center font-semibold whitespace-nowrap">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                        <td className="p-2 text-center"><span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                        <td className="p-2 text-muted-fg whitespace-normal break-words leading-snug" dir="auto">{r.action}</td>
                        <td className="p-2 text-muted-fg whitespace-normal break-words leading-snug" dir="auto">{r.why}</td>
                      </tr>
                    );})}</tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>
        );
      })}
    </div>
  );
}
