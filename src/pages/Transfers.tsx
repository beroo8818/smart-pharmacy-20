import { planTransfers } from "../../shared/transferPlan";
import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
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

  const datasetQ = useQuery({
    queryKey: ["transfer-history", batchFromUrl, target],
    queryFn: () => loadContinuousAnalysis({ targetDays: target, groupBy: "sku", batchIds: batchFromUrl ? [batchFromUrl] : undefined }),
  });
  const movements = datasetQ.data?.rows || [];
  const suggestions = useMemo<Suggestion[]>(() => planTransfers(movements, target).map((plan) => {
    const donorAdc = plan.from.adc;
    const recipientAdc = plan.to.adc;
    const days = (balance: number, adc: number) => adc > 0 ? balance / adc : null;
    return {
      itemName: plan.to.itemName, tradeNames: plan.to.tradeNames, itemCode: plan.to.itemCode, unit: plan.to.unit,
      from: plan.from.locationName, fromType: isMain(plan.from.locationType) ? "main" : "branch",
      to: plan.to.locationName, qty: plan.qty,
      reason: `اقتراح يحتاج مراجعة الرصيد والصلاحية واعتماد المسؤول. تاريخ المصدر ${plan.from.snapshotDate}، الوجهة ${plan.to.snapshotDate}. احتياطي المصدر محفوظ.`,
      fromBefore: { balance: plan.fromBefore, days: days(plan.fromBefore, donorAdc) },
      fromAfter: { balance: plan.fromAfter, days: days(plan.fromAfter, donorAdc) },
      toBefore: { balance: plan.toBefore, days: days(plan.toBefore, recipientAdc) },
      toAfter: { balance: plan.toAfter, days: days(plan.toAfter, recipientAdc) },
      uploadBatchId: selectedBatchId || "",
      priority: plan.to.days != null && plan.to.days < 7 ? "high" : plan.to.days != null && plan.to.days < 14 ? "medium" : "low",
    };
  }), [movements, target, selectedBatchId]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    if (!s) return suggestions;
    return suggestions.filter((x) => normalize(`${x.itemName} ${x.tradeNames.join(" ")} ${x.itemCode || ""} ${x.from} ${x.to}`).includes(s));
  }, [suggestions, q]);

  const loading = batchesQuery.isLoading || datasetQ.isLoading;
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
