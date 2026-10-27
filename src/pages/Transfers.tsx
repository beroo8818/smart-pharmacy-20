import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ItemIdentity from "@/components/ItemIdentity";
import { fetchMovementsByBatch, itemDisplayName, itemKey as analysisItemKey, itemTradeNames, sortBatchesForAnalysis } from "@/lib/batchAnalysis";

type UploadBatch = {
  id: string; file_name: string; month: string;
  rows_saved: number; status: string; created_at: string;
  snapshot_date?: string | null; batch_kind?: string | null;
};
type InventoryMovement = {
  id: string; upload_batch_id: string; month: string;
  item_name: string | null; item_code: string | null;
  scientific_name: string | null; trade_name: string | null; unit: string | null;
  location_name: string; location_type: string;
  issued_quantity: number | string | null; current_balance: number | string | null;
  created_at: string;
};

function normalize(s: unknown) {
  return String(s ?? "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "").replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
}
function num(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function isMain(t: string) { return t === "main_warehouse" || t === "main_store"; }
function itemKey(r: InventoryMovement) {
  return analysisItemKey(r as any);
}

interface LocAgg {
  name: string; type: string; balance: number; amc: number; adc: number; days: number | null;
}
interface Suggestion {
  itemName: string; tradeNames: string[]; itemCode: string | null; unit: string | null;
  from: string; fromType: "main" | "branch";
  to: string;
  qty: number;
  reason: string;
  fromBefore: { balance: number; days: number | null };
  fromAfter: { balance: number; days: number | null };
  toBefore: { balance: number; days: number | null };
  toAfter: { balance: number; days: number | null };
  uploadBatchId: string;
  priority: "high" | "medium" | "low";
}

const db = supabase as any;

export default function Transfers() {
  const [searchParams] = useSearchParams();
  const batchFromUrl = searchParams.get("batch");
  const [target, setTarget] = useState<number>(30);
  const [q, setQ] = useState("");

  const batchesQuery = useQuery({
    queryKey: ["upload_batches_transfers"],
    staleTime: 0, refetchOnMount: "always",
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
  const selectedBatchId = batchFromUrl || latestBatch?.id || null;
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements_transfers", selectedBatchId],
    enabled: !!selectedBatchId,
    staleTime: 0, refetchOnMount: "always",
    queryFn: () => fetchMovementsByBatch(selectedBatchId!) as Promise<InventoryMovement[]>,
  });

  const movements = useMemo(() => movementsQuery.data || [], [movementsQuery.data]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!movements.length) return [];

    // Group by item -> per location aggregation
    const byItem = new Map<string, { sample: InventoryMovement; tradeNames: Set<string>; locs: Map<string, LocAgg> }>();
    for (const m of movements) {
      const k = itemKey(m);
      if (!byItem.has(k)) byItem.set(k, { sample: m, tradeNames: new Set(itemTradeNames(m as any)), locs: new Map() });
      const entry = byItem.get(k)!;
      itemTradeNames(m as any).forEach((n) => entry.tradeNames.add(n));
      const lkey = normalize(`${m.location_type}|${m.location_name}`);
      const issued = num(m.issued_quantity);
      const balance = num(m.current_balance);
      const cur = entry.locs.get(lkey);
      if (!cur) {
        entry.locs.set(lkey, {
          name: m.location_name, type: m.location_type,
          balance, amc: issued, adc: issued / 30,
          days: issued > 0 ? balance / (issued / 30) : null,
        });
      } else {
        cur.balance += balance; cur.amc += issued; cur.adc = cur.amc / 30;
        cur.days = cur.adc > 0 ? cur.balance / cur.adc : null;
      }
    }

    const out: Suggestion[] = [];

    for (const [, { sample, tradeNames, locs }] of byItem) {
      const itemName = itemDisplayName(sample as any);
      const itemTradeNameList = Array.from(tradeNames);
      const list = Array.from(locs.values());
      const branches = list.filter((l) => !isMain(l.type));
      const mains = list.filter((l) => isMain(l.type));

      // Total daily consumption across all branches for this item
      const totalBranchAdc = branches.reduce((s, b) => s + (b.adc || 0), 0);
      // Required safety reserve in main store = total branches daily consumption × target days
      const mainReserve = totalBranchAdc * target;

      // Needs and surplus on branches only
      const needs = branches
        .filter((b) => b.adc > 0 && b.days != null && b.days < target)
        .map((b) => ({
          loc: b,
          needed: Math.max(0, Math.ceil(b.adc * target - b.balance)),
        }))
        .filter((n) => n.needed > 0)
        .sort((a, b) => (a.loc.days ?? 0) - (b.loc.days ?? 0));

      // Mutable balances for main stores, with coverage computed against branches' total adc
      const mainState = mains.map((m) => ({
        ...m,
        // main store coverage = balance / total branches daily consumption
        days: totalBranchAdc > 0 ? m.balance / totalBranchAdc : null,
      }));

      for (const n of needs) {
        let remaining = n.needed;
        const toBeforeDays = n.loc.days;
        const toBeforeBal = n.loc.balance;
        // Compute "main blocked" explanation up front (for use in donor-branch reasons)
        const mainBlockedReasons: string[] = [];
        for (const ms of mainState) {
          if (ms.balance <= 0) continue;
          const available = Math.floor(ms.balance - mainReserve);
          if (available <= 0) {
            mainBlockedReasons.push(
              `لم يتم اقتراح الصرف من المخزن (${ms.name}) لأن رصيده ${fmtNum(ms.balance)} يغطي ${ms.days?.toFixed(0) ?? "—"} يوم فقط، والحد الآمن ${target} يوم.`
            );
          }
        }

        // 1) Try main store(s) first
        for (const ms of mainState) {
          if (remaining <= 0) break;
          if (ms.balance <= 0) continue;
          // Available to dispense = balance - required reserve. Never dip into reserve.
          const available = Math.max(0, Math.floor(ms.balance - mainReserve));
          if (available <= 0) continue;
          const giveable = Math.min(remaining, available);
          if (giveable <= 0) continue;
          const fromBefore = { balance: ms.balance, days: ms.days };
          const newToBal = n.loc.balance + giveable;
          const newToDays = n.loc.adc > 0 ? newToBal / n.loc.adc : null;
          const newFromBal = ms.balance - giveable;
          const newFromDays = totalBranchAdc > 0 ? newFromBal / totalBranchAdc : null;
          ms.balance = newFromBal;
          ms.days = newFromDays;
          n.loc.balance = newToBal;

          const sev: "high" | "medium" | "low" =
            (toBeforeDays != null && toBeforeDays < 7) ? "high"
              : (toBeforeDays != null && toBeforeDays < 14) ? "medium" : "low";

          out.push({
            itemName, tradeNames: itemTradeNameList, itemCode: sample.item_code, unit: sample.unit,
            from: ms.name, fromType: "main",
            to: n.loc.name,
            qty: giveable,
            reason: `الصيدلية ${n.loc.name} تغطي ${toBeforeDays?.toFixed(0)} يوم. المخزن الرئيسي رصيده ${fmtNum(fromBefore.balance)} ويحتاج احتياطي ${fmtNum(Math.ceil(mainReserve))} (${fmtNum(Math.round(totalBranchAdc * 10) / 10)}/يوم × ${target} يوم) — متاح للصرف ${fmtNum(Math.floor(fromBefore.balance - mainReserve))}.`,
            fromBefore, fromAfter: { balance: newFromBal, days: null },
            // re-emit with actual days
            toBefore: { balance: toBeforeBal, days: toBeforeDays },
            toAfter: { balance: newToBal, days: newToDays },
            uploadBatchId: sample.upload_batch_id,
            priority: sev,
          });
          // patch fromAfter days now that we know the coverage
          out[out.length - 1].fromAfter.days = newFromDays;
          remaining -= giveable;
        }

        if (remaining <= 0) continue;

        // 2) Donor branches with surplus
        const donors = branches
          .filter((b) => b !== n.loc && b.adc > 0 && b.days != null && b.days > 2 * target)
          .map((b) => ({
            loc: b,
            surplus: Math.max(0, Math.floor(b.balance - b.adc * target)),
          }))
          .filter((d) => d.surplus > 0)
          .sort((a, b) => b.surplus - a.surplus);

        for (const d of donors) {
          if (remaining <= 0) break;
          const giveable = Math.min(remaining, d.surplus);
          if (giveable <= 0) continue;

          const fromBeforeBal = d.loc.balance;
          const fromBeforeDays = d.loc.days;
          const newFromBal = d.loc.balance - giveable;
          const newFromDays = d.loc.adc > 0 ? newFromBal / d.loc.adc : null;
          // do not let donor fall under target
          if (newFromDays != null && newFromDays < target) continue;

          const newToBal = n.loc.balance + giveable;
          const newToDays = n.loc.adc > 0 ? newToBal / n.loc.adc : null;

          d.loc.balance = newFromBal; d.loc.days = newFromDays;
          n.loc.balance = newToBal;

          const sev: "high" | "medium" | "low" =
            (toBeforeDays != null && toBeforeDays < 7) ? "high"
              : (toBeforeDays != null && toBeforeDays < 14) ? "medium" : "low";

          out.push({
            itemName, tradeNames: itemTradeNameList, itemCode: sample.item_code, unit: sample.unit,
            from: d.loc.name, fromType: "branch",
            to: n.loc.name,
            qty: giveable,
            reason: (mainBlockedReasons.length ? mainBlockedReasons.join(" ") + " " : "") +
              `فائض في ${d.loc.name} (تغطية ${fromBeforeDays?.toFixed(0)} يوم) ونقص في ${n.loc.name} (تغطية ${toBeforeDays?.toFixed(0)} يوم).`,
            fromBefore: { balance: fromBeforeBal, days: fromBeforeDays },
            fromAfter: { balance: newFromBal, days: newFromDays },
            toBefore: { balance: toBeforeBal, days: toBeforeDays },
            toAfter: { balance: newToBal, days: newToDays },
            uploadBatchId: sample.upload_batch_id,
            priority: sev,
          });
          remaining -= giveable;
        }
      }
    }

    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
  }, [movements, target]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    if (!s) return suggestions;
    return suggestions.filter((x) => normalize(`${x.itemName} ${x.tradeNames.join(" ")} ${x.itemCode || ""} ${x.from} ${x.to}`).includes(s));
  }, [suggestions, q]);

  const loading = batchesQuery.isLoading || movementsQuery.isLoading;
  const noData = !loading && (!selectedBatchId || movements.length === 0);

  return (
    <div className="p-8 max-w-[1600px]">
      <PageHeader
        title="التحويلات المقترحة"
        description="مقترحات تحويل بناءً على نفس بيانات الملف المحفوظ (upload_batch_id)، تستخدم رصيد ومتوسط الصرف لكل صيدلية."
      />

      <Card className="p-5 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="اسم الصنف أو الصيدلية..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {selectedBatch && (
        <Card className="p-4 mb-4 text-sm border-primary/20 bg-primary-soft/30">
          <div className="font-medium text-primary">
            مصدر التحليل: ملف {selectedBatch.file_name}، شهر {fmtMonth(selectedBatch.month)}، عدد الصفوف {fmtNum(selectedBatch.rows_saved)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">upload_batch_id: <span dir="ltr">{selectedBatchId}</span></div>
        </Card>
      )}

      <Card className="p-5">
        {loading ? (
          <div className="text-muted-foreground">جارٍ التحميل...</div>
        ) : noData ? (
          <div className="text-muted-foreground text-center py-8">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد تحويلات مقترحة بناءً على هدف التغطية الحالي.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-right p-2 min-w-[280px] w-[26%]">المادة العلاجية</th>
                  <th className="text-right p-2 min-w-[140px]">من</th>
                  <th className="text-right p-2"></th>
                  <th className="text-right p-2 min-w-[140px]">إلى</th>
                  <th className="text-right p-2">الكمية</th>
                  <th className="text-right p-2">تغطية المرسل (قبل ← بعد)</th>
                  <th className="text-right p-2">تغطية المستقبل (قبل ← بعد)</th>
                  <th className="text-right p-2 min-w-[260px]">السبب</th>
                  <th className="text-right p-2">الأولوية</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium align-top min-w-[280px] max-w-[420px]">
                      <ItemIdentity name={s.itemName} tradeNames={s.tradeNames} code={s.itemCode} />
                    </td>
                    <td className="p-2 align-top whitespace-normal break-words" dir="auto">
                      <div>{s.from}</div>
                      {s.fromType === "main" && <span className="text-[10px] text-primary mr-1">(مخزن رئيسي)</span>}
                    </td>
                    <td className="p-2 align-top"><ArrowLeft className="w-4 h-4 text-muted-foreground" /></td>
                    <td className="p-2 align-top whitespace-normal break-words" dir="auto">{s.to}</td>
                    <td className="p-2 font-bold align-top whitespace-nowrap">{fmtNum(s.qty)} {s.unit || ""}</td>
                    <td className="p-2 text-xs align-top whitespace-nowrap">
                      رصيد {fmtNum(s.fromBefore.balance)} ← {fmtNum(s.fromAfter.balance)}
                      <div className="text-muted-foreground">
                        {s.fromBefore.days == null ? "—" : `${s.fromBefore.days.toFixed(0)} يوم`} ← {s.fromAfter.days == null ? "—" : `${s.fromAfter.days.toFixed(0)} يوم`}
                      </div>
                    </td>
                    <td className="p-2 text-xs align-top whitespace-nowrap">
                      رصيد {fmtNum(s.toBefore.balance)} ← {fmtNum(s.toAfter.balance)}
                      <div className="text-muted-foreground">
                        {s.toBefore.days == null ? "—" : `${s.toBefore.days.toFixed(0)} يوم`} ← {s.toAfter.days == null ? "—" : `${s.toAfter.days.toFixed(0)} يوم`}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{s.reason}</td>
                    <td className="p-2">
                      <span className={`px-2 py-1 rounded text-xs ${s.priority === "high" ? "bg-destructive/15 text-destructive" : s.priority === "medium" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                        {s.priority === "high" ? "عاجل" : s.priority === "medium" ? "متوسط" : "عادي"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
