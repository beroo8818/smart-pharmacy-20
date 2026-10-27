import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type UploadBatch } from "@/integrations/desktop/client";
import { fmtMonth, fmtNum, isMainLocation, normalize } from "@/lib/desktopAnalytics";
import { loadContinuousAnalysis, CONFIDENCE_LABEL, CONFIDENCE_CLASS, type ProjectedRow } from "@/lib/continuousAnalysis";
import ItemIdentity from "@/components/ItemIdentity";

function StatCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "danger" | "warn" | "success" | "info" }) {
  const map: Record<string, string> = {
    default: "bg-primary-soft text-primary",
    danger: "bg-danger-soft text-danger",
    warn: "bg-warn-soft text-warn",
    success: "bg-success-soft text-success",
    info: "bg-primary-soft text-primary",
  };
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-fg">{label}</div>
          <div className="text-2xl font-bold mt-2">{value}</div>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${map[tone]}`}>●</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [rows, setRows] = useState<ProjectedRow[]>([]);
  const [monthsCount, setMonthsCount] = useState(0);
  const [preliminary, setPreliminary] = useState(false);
  const [monthsWindow, setMonthsWindow] = useState(3);
  const [loading, setLoading] = useState(true);
  const target = 30;

  useEffect(() => { (async () => {
    setLoading(true);
    const d = await loadContinuousAnalysis({ monthsWindow, targetDays: target });
    setBatch(d.latestBatch); setRows(d.rows);
    setMonthsCount(d.monthsCount); setPreliminary(d.preliminary);
    setLoading(false);
  })(); }, [monthsWindow]);

  const branchRows = rows.filter((r) => !isMainLocation(r.locationType));
  const mainRows = rows.filter((r) => isMainLocation(r.locationType));
  const itemsSet = new Set(rows.map((r) => r.itemKey));
  const pharmaciesSet = new Set(branchRows.map((r) => normalize(r.locationName)));

  const shortageRows = branchRows.filter((r) => ["critical", "danger", "below"].includes(r.kind));
  const overstockRows = branchRows.filter((r) => ["over", "very_over"].includes(r.kind));
  const deadstockRows = branchRows.filter((r) => r.kind === "deadstock");

  const totalBranch = branchRows.reduce((s, r) => s + r.balance, 0);
  const totalMain = mainRows.reduce((s, r) => s + r.balance, 0);

  const topShortage = [...shortageRows].sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)).slice(0, 10);
  const topOver = [...overstockRows].sort((a, b) => (b.days ?? 0) - (a.days ?? 0)).slice(0, 10);
  const topDead = [...deadstockRows].sort((a, b) => b.balance - a.balance).slice(0, 10);

  const pharmacySummary = useMemo(() => {
    const m = new Map<string, { name: string; shortage: number; overstock: number; deadstock: number; total: number }>();
    for (const r of branchRows) {
      const k = normalize(r.locationName);
      const prev = m.get(k) || { name: r.locationName, shortage: 0, overstock: 0, deadstock: 0, total: 0 };
      prev.total++;
      if (["critical", "danger", "below"].includes(r.kind)) prev.shortage++;
      else if (["over", "very_over"].includes(r.kind)) prev.overstock++;
      else if (r.kind === "deadstock") prev.deadstock++;
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.shortage - a.shortage);
  }, [branchRows]);

  return (
    <div className="p-8 max-w-[1400px]">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">اللوحة الرئيسية</h1>
            <p className="text-sm text-muted-fg mt-1">رصيد متوقع لليوم بناءً على آخر الملفات + الحركات.</p>
          </div>
          <label className="text-sm flex items-center gap-2">
            <span className="text-muted-fg">نافذة التحليل:</span>
            <select className="input py-1" value={monthsWindow} onChange={(e) => setMonthsWindow(Number(e.target.value))}>
              <option value={1}>آخر شهر</option>
              <option value={3}>آخر 3 شهور</option>
              <option value={6}>آخر 6 شهور</option>
            </select>
          </label>
        </div>
        {preliminary && (
          <div className="mt-3 text-xs p-2 rounded border border-warn/30 bg-warn-soft text-warn">
            تنبؤ مبدئي — يحتاج بيانات أشهر إضافية لزيادة الدقة. ({monthsCount} شهر متاح)
          </div>
        )}
      </header>

      {loading ? <div className="text-muted-fg">جارٍ التحميل...</div>
        : !batch ? <div className="card p-8 text-center">
            <div className="font-semibold mb-2">لا توجد بيانات محفوظة.</div>
            <Link to="/upload" className="text-primary underline text-sm">صفحة رفع الملفات</Link>
          </div>
        : <>
          <div className="card p-4 mb-6 bg-primary-soft/40 border-primary/20">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
              <div><div className="text-xs text-muted-fg">آخر ملف</div><div className="font-semibold truncate">{batch.file_name}</div></div>
              <div><div className="text-xs text-muted-fg">تاريخ الرصيد</div><div className="font-semibold">{batch.snapshot_date || fmtMonth(batch.month)}</div></div>
              <div><div className="text-xs text-muted-fg">عدد الأشهر بالتحليل</div><div className="font-semibold">{fmtNum(monthsCount)}</div></div>
              <div><div className="text-xs text-muted-fg">الأصناف</div><div className="font-semibold">{fmtNum(itemsSet.size)}</div></div>
              <div><div className="text-xs text-muted-fg">الصيدليات الفرعية</div><div className="font-semibold">{fmtNum(pharmaciesSet.size)}</div></div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <StatCard label="إجمالي الأصناف" value={fmtNum(itemsSet.size)} />
            <StatCard label="الصيدليات الفرعية" value={fmtNum(pharmaciesSet.size)} tone="info" />
            <StatCard label="نقص / أقل من الهدف" value={fmtNum(shortageRows.length)} tone="danger" />
            <StatCard label="زيادة" value={fmtNum(overstockRows.length)} tone="warn" />
            <StatCard label="راكد" value={fmtNum(deadstockRows.length)} tone="info" />
            <StatCard label="إجمالي السجلات" value={fmtNum(rows.length)} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <StatCard label="إجمالي رصيد الصيدليات الفرعية" value={fmtNum(totalBranch)} tone="info" />
            <StatCard label="إجمالي رصيد المخزن الرئيسي" value={fmtNum(totalMain)} tone="success" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف خطر نقص</h2>
                <Link to="/alerts" className="text-xs text-primary">عرض الكل</Link>
              </div>
              <ul className="space-y-3">
                {!topShortage.length && <li className="text-sm text-muted-fg">لا توجد عناصر</li>}
                {topShortage.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-fg mt-1 break-words" dir="auto">{r.locationName}</div>
                      <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${CONFIDENCE_CLASS[r.confidence]}`}>{CONFIDENCE_LABEL[r.confidence]}</span>
                    </div>
                    <div className="text-xs font-semibold text-danger shrink-0 pt-0.5">{r.days == null ? "—" : `${r.days.toFixed(1)} يوم`}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف زيادة</h2>
                <Link to="/alerts" className="text-xs text-primary">عرض الكل</Link>
              </div>
              <ul className="space-y-3">
                {!topOver.length && <li className="text-sm text-muted-fg">لا توجد عناصر</li>}
                {topOver.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-fg mt-1 break-words" dir="auto">{r.locationName}</div>
                    </div>
                    <div className="text-xs font-semibold text-primary shrink-0 pt-0.5">{r.days == null ? "—" : `${r.days.toFixed(0)} يوم`}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف راكدة</h2>
              </div>
              <ul className="space-y-3">
                {!topDead.length && <li className="text-sm text-muted-fg">لا توجد عناصر</li>}
                {topDead.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-fg mt-1 break-words" dir="auto">{r.locationName}</div>
                    </div>
                    <div className="text-xs font-semibold shrink-0 pt-0.5">رصيد {fmtNum(r.balance)}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card p-5">
              <h2 className="font-bold mb-4">ملخص حسب الصيدلية</h2>
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-fg sticky top-0 bg-card">
                    <tr><th className="text-right p-2">الصيدلية</th><th className="p-2">نقص</th><th className="p-2">زيادة</th><th className="p-2">راكد</th></tr>
                  </thead>
                  <tbody>
                    {pharmacySummary.map((p) => (
                      <tr key={p.name} className="border-b border-border/50">
                        <td className="p-2 break-words" dir="auto">{p.name}</td>
                        <td className="p-2 text-center text-danger">{p.shortage}</td>
                        <td className="p-2 text-center text-warn">{p.overstock}</td>
                        <td className="p-2 text-center text-muted-fg">{p.deadstock}</td>
                      </tr>
                    ))}
                    {!pharmacySummary.length && <tr><td colSpan={4} className="p-3 text-center text-muted-fg">لا توجد بيانات</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>}
    </div>
  );
}
