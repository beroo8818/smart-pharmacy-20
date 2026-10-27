import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import {
  AlertOctagon, Warehouse, ArrowLeftRight, Ban, DatabaseZap, HelpCircle,
  FlaskConical, AlertTriangle, ShoppingCart,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import ItemIdentity from "@/components/ItemIdentity";
import {
  fetchLatestBatch, fetchMovementsByBatch, analyzeMovements,
  isMainLocation, normalize, type AnalysisRow, type UploadBatch,
} from "@/lib/batchAnalysis";
import { loadContinuousAnalysis, CONFIDENCE_LABEL, CONFIDENCE_CLASS } from "@/lib/continuousAnalysis";
import {
  computePriority, PRIO_LABEL, PRIO_CLASS, PRIO_RANK, PRIO_FILTER_OPTIONS,
  type Priority, useVitalSet,
} from "@/lib/priority";
import { logAudit } from "@/lib/audit";
import { canApproveRecommendation } from "@/lib/permissions";

const db = supabase as any;

type DecisionStatus = "new" | "approved" | "rejected" | "postponed" | "executed";
const STATUS_LABEL: Record<DecisionStatus, string> = {
  new: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", postponed: "مؤجل", executed: "تم التنفيذ",
};

type Rec = {
  id: string;
  section: "urgent" | "main" | "transfer" | "purchase" | "no_order" | "review";
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  to: string;
  from?: string;
  problem: string;   // مشكلة بسيطة
  action: string;    // الإجراء المقترح
  why: string;       // سبب تفصيلي
  priority: Priority;
  qty?: number;
  kind: string;
};

type DecisionOptions = {
  matchReviewRequired?: boolean;
  overrideUnreviewed?: boolean;
  overrideReason?: string | null;
  therapeuticGroupKey?: string | null;
};

function useDecisions(batchId: string | null) {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const q = useQuery({
    queryKey: ["recommendation_actions_dac", batchId],
    enabled: !!batchId,
    queryFn: async () => {
      const { data, error } = await db.from("recommendation_actions")
        .select("recommendation_key,status,acted_at")
        .eq("upload_batch_id", batchId)
        .order("acted_at", { ascending: false })
        .range(0, 9999);
      if (error) throw error;
      const map: Record<string, DecisionStatus> = {};
      for (const r of (data || []) as any[]) {
        if (!map[r.recommendation_key]) map[r.recommendation_key] = r.status as DecisionStatus;
      }
      return map;
    },
  });
  async function setDecision(r: Rec, status: DecisionStatus, options: DecisionOptions = {}) {
    if (!batchId || !user) {
      toast({ title: "تعذر الحفظ", description: "يجب تسجيل الدخول.", variant: "destructive" });
      return;
    }
    if (!canApproveRecommendation(roles)) {
      toast({ title: "غير مسموح", description: "ليس لديك صلاحية اتخاذ قرار على التوصيات. هذه الصلاحية لمدير الصيدلية أو مدير النظام.", variant: "destructive" });
      return;
    }
    const canRecordOverride = status === "approved" || status === "executed";
    const overrideUnreviewed = !!options.overrideUnreviewed && canRecordOverride;
    const overrideReason = overrideUnreviewed ? options.overrideReason?.trim() || "" : "";
    if (overrideUnreviewed && !overrideReason) {
      toast({ title: "سبب التجاوز مطلوب", description: "اكتب سببًا واضحًا قبل اعتماد أو تنفيذ توصية غير معتمدة.", variant: "destructive" });
      return;
    }
    let executed_qty: number | null = null;
    let note: string | null = null;
    if (status === "executed") {
      const qStr = window.prompt("الكمية المنفذة فعلًا:", String(r.qty ?? ""));
      if (qStr === null) return;
      note = window.prompt("ملاحظة (اختياري):", "") || null;
      const n = qStr.trim() === "" ? NaN : Number(qStr);
      executed_qty = Number.isFinite(n) ? n : null;
    }
    const { error } = await db.from("recommendation_actions").insert({
      upload_batch_id: batchId,
      recommendation_key: r.id,
      recommendation_type: r.kind,
      item_key: r.itemKey,
      item_name: r.itemName,
      from_location: r.from || null,
      to_location: r.to,
      suggested_qty: r.qty ?? null,
      executed_qty,
      note: [note, overrideReason ? `override: ${overrideReason}` : null].filter(Boolean).join(" | ") || null,
      status,
      acted_by: user.id,
      match_review_required: !!options.matchReviewRequired,
      override_unreviewed: overrideUnreviewed,
      override_reason: overrideReason || null,
      therapeutic_group_key: options.therapeuticGroupKey || null,
    });
    if (error) { toast({ title: "تعذر الحفظ", description: error.message, variant: "destructive" }); return; }
    toast({ title: "تم الحفظ", description: STATUS_LABEL[status] });
    await logAudit({
      userId: user.id,
      action: overrideUnreviewed ? "recommendation_override_unreviewed" : "recommendation_decision",
      entityType: "recommendation_action",
      entityId: r.id,
      newValue: {
        batchId,
        status,
        recommendationType: r.kind,
        itemName: r.itemName,
        from: r.from || null,
        to: r.to,
        suggestedQty: r.qty ?? null,
        executedQty: executed_qty,
        matchReviewRequired: !!options.matchReviewRequired,
        overrideUnreviewed,
        overrideReason: overrideReason || null,
        therapeuticGroupKey: options.therapeuticGroupKey || null,
      },
    });
    qc.invalidateQueries({ queryKey: ["recommendation_actions_dac", batchId] });
    qc.invalidateQueries({ queryKey: ["recommendation_actions_log"] });
  }
  return { decisions: q.data || {}, setDecision };
}

export default function DailyActionCenter() {
  const [target, setTarget] = useState(30);
  const [q, setQ] = useState("");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [allowUnreviewed, setAllowUnreviewed] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const { roles } = useAuth();
  const canOverrideUnreviewed = roles.some((r) => ["system_admin", "pharmacy_manager", "warehouse_keeper"].includes(r));
  const navigate = useNavigate();

  // Active ingredient dictionary: map original_item_name -> approval / group info.
  const dictQ = useQuery({
    queryKey: ["aid-dac"],
    queryFn: async () => {
      const { data } = await db.from("active_ingredient_dictionary")
        .select("original_item_name,approved,needs_review,therapeutic_group_key,standard_name")
        .range(0, 9999);
      return (data || []) as Array<{
        original_item_name: string; approved: boolean; needs_review: boolean;
        therapeutic_group_key: string | null; standard_name: string | null;
      }>;
    },
    staleTime: 30000,
  });
  const dictByName = useMemo(() => {
    const m = new Map<string, { approved: boolean; needs_review: boolean; group_key: string | null; standard_name: string | null }>();
    for (const d of (dictQ.data || [])) {
      const info = {
        approved: d.approved, needs_review: d.needs_review,
        group_key: d.therapeutic_group_key, standard_name: d.standard_name,
      };
      for (const candidate of [
        d.original_item_name,
        d.standard_name,
        d.therapeutic_group_key,
        d.therapeutic_group_key ? `ai::${normalize(d.therapeutic_group_key)}` : null,
      ]) {
        const key = (candidate || "").toLowerCase();
        if (key) m.set(key, info);
      }
    }
    return m;
  }, [dictQ.data]);
  function dictInfo(r: Rec) {
    return dictByName.get((r.itemKey || "").toLowerCase())
      || dictByName.get((r.itemName || "").toLowerCase())
      || null;
  }

  const batchQ = useQuery<UploadBatch | null>({
    queryKey: ["latest-batch-dac"],
    queryFn: fetchLatestBatch,
    staleTime: 0,
  });
  const batch = batchQ.data || null;

  const contQ = useQuery({
    queryKey: ["continuous-dac", target],
    queryFn: () => loadContinuousAnalysis({ targetDays: target, monthsWindow: 3, groupBy: "sku" }),
    staleTime: 0,
  });
  const continuous = contQ.data;
  const rows: AnalysisRow[] = useMemo(() => (continuous?.rows ?? []) as AnalysisRow[], [continuous]);
  const preliminary = continuous?.preliminary ?? false;
  const projectedRows = continuous?.rows ?? [];
  const confidenceByKey = useMemo(() => {
    const m = new Map<string, { c: import("@/lib/continuousAnalysis").Confidence; short: boolean }>();
    for (const r of projectedRows) m.set(`${r.itemKey}::${r.locationName}`, { c: r.confidence, short: r.shortHistoryWarning });
    return m;
  }, [projectedRows]);
  const { isVital } = useVitalSet();

  const ignoredQ = useQuery({
    queryKey: ["iir-dac", batch?.id],
    enabled: !!batch?.id,
    queryFn: async () => {
      const { data } = await db.from("import_ignored_rows")
        .select("id,sheet_name,row_number,reason")
        .eq("upload_batch_id", batch!.id)
        .range(0, 9999);
      return data || [];
    },
  });
  const dqQ = useQuery({
    queryKey: ["dq-dac", batch?.id],
    enabled: !!batch?.id,
    queryFn: async () => {
      const { data } = await db.from("data_quality_issues")
        .select("id,issue_type,severity,message_ar,row_no")
        .eq("upload_id", batch!.id)
        .range(0, 9999);
      return data || [];
    },
  });

  const { decisions, setDecision } = useDecisions(batch?.id || null);

  // Build recommendations grouped by item to apply main-store reserve logic
  const recs = useMemo<Rec[]>(() => {
    const out: Rec[] = [];
    const byItem = new Map<string, AnalysisRow[]>();
    rows.forEach((r) => { const a = byItem.get(r.itemKey) || []; a.push(r); byItem.set(r.itemKey, a); });

    for (const list of byItem.values()) {
      if (list.some((row) => row.kind === "no_data")) continue;
      const itemSample = list[0];
      const recItemKey = itemSample.itemKey;
      const itemName = itemSample.itemName;
      const recTradeNames = itemSample.tradeNames || [];
      const itemCode = itemSample.itemCode;
      const branches = list.filter((l) => !isMainLocation(l.locationType));
      const mains = list.filter((l) => isMainLocation(l.locationType))
        .map((l) => ({ ...l }));
      const totalBranchAdc = branches.reduce((s, b) => s + (b.adc || 0), 0);
      const reserve = totalBranchAdc * target;
      mains.forEach((m) => { (m as any).coverageDays = totalBranchAdc > 0 ? m.balance / totalBranchAdc : null; });

      // mutable balances per branch
      const branchState = branches.map((b) => ({ ...b }));
      const needs = branchState
        .filter((b) => b.adc > 0 && b.days != null && b.days < target)
        .map((b) => ({ loc: b, needed: Math.max(0, Math.ceil(b.adc * target - b.balance)) }))
        .filter((n) => n.needed > 0)
        .sort((a, b) => (a.loc.days ?? 0) - (b.loc.days ?? 0));

      // hospital-level totals (main + all branches) — used for purchase decisions
      const hospitalBalanceStart = list.reduce((s, l) => s + (l.balance || 0), 0);
      const hospitalCoverageStart = totalBranchAdc > 0 ? hospitalBalanceStart / totalBranchAdc : null;
      // accumulate branch need that could NOT be met from main store or donor branches
      let unmetTotal = 0;
      const unmetBranches: string[] = [];
      let mostUrgentUnmetDays: number | null = null;

      // section 1: very urgent (< 7 days), independent of dispense outcome
      for (const b of branches.filter((x) => x.days != null && x.days < 7)) {
        out.push({
          id: `ur:${b.itemKey}:${b.locationName}`,
          section: "urgent",
          itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode, to: b.locationName,
          problem: `الرصيد ${fmtNum(b.balance)} يكفي ${b.days?.toFixed(1)} يوم فقط — أقل من 7 أيام.`,
          action: `وفّر الصنف فورًا لـ ${b.locationName}.`,
          why: `الرصيد ${fmtNum(b.balance)} ÷ متوسط الصرف اليومي ${fmtNum(b.adc, 2)} = ${b.days?.toFixed(1)} يوم.`,
          priority: computePriority({ days: b.days, kind: b.kind, targetDays: target, isVital: isVital(itemCode, itemName) }),
          kind: "urgent",
        });
      }

      // section 2: dispense from main (with reserve)
      const mainBlockedReasons: string[] = [];
      for (const ms of mains) {
        if (ms.balance <= 0) continue;
        const avail = Math.floor(ms.balance - reserve);
        if (avail <= 0) {
          mainBlockedReasons.push(
            `المخزن (${ms.locationName}) رصيده ${fmtNum(ms.balance)} يغطي ${(ms as any).coverageDays?.toFixed(0) ?? "—"} يوم فقط، والحد الآمن ${target} يوم.`
          );
        }
      }

      for (const n of needs) {
        let remaining = n.needed;
        for (const ms of mains) {
          if (remaining <= 0) break;
          const avail = Math.max(0, Math.floor(ms.balance - reserve));
          if (avail <= 0) continue;
          const give = Math.min(remaining, avail);
          if (give <= 0) continue;
          const msBeforeBal = ms.balance;
          const msBeforeDays = (ms as any).coverageDays as number | null;
          const msAfterBal = msBeforeBal - give;
          const msAfterDays = totalBranchAdc > 0 ? msAfterBal / totalBranchAdc : null;
          const toAfterBal = n.loc.balance + give;
          const toAfterDays = n.loc.adc > 0 ? toAfterBal / n.loc.adc : null;
          out.push({
            id: `dm:${n.loc.itemKey}:${n.loc.locationName}:${ms.locationName}`,
            section: "main",
            itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode, to: n.loc.locationName, from: ms.locationName,
            problem: `${n.loc.locationName} تغطي ${n.loc.days?.toFixed(1) ?? "—"} يوم — أقل من الهدف ${target}.`,
            action: `اصرف ${fmtNum(give)} من ${ms.locationName} إلى ${n.loc.locationName}.`,
            why:
              `احتياج الصيدلية = ${fmtNum(Math.ceil(n.loc.adc * target - n.loc.balance))}. ` +
              `المخزن: رصيد ${fmtNum(msBeforeBal)} − احتياطي ${fmtNum(Math.ceil(reserve))} = متاح ${fmtNum(avail)}. ` +
              `تغطية المخزن ${msBeforeDays?.toFixed(0) ?? "—"} ← ${msAfterDays?.toFixed(0) ?? "—"} يوم. ` +
              `تغطية الصيدلية ${n.loc.days?.toFixed(0) ?? "—"} ← ${toAfterDays?.toFixed(0) ?? "—"} يوم.`,
            priority: computePriority({ days: n.loc.days, targetDays: target, isVital: isVital(itemCode, itemName) }),
            qty: give, kind: "dispense_from_main",
          });
          ms.balance = msAfterBal;
          (ms as any).coverageDays = msAfterDays;
          n.loc.balance = toAfterBal;
          n.loc.days = toAfterDays;
          remaining -= give;
        }

        // section 3: branch-to-branch transfer
        if (remaining > 0) {
          const donors = branchState
            .filter((b) => b !== n.loc && b.adc > 0 && b.days != null && b.days > 2 * target)
            .map((b) => ({ loc: b, surplus: Math.max(0, Math.floor(b.balance - b.adc * target)) }))
            .filter((d) => d.surplus > 0)
            .sort((a, b) => b.surplus - a.surplus);
          for (const d of donors) {
            if (remaining <= 0) break;
            const give = Math.min(remaining, d.surplus);
            if (give <= 0) continue;
            const newFromBal = d.loc.balance - give;
            const newFromDays = d.loc.adc > 0 ? newFromBal / d.loc.adc : null;
            if (newFromDays != null && newFromDays < target) continue;
            const fromBeforeDays = d.loc.days;
            const toBeforeDays = n.loc.days;
            const toAfterBal = n.loc.balance + give;
            const toAfterDays = n.loc.adc > 0 ? toAfterBal / n.loc.adc : null;
            out.push({
              id: `tr:${n.loc.itemKey}:${n.loc.locationName}:${d.loc.locationName}`,
              section: "transfer",
              itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode, to: n.loc.locationName, from: d.loc.locationName,
              problem: `${d.loc.locationName} لديها فائض (${fromBeforeDays?.toFixed(0)} يوم)، ${n.loc.locationName} ناقصة (${toBeforeDays?.toFixed(0)} يوم).`,
              action: `حوّل ${fmtNum(give)} من ${d.loc.locationName} إلى ${n.loc.locationName}.`,
              why:
                (mainBlockedReasons.length ? mainBlockedReasons.join(" ") + " " : "") +
                `المرسل: ${fromBeforeDays?.toFixed(0)} ← ${newFromDays?.toFixed(0)} يوم. ` +
                `المستقبل: ${toBeforeDays?.toFixed(0)} ← ${toAfterDays?.toFixed(0)} يوم.`,
              priority: computePriority({ days: n.loc.days, targetDays: target, isVital: isVital(itemCode, itemName) }),
              qty: give, kind: "transfer_between",
            });
            d.loc.balance = newFromBal; d.loc.days = newFromDays;
            n.loc.balance = toAfterBal; n.loc.days = toAfterDays;
            remaining -= give;
          }
        }

        // whatever the branch still needs after main-dispense + transfers
        // can only be solved by ordering/supplying (hospital-level shortage).
        if (remaining > 0) {
          unmetTotal += remaining;
          unmetBranches.push(n.loc.locationName);
          if (mostUrgentUnmetDays == null || (n.loc.days ?? Infinity) < mostUrgentUnmetDays) {
            mostUrgentUnmetDays = n.loc.days ?? null;
          }
        }
      }

      // section: request supply / purchase (Rule 4 — hospital total below target)
      if (unmetTotal > 0) {
        const orderQty = Math.max(
          unmetTotal,
          Math.ceil(Math.max(0, totalBranchAdc * target - hospitalBalanceStart)),
        );
        out.push({
          id: `po:${recItemKey}`,
          section: "purchase",
          itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode,
          to: unmetBranches.length === 1 ? unmetBranches[0] : "المستشفى",
          problem:
            `نقص على مستوى المستشفى: لا يوجد رصيد كافٍ بالمخزن الرئيسي ولا فائض بالفروع لتغطية ${unmetBranches.join("، ")}.`,
          action: `اطلب توريد حوالي ${fmtNum(orderQty)} وحدة لتغطية ${target} يوم.`,
          why:
            `رصيد المستشفى الكلي ${fmtNum(hospitalBalanceStart)} ÷ متوسط صرف الفروع ${fmtNum(totalBranchAdc, 2)}/يوم = ` +
            `${hospitalCoverageStart == null ? "—" : hospitalCoverageStart.toFixed(0)} يوم تغطية، والهدف ${target} يوم. ` +
            `العجز غير المغطى داخليًا = ${fmtNum(unmetTotal)} وحدة.`,
          priority: computePriority({
            days: mostUrgentUnmetDays,
            kind: "below",
            targetDays: target,
            isVital: isVital(itemCode, itemName),
            noMainNoDonor: true,
          }),
          qty: orderQty,
          kind: "request_supply",
        });
      }

      // section 4: do not order
      for (const b of branches) {
        const dead = b.issued === 0 && b.balance > 0;
        const veryOver = b.adc > 0 && b.days != null && b.days > 2 * target;
        if (!dead && !veryOver) continue;
        out.push({
          id: `nd:${b.itemKey}:${b.locationName}`,
          section: "no_order",
          itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode, to: b.locationName,
          problem: dead
            ? `رصيد ${fmtNum(b.balance)} بدون أي صرف هذا الشهر — صنف راكد.`
            : `الرصيد يغطي ${b.days?.toFixed(0)} يوم — أكثر من ضعف الهدف.`,
          action: dead ? "لا تطلب — راجع جدوى الاحتفاظ به." : "لا تطلب هذا الشهر.",
          why: `رصيد ${fmtNum(b.balance)} • منصرف ${fmtNum(b.issued)} • ${b.days?.toFixed(0) ?? "—"} يوم.`,
          priority: computePriority({ days: b.days, kind: dead ? "deadstock" : "very_over", targetDays: target, isVital: isVital(itemCode, itemName) }),
          kind: "do_not_order",
        });
      }

      // section 5: review data — branches with no_data
      for (const b of branches.filter((x) => x.kind === "no_data")) {
        out.push({
          id: `rv:${b.itemKey}:${b.locationName}`,
          section: "review",
          itemKey: recItemKey, itemName, tradeNames: recTradeNames, itemCode, to: b.locationName,
          problem: "البيانات غير كافية للحساب (لا صرف ولا رصيد واضح).",
          action: "راجع صف هذا الصنف في ملف الإكسل.",
          why: `رصيد ${fmtNum(b.balance)} • منصرف ${fmtNum(b.issued)}.`,
          priority: computePriority({ days: null, kind: "no_data", targetDays: target, isVital: isVital(itemCode, itemName) }),
          kind: "review_data",
        });
      }
    }
    // Post-process: if a needy branch has neither main nor donor coverage, bump that branch's
    // recommendations (mainly purchase-equivalent state). Here, if there's no "main" or "transfer"
    // rec for an "urgent" entry's branch+item, raise it to very_urgent.
    const helped = new Set<string>();
    for (const r of out) if (r.section === "main" || r.section === "transfer") helped.add(`${r.itemKey}|${r.to}`);
    for (const r of out) {
      if (r.section === "urgent" && !helped.has(`${r.itemKey}|${r.to}`)) {
        r.priority = "very_urgent";
        r.why = `لا يوجد رصيد آمن في المخزن ولا فائض في صيدلية أخرى. ` + r.why;
      }
    }
    return out.sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority]);
  }, [rows, target, isVital]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return recs.filter((r) => {
      if (prioFilter !== "all" && r.priority !== prioFilter) return false;
      if (s && !`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.to} ${r.from || ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [recs, q, prioFilter]);

  const sec = (k: Rec["section"]) => filtered.filter((r) => r.section === k);
  const urgent = sec("urgent");
  const dispense = sec("main");
  const transfers = sec("transfer");
  const purchase = sec("purchase");
  const noOrder = sec("no_order");
  const review = sec("review");

  const ignoredCount = (ignoredQ.data?.length || 0);
  const dqCount = (dqQ.data?.length || 0);
  const reviewCount = review.length + ignoredCount + dqCount;

  const loading = batchQ.isLoading || contQ.isLoading;

  function RecCard({ r }: { r: Rec }) {
    const st = (decisions[r.id] as DecisionStatus) || "new";
    const open = whyOpen === r.id;
    const locKey = r.to || r.from || "";
    const conf = confidenceByKey.get(`${r.itemKey}::${locKey}`);
    const di = dictInfo(r);
    const groupApproved = di?.approved && !di.needs_review;
    const groupKey = di?.group_key || null;
    const needsMatchReview = !groupApproved;
    const operational = r.section === "main" || r.section === "transfer" || r.section === "urgent";
    const overrideReady = canOverrideUnreviewed && allowUnreviewed && overrideReason.trim().length >= 8;
    const blocked = operational && needsMatchReview && !overrideReady;
    const decisionOptions: DecisionOptions = {
      matchReviewRequired: needsMatchReview,
      overrideUnreviewed: operational && needsMatchReview && overrideReady,
      overrideReason: operational && needsMatchReview && overrideReady ? overrideReason : null,
      therapeuticGroupKey: groupKey,
    };
    return (
      <Card className={`p-4 ${blocked ? "border-warning/40 bg-warning/5" : ""}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
            {di?.standard_name && (
              <div className="text-[11px] text-primary mt-0.5 flex items-center gap-1" dir="auto">
                <FlaskConical className="w-3 h-3" /> المجموعة العلاجية: <span className="font-medium">{di.standard_name}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">
              {r.from ? <>من <span className="font-medium text-foreground">{r.from}</span> ← </> : null}
              {r.to ? <>إلى <span className="font-medium text-foreground">{r.to}</span></> : null}
            </div>
          </div>
          <span className={`px-2 py-1 rounded text-xs ${PRIO_CLASS[r.priority]} shrink-0`}>{PRIO_LABEL[r.priority]}</span>
          {conf && (
            <span className={`px-2 py-1 rounded text-[10px] border ${CONFIDENCE_CLASS[conf.c]} shrink-0`}>
              {CONFIDENCE_LABEL[conf.c]}{conf.short ? " · بيانات قصيرة المدة" : ""}
            </span>
          )}
        </div>
        {needsMatchReview && (
          <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-warning/10 border border-warning/30 text-[11px] text-warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="flex-1">
              هذه التوصية تحتوي على أصناف تحتاج مراجعة مطابقة المادة الفعالة / التركيز / الشكل الدوائي.
              {blocked && <> لن يُنفّذ صرف أو تحويل تلقائيًا حتى تعتمد المطابقة.</>}
            </div>
          </div>
        )}
        <div className="mt-3 text-sm whitespace-normal break-words" dir="auto">
          <span className="text-muted-foreground">المشكلة: </span><span>{r.problem}</span>
        </div>
        <div className="mt-1 text-sm whitespace-normal break-words" dir="auto">
          <span className="text-muted-foreground">الإجراء المقترح: </span><span className="font-medium">{r.action}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 justify-between">
          <Button size="sm" variant="ghost" onClick={() => setWhyOpen(open ? null : r.id)}>
            <HelpCircle className="w-4 h-4 ml-1" /> لماذا؟
          </Button>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className={`px-2 py-0.5 rounded text-[10px] border ${st === "new" ? "border-border text-muted-foreground" : "border-primary/30 text-primary"}`}>
              {STATUS_LABEL[st]}
            </span>
            {groupKey && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/active-ingredients/group/${encodeURIComponent(groupKey)}`)}>
                عرض الأصناف داخل المجموعة
              </Button>
            )}
            {needsMatchReview && (
              <Button size="sm" variant="outline" onClick={() => navigate("/active-ingredients")}>
                مراجعة المطابقة
              </Button>
            )}
            <Button size="sm" variant={st === "approved" ? "default" : "outline"} onClick={() => setDecision(r, "approved", decisionOptions)} disabled={blocked}>اعتماد</Button>
            <Button size="sm" variant={st === "postponed" ? "default" : "outline"} onClick={() => setDecision(r, "postponed", decisionOptions)}>تأجيل</Button>
            <Button size="sm" variant={st === "rejected" ? "default" : "outline"} onClick={() => setDecision(r, "rejected", decisionOptions)}>رفض</Button>
            <Button size="sm" variant={st === "executed" ? "default" : "outline"} onClick={() => setDecision(r, "executed", decisionOptions)} disabled={blocked}>تم التنفيذ</Button>
          </div>
        </div>
        {open && (
          <div className="mt-3 p-3 rounded-md bg-muted/50 text-xs leading-relaxed" dir="auto">
            {r.why}
          </div>
        )}
      </Card>
    );
  }

  function Section({ title, icon: Icon, items, emptyText, color, extra }: { title: string; icon: any; items: Rec[]; emptyText: string; color: string; extra?: React.ReactNode }) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold flex items-center gap-2">
            <span className={`w-8 h-8 rounded-md flex items-center justify-center ${color}`}><Icon className="w-4 h-4" /></span>
            {title}
          </h2>
          <span className="text-xs text-muted-foreground">{items.length} توصية</span>
        </div>
        {extra}
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">{emptyText}</div>
        ) : (
          <div className="grid gap-3">{items.map((r) => <RecCard key={r.id} r={r} />)}</div>
        )}
      </Card>
    );
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title="مركز العمل اليومي"
        description="تحليل آخر رصيد لكل صنف وموقع مع الحركات الفعلية. يجب التحقق من الرصيد والصلاحية قبل التنفيذ."
      />

      {preliminary && (
        <div className="mb-4 px-4 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm">
          توقع مبدئي — يحتاج بيانات أشهر إضافية ({continuous?.monthsCount || 0} شهر متاح).
        </div>
      )}

      {batch && (
        <Card className="p-4 mb-4 bg-primary-soft/40 border-primary/20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">مصدر البيانات</div><div className="font-semibold truncate" dir="auto" title={batch.file_name}>{batch.file_name}</div></div>
            <div><div className="text-xs text-muted-foreground">الشهر</div><div className="font-semibold">{fmtMonth(batch.month)}</div></div>
            <div><div className="text-xs text-muted-foreground">الصفوف المحفوظة</div><div className="font-semibold">{fmtNum(batch.rows_saved)}</div></div>
            <div><div className="text-xs text-muted-foreground">upload_batch_id</div><div className="font-mono text-xs truncate" dir="ltr">{batch.id}</div></div>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الأولوية</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as any)}>
              {PRIO_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="اسم الصنف أو الصيدلية..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 pt-3 border-t flex items-start gap-2 text-xs">
          <input
            id="allow-unrev"
            type="checkbox"
            checked={allowUnreviewed}
            disabled={!canOverrideUnreviewed}
            onChange={(e) => setAllowUnreviewed(e.target.checked)}
            className="mt-0.5"
          />
          <label htmlFor="allow-unrev" className="cursor-pointer leading-relaxed">
            السماح باعتماد توصيات الصرف والتحويل للمجموعات التي لم تُعتمد مطابقتها بعد
            <span className="text-muted-foreground"> (افتراضيًا التحليل يعتمد على المادة الفعالة + التركيز + الشكل الدوائي + الوحدة، ولا يصدر قرار صرف أو تحويل على مجموعة غير معتمدة).</span>
          </label>
        </div>
        {allowUnreviewed && (
          <div className="mt-2">
            <label className="text-xs text-muted-foreground block mb-1">سبب السماح بالتجاوز</label>
            <Input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="مثال: موافقة مدير الصيدلية بعد مراجعة الاسم والتركيز يدويًا"
            />
            {overrideReason.trim().length > 0 && overrideReason.trim().length < 8 && (
              <div className="text-xs text-destructive mt-1">اكتب سببًا أوضح قبل الاعتماد أو التنفيذ.</div>
            )}
          </div>
        )}
        {!canOverrideUnreviewed && (
          <div className="mt-2 text-xs text-muted-foreground">
            التجاوز متاح فقط لمدير النظام أو مدير الصيدلية أو أمين المخزن.
          </div>
        )}
      </Card>

      {loading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : !batch ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            <Card className="p-4"><div className="text-xs text-muted-foreground">إجراءات عاجلة</div><div className="text-2xl font-bold mt-1 text-destructive">{fmtNum(urgent.length)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">صرف من المخزن</div><div className="text-2xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{fmtNum(dispense.length)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">تحويلات</div><div className="text-2xl font-bold mt-1 text-sky-600 dark:text-sky-400">{fmtNum(transfers.length)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">اطلب توريد</div><div className="text-2xl font-bold mt-1 text-rose-600 dark:text-rose-400">{fmtNum(purchase.length)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">لا تطلب</div><div className="text-2xl font-bold mt-1 text-muted-foreground">{fmtNum(noOrder.length)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">مشاكل بيانات</div><div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{fmtNum(reviewCount)}</div></Card>
          </div>

          <div className="grid gap-6">
            <Section title="إجراءات عاجلة جدًا" icon={AlertOctagon}
              color="bg-destructive/15 text-destructive"
              items={urgent} emptyText="لا توجد أصناف تكفي أقل من 7 أيام." />
            <Section title="اصرف من المخزن" icon={Warehouse}
              color="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              items={dispense} emptyText="لا توجد توصيات صرف آمنة من المخزن (مع حماية الاحتياطي)." />
            <Section title="حوّل بين الصيدليات" icon={ArrowLeftRight}
              color="bg-sky-500/15 text-sky-600 dark:text-sky-400"
              items={transfers} emptyText="لا توجد تحويلات آمنة بين الصيدليات." />
            <Section title="اطلب توريد" icon={ShoppingCart}
              color="bg-rose-500/15 text-rose-600 dark:text-rose-400"
              items={purchase} emptyText="لا توجد أصناف ناقصة على مستوى المستشفى تحتاج توريدًا." />
            <Section title="لا تطلب هذا الشهر" icon={Ban}
              color="bg-muted text-muted-foreground"
              items={noOrder} emptyText="لا توجد أصناف زائدة أو راكدة." />
            <Section title="راجع البيانات" icon={DatabaseZap}
              color="bg-amber-500/15 text-amber-600 dark:text-amber-400"
              items={review}
              emptyText={ignoredCount === 0 && dqCount === 0 ? "لا توجد مشاكل بيانات." : "لا توجد أصناف ببيانات ناقصة."}
              extra={(ignoredCount + dqCount) > 0 ? (
                <div className="mb-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs leading-relaxed">
                  يوجد <span className="font-bold">{fmtNum(ignoredCount)}</span> صف متجاهل أثناء الاستيراد
                  و <span className="font-bold">{fmtNum(dqCount)}</span> مشكلة بيانات.
                  راجع <span className="underline"><a href="/reports">تقرير الصفوف المتجاهلة ومشاكل البيانات</a></span>.
                </div>
              ) : null}
            />
          </div>
        </>
      )}
    </div>
  );
}
