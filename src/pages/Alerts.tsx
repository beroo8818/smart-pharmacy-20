import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  computePriority, PRIO_LABEL, PRIO_CLASS, PRIO_RANK, PRIO_FILTER_OPTIONS,
  type Priority, useVitalSet,
} from "@/lib/priority";
import { loadContinuousAnalysis, CONFIDENCE_LABEL, CONFIDENCE_CLASS } from "@/lib/continuousAnalysis";
import ProjectedBalanceBanner from "@/components/ProjectedBalanceBanner";
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

type AlertKind = "critical" | "danger" | "below" | "over" | "very_over" | "deadstock" | "no_data";
const KIND_LABEL: Record<AlertKind, string> = {
  critical: "خطر عالي جدًا", danger: "نقص متوقع", below: "أقل من الهدف",
  over: "زيادة", very_over: "زيادة جدًا", deadstock: "راكد", no_data: "بيانات غير كافية",
};
const KIND_CLASS: Record<AlertKind, string> = {
  critical: "bg-destructive/15 text-destructive border border-destructive/30",
  danger: "bg-destructive/10 text-destructive border border-destructive/20",
  below: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30",
  over: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30",
  very_over: "bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/40",
  deadstock: "bg-muted text-muted-foreground border border-border",
  no_data: "bg-muted text-muted-foreground border border-border",
};
const SEVERITY_OF: Record<AlertKind, "high" | "medium" | "low"> = {
  critical: "high", danger: "high", below: "medium", over: "low", very_over: "medium", deadstock: "low", no_data: "low",
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

const db = supabase as any;

function AlertsContinuousBanner() {
  const q = useQuery({
    queryKey: ["alerts-continuous"],
    queryFn: () => loadContinuousAnalysis({ targetDays: 30, monthsWindow: 3 }),
    staleTime: 60_000,
  });
  const data = q.data;
  if (!data || data.batches.length === 0) return null;
  const shortage = data.rows.filter((r) => ["critical", "danger", "below"].includes(r.kind)).length;
  const high = data.rows.filter((r) => r.confidence === "high").length;
  const weak = data.rows.filter((r) => r.confidence === "weak").length;
  return (
    <>
      <ProjectedBalanceBanner dataset={data} />
      <Card className="p-4 mb-4 border-primary/30 bg-primary-soft/30">
        <div className="flex items-start justify-between gap-3 flex-wrap text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">ملخص التنبيهات</div>
            <div><b>{shortage}</b> صنف/صيدلية تحت الهدف · <b>{high}</b> ثقة عالية · <b>{weak}</b> بيانات ضعيفة · مبني على <b>{data.monthsCount}</b> شهر</div>
          </div>
          {data.preliminary && (
            <span className="px-2 py-1 rounded text-xs border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              توقع مبدئي — يحتاج بيانات أشهر إضافية
            </span>
          )}
        </div>
      </Card>
    </>
  );
}

export default function Alerts() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const batchFromUrl = searchParams.get("batch");

  const [target, setTarget] = useState<number>(30);
  const [kindFilter, setKindFilter] = useState<"all" | AlertKind>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [pharmacyFilter, setPharmacyFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selectedBatchOverride, setSelectedBatchOverride] = useState<string>("");
  const { isVital } = useVitalSet();

  const batchesQuery = useQuery({
    queryKey: ["upload_batches_alerts"],
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
  const selectedBatchId = selectedBatchOverride || batchFromUrl || latestBatch?.id || null;
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements_alerts", selectedBatchId],
    enabled: !!selectedBatchId,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: () => fetchMovementsByBatch(selectedBatchId!) as Promise<InventoryMovement[]>,
  });
  const movements = useMemo(() => movementsQuery.data || [], [movementsQuery.data]);

  const pharmacies = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    for (const m of movements) {
      const k = normalize(`${m.location_type}|${m.location_name}`);
      if (!map.has(k)) map.set(k, { name: m.location_name, type: m.location_type });
    }
    return Array.from(map.entries()).map(([k, v]) => ({ id: k, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [movements]);

  type AlertRow = {
    key: string; itemKey: string; itemName: string; tradeNames: string[]; itemCode: string | null;
    locationId: string; locationName: string; locationType: string;
    balance: number; monthlyIssued: number; adc: number; days: number | null;
    kind: AlertKind; severity: "high" | "medium" | "low"; priority: Priority;
    why: string; action: string;
  };

  const alerts = useMemo<AlertRow[]>(() => {
    if (!movements.length) return [];

    // Per item+location aggregation
    const groups = new Map<string, { sample: InventoryMovement; itemKey: string; balance: number; issued: number; tradeNames: Set<string> }>();
    for (const m of movements) {
      const ik = itemKey(m);
      const k = `${ik}::${normalize(m.location_type)}::${normalize(m.location_name)}`;
      const cur = groups.get(k);
      const issued = num(m.issued_quantity);
      const balance = num(m.current_balance);
      const names = itemTradeNames(m as any);
      if (!cur) groups.set(k, { sample: m, itemKey: ik, balance, issued, tradeNames: new Set(names) });
      else {
        cur.balance += balance;
        cur.issued += issued;
        names.forEach((n) => cur.tradeNames.add(n));
      }
    }

    // Main store balance per item (summed across all main stores)
    const mainBalanceByItem = new Map<string, number>();
    for (const [, g] of groups) {
      if (!isMain(g.sample.location_type)) continue;
      const ik = g.itemKey;
      mainBalanceByItem.set(ik, (mainBalanceByItem.get(ik) || 0) + g.balance);
    }
    // Branch ADC sum per item (for assessing if main store can cover)
    const branchAdcByItem = new Map<string, number>();
    for (const [, g] of groups) {
      if (isMain(g.sample.location_type)) continue;
      const ik = g.itemKey;
      branchAdcByItem.set(ik, (branchAdcByItem.get(ik) || 0) + g.issued / 30);
    }

    const out: AlertRow[] = [];
    for (const [k, g] of groups) {
      // Skip main store rows from generating per-location alerts (focus on branches)
      if (isMain(g.sample.location_type)) continue;

      const adc = g.issued / 30;
      const days = adc > 0 ? g.balance / adc : null;
      let kind: AlertKind | null = null;
      if (g.issued === 0 && g.balance === 0) kind = "no_data";
      else if (g.issued === 0 && g.balance > 0) kind = "deadstock";
      else if (days != null) {
        if (days < 7) kind = "critical";
        else if (days < 14) kind = "danger";
        else if (days < target) kind = "below";
        else if (days > target * 3) kind = "very_over";
        else if (days > target * 2) kind = "over";
      }
      if (!kind) continue;

      const itemName = itemDisplayName(g.sample as any);
      const ik = g.itemKey;
      const mainBal = mainBalanceByItem.get(ik) || 0;
      const brAdcTotal = branchAdcByItem.get(ik) || 0;
      const mainCovers = brAdcTotal > 0 ? mainBal / brAdcTotal : 0;
      const noMainNoDonor = mainCovers < target; // simplistic donor check; main can't safely cover
      const vital = isVital(g.sample.item_code, itemName);
      const priority = computePriority({ days, kind, targetDays: target, isVital: vital, noMainNoDonor: noMainNoDonor && (kind === "critical" || kind === "danger") });

      let why = "", action = "";
      if (kind === "no_data") {
        why = `لا يوجد رصيد ولا صرف لهذا الصنف في ${g.sample.location_name}.`;
        action = "تأكد من بيانات هذا الصنف في الصيدلية.";
      } else if (kind === "deadstock") {
        why = `رصيد ${fmtNum(g.balance)} ${g.sample.unit || ""} في ${g.sample.location_name} بدون أي صرف خلال الشهر.`;
        action = "راجع الصنف لأنه له رصيد ولا يوجد عليه صرف.";
      } else if (kind === "critical" || kind === "danger" || kind === "below") {
        why = `الرصيد ${fmtNum(g.balance)} في ${g.sample.location_name} يغطي ${days!.toFixed(0)} يوم فقط، بمتوسط صرف يومي ${fmtNum(adc, 1)}.`;
        if (mainBal > 0 && mainCovers >= target) action = "اصرف من المخزن الرئيسي إلى هذه الصيدلية.";
        else action = "راجع صيدلية أخرى لديها فائض أو اطلب توريد.";
      } else {
        why = `الرصيد ${fmtNum(g.balance)} في ${g.sample.location_name} يغطي ${days!.toFixed(0)} يوم — أعلى من الحد المسموح.`;
        action = "لا تطلب هذا الشهر وفكر بتحويل الفائض لصيدلية ناقصة.";
      }

      out.push({
        key: k, itemKey: ik, itemName, tradeNames: Array.from(g.tradeNames), itemCode: g.sample.item_code,
        locationId: normalize(`${g.sample.location_type}|${g.sample.location_name}`),
        locationName: g.sample.location_name, locationType: g.sample.location_type,
        balance: g.balance, monthlyIssued: g.issued, adc, days,
        kind, severity: SEVERITY_OF[kind], priority, why, action,
      });
    }

    // Main-store alerts: judged against TOTAL branch consumption (never "راكد").
    for (const [k, g] of groups) {
      if (!isMain(g.sample.location_type)) continue;
      const ik = g.itemKey;
      const mainBal = g.balance;
      const brAdcTotal = branchAdcByItem.get(ik) || 0;
      const days = brAdcTotal > 0 ? mainBal / brAdcTotal : null;
      const itemName = itemDisplayName(g.sample as any);

      let kind: AlertKind | null = null;
      let why = "", action = "";
      if (mainBal <= 0 && brAdcTotal <= 0) {
        kind = "no_data";
        why = `لا يوجد رصيد بالمخزن (${g.sample.location_name}) ولا صرف بالفروع لهذا الصنف.`;
        action = "راجع البيانات قبل اتخاذ قرار توريد.";
      } else if (mainBal <= 0 && brAdcTotal > 0) {
        kind = "critical";
        why = `المخزن الرئيسي (${g.sample.location_name}) غير متوفر، بينما الفروع تصرف ${fmtNum(brAdcTotal, 1)}/يوم.`;
        action = "اطلب توريد عاجل أو حوّل من فرع لديه فائض.";
      } else if (mainBal > 0 && brAdcTotal <= 0) {
        kind = "over";
        why = `رصيد ${fmtNum(mainBal)} بالمخزن (${g.sample.location_name}) بدون صرف بالفروع.`;
        action = "راجع هل الصنف راكد أو بيانات الصرف ناقصة — لا تطلب هذا الشهر.";
      } else if (days != null) {
        if (days < 7) kind = "critical";
        else if (days < 14) kind = "danger";
        else if (days < target) kind = "below";
        else if (days > target * 3) kind = "very_over";
        else if (days > target * 2) kind = "over";
        if (kind === "critical" || kind === "danger" || kind === "below") {
          why = `تغطية المخزن ${days.toFixed(0)} يوم (رصيد ${fmtNum(mainBal)} ÷ صرف الفروع ${fmtNum(brAdcTotal, 1)}/يوم) أقل من الهدف ${target}.`;
          action = "اطلب توريد لرفع تغطية المخزن للهدف.";
        } else if (kind) {
          why = `تغطية المخزن ${days.toFixed(0)} يوم — أعلى من الحد المسموح لتغطية الفروع.`;
          action = "لا تطلب هذا الشهر.";
        }
      }
      if (!kind) continue;

      const vital = isVital(g.sample.item_code, itemName);
      const priority = computePriority({ days, kind, targetDays: target, isVital: vital });
      out.push({
        key: `main::${k}`, itemKey: ik, itemName, tradeNames: Array.from(g.tradeNames), itemCode: g.sample.item_code,
        locationId: normalize(`${g.sample.location_type}|${g.sample.location_name}`),
        locationName: `${g.sample.location_name} (مخزن رئيسي)`, locationType: g.sample.location_type,
        balance: mainBal, monthlyIssued: brAdcTotal * 30, adc: brAdcTotal, days,
        kind, severity: SEVERITY_OF[kind], priority, why, action,
      });
    }

    return out.sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.itemName.localeCompare(b.itemName, "ar"));
  }, [movements, target, isVital]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    return alerts.filter((a) => {
      if (kindFilter !== "all" && a.kind !== kindFilter) return false;
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (prioFilter !== "all" && a.priority !== prioFilter) return false;
      if (pharmacyFilter !== "all" && a.locationId !== pharmacyFilter) return false;
      if (s && !normalize(`${a.itemName} ${a.tradeNames.join(" ")} ${a.itemCode || ""} ${a.locationName}`).includes(s)) return false;
      return true;
    });
  }, [alerts, kindFilter, severityFilter, prioFilter, pharmacyFilter, q]);

  const loading = batchesQuery.isLoading || movementsQuery.isLoading;
  const noData = !loading && (!selectedBatchId || (movementsQuery.isFetched && movements.length === 0));

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: alerts.length };
    (Object.keys(KIND_LABEL) as AlertKind[]).forEach((k) => { c[k] = 0; });
    alerts.forEach((a) => { c[a.kind]++; });
    return c;
  }, [alerts]);

  return (
    <div className="p-8 max-w-[1600px]">
      <PageHeader
        title="التنبيهات"
        description="تنبيهات محسوبة من الرصيد المتوقع اليوم (snapshot + حركات يومية) ومتوسط الصرف من آخر 3 شهور."
      />
      <AlertsContinuousBanner />

      <Card className="p-5 mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الملف (آخر ملف مرفوع افتراضيًا)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={selectedBatchId || ""} onChange={(e) => setSelectedBatchOverride(e.target.value)}>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.file_name} — {fmtMonth(b.month)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الصيدلية</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={pharmacyFilter} onChange={(e) => setPharmacyFilter(e.target.value)}>
              <option value="all">كل الصيدليات</option>
              {pharmacies.filter((p) => !isMain(p.type)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">درجة الخطورة</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)}>
              <option value="all">الكل</option>
              <option value="high">عاجل</option>
              <option value="medium">متوسط</option>
              <option value="low">منخفض</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الأولوية</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as any)}>
              {PRIO_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14</option><option value={30}>30</option>
              <option value={60}>60</option><option value={90}>90</option>
            </select>
          </div>
          <div className="md:col-span-4">
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="اسم الصنف أو الكود أو الصيدلية..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {selectedBatch && (
        <Card className="p-4 mb-4 text-sm border-primary/20 bg-primary-soft/30">
          <div className="font-medium text-primary">
            مصدر البيانات: ملف {selectedBatch.file_name} · شهر {fmtMonth(selectedBatch.month)} · عدد الصفوف المحفوظة {fmtNum(selectedBatch.rows_saved)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">upload_batch_id: <span dir="ltr">{selectedBatchId}</span></div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex gap-2 mb-4 flex-wrap text-sm">
          {(["all","critical","danger","below","deadstock","over","very_over","no_data"] as const).map((v) => (
            <button key={v} onClick={() => setKindFilter(v)}
              className={`px-3 py-1.5 rounded-md ${kindFilter === v ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              {v === "all" ? "الكل" : KIND_LABEL[v]} ({counts[v] || 0})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-muted-foreground">جارٍ التحميل...</div>
        ) : noData ? (
          <div className="text-muted-foreground text-center py-8">لا توجد بيانات محفوظة للتنبيهات. ارفع ملفًا واحفظه أولًا.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد تنبيهات مطابقة.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-right p-2 min-w-[280px] w-[28%]">المادة العلاجية</th>
                  <th className="text-right p-2 min-w-[140px]">الصيدلية</th>
                  <th className="text-right p-2">الرصيد</th>
                  <th className="text-right p-2">منصرف شهري</th>
                  <th className="text-right p-2">متوسط يومي</th>
                  <th className="text-right p-2 whitespace-nowrap">يكفي (يوم)</th>
                  <th className="text-right p-2">الأولوية</th>
                  <th className="text-right p-2">نوع التنبيه</th>
                  <th className="text-right p-2 min-w-[240px]">السبب</th>
                  <th className="text-right p-2 min-w-[240px]">الإجراء المقترح</th>
                  <th className="text-right p-2">تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.key} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium align-top min-w-[280px] max-w-[420px]">
                      <ItemIdentity name={a.itemName} tradeNames={a.tradeNames} code={a.itemCode} />
                    </td>
                    <td className="p-2 text-xs align-top whitespace-normal break-words" dir="auto">{a.locationName}</td>
                    <td className="p-2 align-top whitespace-nowrap">{fmtNum(a.balance)}</td>
                    <td className="p-2 align-top whitespace-nowrap">{fmtNum(a.monthlyIssued, 1)}</td>
                    <td className="p-2 align-top whitespace-nowrap">{fmtNum(a.adc, 2)}</td>
                    <td className="p-2 align-top whitespace-nowrap font-semibold">{a.days == null ? "—" : `${a.days.toFixed(0)} يوم`}</td>
                    <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${PRIO_CLASS[a.priority]}`}>{PRIO_LABEL[a.priority]}</span></td>
                    <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${KIND_CLASS[a.kind]}`}>{KIND_LABEL[a.kind]}</span></td>
                    <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{a.why}</td>
                    <td className="p-2 text-xs align-top whitespace-normal break-words" dir="auto">{a.action}</td>
                    <td className="p-2">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/items?batch=${selectedBatchId}&q=${encodeURIComponent(a.itemName)}`)}>
                        تفاصيل
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[11px] text-muted-foreground mt-3">
              upload_batch_id لجميع التنبيهات: <span dir="ltr">{selectedBatchId}</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
