import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Box, Layers, TrendingDown, TrendingUp, Building2, Warehouse,
} from "lucide-react";
import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
import ProjectedBalanceBanner from "@/components/ProjectedBalanceBanner";
import ItemIdentity from "@/components/ItemIdentity";
import { fetchMovementsByBatch, itemDisplayName, itemKey as analysisItemKey, itemTradeNames, sortBatchesForAnalysis } from "@/lib/batchAnalysis";

type UploadBatch = {
  id: string; file_name: string; month: string;
  rows_saved: number; status: string; created_at: string;
  snapshot_date?: string | null; batch_kind?: string | null;
};
type Movement = {
  id: string; upload_batch_id: string; month: string;
  item_name: string | null; item_code: string | null;
  scientific_name: string | null; trade_name: string | null; unit: string | null;
  location_name: string; location_type: string;
  issued_quantity: number | string | null; current_balance: number | string | null;
};

const db = supabase as any;

function normalize(s: unknown) {
  return String(s ?? "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "").replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
}
function num(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function isMain(t: string) { return t === "main_warehouse" || t === "main_store"; }
function itemKey(r: Movement) {
  return analysisItemKey(r as any);
}

function StatCard({ label, value, icon: Icon, tone = "default" }: {
  label: string; value: string | number; icon: any;
  tone?: "default" | "danger" | "warning" | "success" | "info";
}) {
  const map: Record<string, string> = {
    default: "bg-primary-soft text-primary",
    danger: "bg-destructive-soft text-destructive",
    warning: "bg-warning-soft text-warning-foreground",
    success: "bg-success-soft text-success",
    info: "bg-info-soft text-info",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold mt-2">{value}</div>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${map[tone]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const target = 30;
  const continuousQ = useQuery({
    queryKey: ["dashboard-continuous"],
    queryFn: () => loadContinuousAnalysis({ targetDays: 30, monthsWindow: 3 }),
    staleTime: 60_000,
  });
  const projected = continuousQ.data;
  const projectedShortage = (projected?.rows || []).filter((r) =>
    r.kind === "critical" || r.kind === "danger" || r.kind === "below").length;
  const projectedHighConf = (projected?.rows || []).filter((r) => r.confidence === "high").length;
  const projectedTotal = projected?.rows.length || 0;

  const batchesQuery = useQuery({
    queryKey: ["upload_batches_dashboard"],
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db.from("upload_batches")
        .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .range(0, 199);
      if (error) throw error;
      return sortBatchesForAnalysis((data || []) as UploadBatch[]);
    },
  });
  const batches = batchesQuery.data || [];
  const latestBatch = batches[0] || null;

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements_dashboard", latestBatch?.id],
    enabled: !!latestBatch?.id,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: () => fetchMovementsByBatch(latestBatch!.id) as Promise<Movement[]>,
  });
  const movements = movementsQuery.data || [];

  const error = batchesQuery.error || movementsQuery.error;
  const loading = batchesQuery.isLoading || (!!latestBatch?.id && movementsQuery.isLoading);

  type Row = {
    key: string; itemKey: string; itemName: string; tradeNames: string[]; itemCode: string | null;
    locationName: string; locationType: string;
    balance: number; issued: number; adc: number; days: number | null;
    kind: "critical" | "danger" | "below" | "over" | "very_over" | "deadstock" | "ok";
  };

  const rows: Row[] = useMemo(() => {
    if (!movements.length) return [];
    const agg = new Map<string, Row>();
    for (const m of movements) {
      const ik = itemKey(m);
      const lk = normalize(`${m.location_type}|${m.location_name}`);
      const k = `${ik}::${lk}`;
      const prev = agg.get(k);
      const issued = num(m.issued_quantity);
      const balance = num(m.current_balance);
      if (prev) {
        prev.issued += issued;
        prev.balance += balance;
        prev.tradeNames = Array.from(new Set([...prev.tradeNames, ...itemTradeNames(m as any)]));
      }
      else {
        agg.set(k, {
          key: k, itemKey: ik, itemName: itemDisplayName(m as any),
          tradeNames: itemTradeNames(m as any),
          itemCode: m.item_code, locationName: m.location_name, locationType: m.location_type,
          balance, issued, adc: 0, days: null, kind: "ok",
        });
      }
    }
    const arr = Array.from(agg.values());
    const branchAdcByItem = new Map<string, number>();
    for (const r of arr) {
      if (isMain(r.locationType)) continue;
      branchAdcByItem.set(r.itemKey, (branchAdcByItem.get(r.itemKey) || 0) + r.issued / 30);
    }
    for (const r of arr) {
      const rowIsMain = isMain(r.locationType);
      r.adc = rowIsMain ? (branchAdcByItem.get(r.itemKey) || 0) : r.issued / 30;
      r.days = r.adc > 0 ? r.balance / r.adc : null;
      if (rowIsMain && r.balance <= 0 && r.adc > 0) r.kind = "critical";
      else if (rowIsMain && r.adc <= 0) r.kind = "ok";
      else if (!rowIsMain && r.issued === 0 && r.balance > 0) r.kind = "deadstock";
      else if (r.days == null) r.kind = "ok";
      else if (r.days < 7) r.kind = "critical";
      else if (r.days < 14) r.kind = "danger";
      else if (r.days < target) r.kind = "below";
      else if (r.days > 3 * target) r.kind = "very_over";
      else if (r.days > 2 * target) r.kind = "over";
      else r.kind = "ok";
    }
    return arr;
  }, [movements]);

  const branchRows = rows.filter((r) => !isMain(r.locationType));
  const mainRows = rows.filter((r) => isMain(r.locationType));

  const itemsSet = new Set(movements.map((m) => itemKey(m)));
  const pharmaciesSet = new Set(
    movements.filter((m) => !isMain(m.location_type)).map((m) => normalize(m.location_name))
  );

  const shortageRows = branchRows.filter((r) => r.kind === "critical" || r.kind === "danger" || r.kind === "below");
  const overstockRows = branchRows.filter((r) => r.kind === "over" || r.kind === "very_over");
  const deadstockRows = branchRows.filter((r) => r.kind === "deadstock");

  const totalBranchStock = branchRows.reduce((s, r) => s + r.balance, 0);
  const totalMainStock = mainRows.reduce((s, r) => s + r.balance, 0);

  const topShortage = [...shortageRows].sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)).slice(0, 10);
  const topOverstock = [...overstockRows].sort((a, b) => (b.days ?? 0) - (a.days ?? 0)).slice(0, 10);
  const topDead = [...deadstockRows].sort((a, b) => b.balance - a.balance).slice(0, 10);

  // Summary by pharmacy
  const pharmacySummary = useMemo(() => {
    const m = new Map<string, { name: string; shortage: number; overstock: number; deadstock: number; total: number }>();
    for (const r of branchRows) {
      const k = normalize(r.locationName);
      const prev = m.get(k) || { name: r.locationName, shortage: 0, overstock: 0, deadstock: 0, total: 0 };
      prev.total++;
      if (r.kind === "critical" || r.kind === "danger" || r.kind === "below") prev.shortage++;
      else if (r.kind === "over" || r.kind === "very_over") prev.overstock++;
      else if (r.kind === "deadstock") prev.deadstock++;
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.shortage - a.shortage);
  }, [branchRows]);

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title="اللوحة الرئيسية"
        description="نظرة سريعة على حالة المخزون والصيدليات الفرعية"
      />

      <ProjectedBalanceBanner dataset={projected} />

      {projected && projected.batches.length > 0 && (
        <Card className="p-4 mb-4 border-primary/30 bg-primary-soft/30">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">تحليل مستمر (الرصيد المتوقع اليوم)</div>
              <div className="text-sm mt-1">
                <b>{projectedShortage}</b> صنف/صيدلية تحت الهدف الآن — من إجمالي <b>{projectedTotal}</b> ·
                ثقة عالية لـ <b>{projectedHighConf}</b> ·
                مبني على <b>{projected.monthsCount}</b> شهر بيانات
              </div>
            </div>
            {projected.preliminary && (
              <span className="px-2 py-1 rounded text-xs border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                توقع مبدئي — يحتاج بيانات أشهر إضافية
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Source data box */}
      {latestBatch && (
        <Card className="p-4 mb-6 bg-primary-soft/40 border-primary/20">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">مصدر البيانات</div><div className="font-semibold truncate">{latestBatch.file_name}</div></div>
            <div><div className="text-xs text-muted-foreground">الشهر</div><div className="font-semibold">{fmtMonth(latestBatch.month)}</div></div>
            <div className="col-span-2"><div className="text-xs text-muted-foreground">upload_batch_id</div><div className="font-mono text-xs truncate">{latestBatch.id}</div></div>
            <div><div className="text-xs text-muted-foreground">الصفوف المحفوظة</div><div className="font-semibold">{fmtNum(latestBatch.rows_saved)}</div></div>
            <div><div className="text-xs text-muted-foreground">الأصناف / الصيدليات</div><div className="font-semibold">{itemsSet.size} / {pharmaciesSet.size}</div></div>
          </div>
        </Card>
      )}

      {error ? (
        <Card className="p-6 text-destructive">
          تعذر تحميل بيانات اللوحة الرئيسية
          <div className="text-xs mt-2 opacity-80">{(error as any)?.message || String(error)}</div>
        </Card>
      ) : loading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : !latestBatch ? (
        <Card className="p-8 text-center text-muted-foreground">
          لا توجد بيانات محفوظة للوحة الرئيسية. ارفع ملفًا واحفظه أولًا.
          <div className="mt-4"><Link to="/upload" className="text-primary underline">صفحة رفع الملفات</Link></div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <StatCard label="إجمالي الأصناف" value={itemsSet.size} icon={Box} />
            <StatCard label="الصيدليات الفرعية" value={pharmaciesSet.size} icon={Building2} tone="info" />
            <StatCard label="أقل من الهدف / نقص" value={shortageRows.length} icon={TrendingDown} tone="danger" />
            <StatCard label="زيادة" value={overstockRows.length} icon={TrendingUp} tone="warning" />
            <StatCard label="راكد" value={deadstockRows.length} icon={Layers} tone="info" />
            <StatCard label="إجمالي السجلات" value={fmtNum(movements.length)} icon={AlertTriangle} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <StatCard label="إجمالي رصيد الصيدليات الفرعية" value={fmtNum(totalBranchStock, 0)} icon={Building2} tone="info" />
            <StatCard label="إجمالي رصيد المخزن الرئيسي" value={fmtNum(totalMainStock, 0)} icon={Warehouse} tone="success" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف خطر نقص</h2>
                <Link to="/alerts" className="text-xs text-primary">عرض الكل</Link>
              </div>
              <ul className="space-y-3">
                {topShortage.length === 0 && <li className="text-sm text-muted-foreground">لا توجد عناصر</li>}
                {topShortage.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">{r.locationName}</div>
                    </div>
                    <div className="text-xs whitespace-nowrap font-semibold text-destructive shrink-0 pt-0.5">{r.days == null ? "—" : `${r.days.toFixed(1)} يوم`}</div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف زيادة</h2>
                <Link to="/alerts" className="text-xs text-primary">عرض الكل</Link>
              </div>
              <ul className="space-y-3">
                {topOverstock.length === 0 && <li className="text-sm text-muted-foreground">لا توجد عناصر</li>}
                {topOverstock.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">{r.locationName}</div>
                    </div>
                    <div className="text-xs whitespace-nowrap font-semibold text-sky-600 dark:text-sky-400 shrink-0 pt-0.5">{r.days == null ? "—" : `${r.days.toFixed(0)} يوم`}</div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">أعلى ١٠ أصناف راكدة</h2>
              </div>
              <ul className="space-y-3">
                {topDead.length === 0 && <li className="text-sm text-muted-foreground">لا توجد عناصر</li>}
                {topDead.map((r) => (
                  <li key={r.key} className="flex items-start justify-between gap-3 border-b border-border/50 pb-3 last:border-0">
                    <div className="flex-1 min-w-0">
                      <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} />
                      <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">{r.locationName}</div>
                    </div>
                    <div className="text-xs whitespace-nowrap font-semibold shrink-0 pt-0.5">رصيد {fmtNum(r.balance, 0)}</div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold">ملخص حسب الصيدلية</h2>
              </div>
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground sticky top-0 bg-card">
                    <tr><th className="text-right p-2">الصيدلية</th><th className="p-2">نقص</th><th className="p-2">زيادة</th><th className="p-2">راكد</th></tr>
                  </thead>
                  <tbody>
                    {pharmacySummary.map((p) => (
                      <tr key={p.name} className="border-b border-border/50">
                        <td className="p-2 whitespace-normal break-words" dir="auto">{p.name}</td>
                        <td className="p-2 text-center text-destructive">{p.shortage}</td>
                        <td className="p-2 text-center text-warning-foreground">{p.overstock}</td>
                        <td className="p-2 text-center text-muted-foreground">{p.deadstock}</td>
                      </tr>
                    ))}
                    {pharmacySummary.length === 0 && (
                      <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">لا توجد بيانات</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Debug box */}
          <Card className="p-4 mt-8 bg-muted/40 text-xs font-mono">
            <div className="font-bold mb-2 font-sans">Debug</div>
            <div>upload_batches (saved) count: {batches.length}</div>
            <div>latest upload_batch_id: {latestBatch?.id || "—"}</div>
            <div>inventory_movements rows for batch: {movements.length}</div>
            <div>data source: database</div>
            <div>fetch error: {error ? ((error as any).message || String(error)) : "none"}</div>
          </Card>
        </>
      )}
    </div>
  );
}
