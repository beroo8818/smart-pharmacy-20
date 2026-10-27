import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ArrowLeftRight, Package, PackageOpen, ShoppingCart, Warehouse, HelpCircle } from "lucide-react";
import ItemIdentity from "@/components/ItemIdentity";
import {
  computePriority, PRIO_LABEL, PRIO_CLASS, PRIO_RANK, PRIO_FILTER_OPTIONS,
  type Priority, useVitalSet,
} from "@/lib/priority";
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

// DB-backed status enum (recommendation_status)
type DecisionStatus = "new" | "approved" | "rejected" | "postponed" | "executed";
const STATUS_LABEL: Record<DecisionStatus, string> = {
  new: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", postponed: "مؤجل", executed: "تم التنفيذ",
};

type Recommendation = {
  id: string;
  kind: "dispense_from_main" | "transfer_between" | "purchase" | "do_not_order";
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  unit: string | null;
  to: string; // pharmacy / target
  toType: string;
  from?: string;
  fromType?: string;
  qty?: number;
  balance: number;
  monthly: number;
  adc: number;
  days: number | null;
  why: string;
  action: string;
  priority: Priority;
  fromBalance?: number;
  fromDays?: number | null;
};


// DB-backed decisions per batch. Each click inserts a new audit row;
// the latest row per recommendation_key is treated as the current status.
function useDecisions(batchId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["recommendation_actions", batchId],
    enabled: !!batchId,
    staleTime: 0,
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
  const decisions = q.data || {};
  async function setDecision(r: Recommendation, status: DecisionStatus, extra?: { executed_qty?: number | null; note?: string | null }) {
    if (!batchId || !user) {
      toast({ title: "تعذر الحفظ", description: "يجب تسجيل الدخول أولًا.", variant: "destructive" });
      return;
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
      executed_qty: extra?.executed_qty ?? null,
      note: extra?.note ?? null,
      status,
      acted_by: user.id,
    });
    if (error) {
      toast({ title: "تعذر الحفظ", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم الحفظ", description: STATUS_LABEL[status] });
    qc.invalidateQueries({ queryKey: ["recommendation_actions", batchId] });
    qc.invalidateQueries({ queryKey: ["recommendation_actions_log"] });
  }
  return { decisions, setDecision };
}

export default function WhatToDo() {
  const [target, setTarget] = useState<number>(30);
  const [q, setQ] = useState("");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [whyOpen, setWhyOpen] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ["upload_batches_wtd"],
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await db.from("upload_batches")
        .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
        .eq("status", "saved").order("created_at", { ascending: false }).range(0, 199);
      if (error) throw error;
      return sortBatchesForAnalysis((data || []) as UploadBatch[]);
    },
  });
  const batches = batchesQuery.data || [];
  const latestBatch = batches[0] || null;

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements_wtd", latestBatch?.id],
    enabled: !!latestBatch?.id,
    staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: () => fetchMovementsByBatch(latestBatch!.id) as Promise<Movement[]>,
  });
  const movements = movementsQuery.data || [];
  const error = batchesQuery.error || movementsQuery.error;
  const loading = batchesQuery.isLoading || (!!latestBatch?.id && movementsQuery.isLoading);

  const { decisions, setDecision } = useDecisions(latestBatch?.id || null);
  const { isVital } = useVitalSet();

  type Loc = { name: string; type: string; balance: number; monthly: number; adc: number; days: number | null };
  type ItemData = {
    key: string; name: string; tradeNames: string[]; code: string | null; unit: string | null;
    locs: Map<string, Loc>;
  };

  const itemsData = useMemo(() => {
    const m = new Map<string, ItemData>();
    for (const mv of movements) {
      const k = itemKey(mv);
      let e = m.get(k);
      if (!e) {
        e = {
          key: k,
          name: itemDisplayName(mv as any),
          tradeNames: itemTradeNames(mv as any),
          code: mv.item_code, unit: mv.unit, locs: new Map(),
        };
        m.set(k, e);
      } else {
        e.tradeNames = Array.from(new Set([...e.tradeNames, ...itemTradeNames(mv as any)]));
      }
      const lk = normalize(`${mv.location_type}|${mv.location_name}`);
      const issued = num(mv.issued_quantity);
      const balance = num(mv.current_balance);
      const cur = e.locs.get(lk);
      if (cur) { cur.balance += balance; cur.monthly += issued; }
      else e.locs.set(lk, { name: mv.location_name, type: mv.location_type, balance, monthly: issued, adc: 0, days: null });
    }
    for (const e of m.values()) for (const l of e.locs.values()) {
      l.adc = l.monthly / 30;
      l.days = l.adc > 0 ? l.balance / l.adc : null;
    }
    return Array.from(m.values());
  }, [movements]);

  const recs = useMemo<Recommendation[]>(() => {
    const out: Recommendation[] = [];
    for (const it of itemsData) {
      const vital = isVital(it.code, it.name);
      const locs = Array.from(it.locs.values());
      const branches = locs.filter((l) => !isMain(l.type));
      const totalBranchAdc = branches.reduce((s, b) => s + (b.adc || 0), 0);
      const mainReserve = totalBranchAdc * target;
      const mains = locs.filter((l) => isMain(l.type)).map((l) => ({
        ...l,
        days: totalBranchAdc > 0 ? l.balance / totalBranchAdc : null,
      }));

      const needs = branches
        .filter((b) => b.adc > 0 && b.days != null && b.days < target)
        .map((b) => ({ loc: b, needed: Math.max(0, Math.ceil(b.adc * target - b.balance)) }))
        .filter((n) => n.needed > 0)
        .sort((a, b) => (a.loc.days ?? 0) - (b.loc.days ?? 0));

      // 1) dispense from main → branch
      for (const n of needs) {
        let remaining = n.needed;
        // Track whether main was blocked by reserve, for clear explanation later
        const mainBlockedReasons: string[] = [];
        for (const ms of mains) {
          if (ms.balance <= 0) continue;
          const available = Math.floor(ms.balance - mainReserve);
          if (available <= 0) {
            mainBlockedReasons.push(
              `لم يتم اقتراح الصرف من المخزن (${ms.name}) لأن رصيده ${fmtNum(ms.balance)} يغطي ${ms.days?.toFixed(0) ?? "—"} يوم فقط، والحد الآمن ${target} يوم (احتياطي ${fmtNum(Math.ceil(mainReserve))}).`
            );
          }
        }
        for (const ms of mains) {
          if (remaining <= 0) break;
          const available = Math.max(0, Math.floor(ms.balance - mainReserve));
          if (available <= 0) continue;
          const give = Math.min(remaining, available);
          if (give <= 0) continue;
          const msBeforeBal = ms.balance;
          const msBeforeDays = ms.days;
          const msAfterBal = ms.balance - give;
          const msAfterDays = totalBranchAdc > 0 ? msAfterBal / totalBranchAdc : null;
          const toAfterBal = n.loc.balance + give;
          const toAfterDays = n.loc.adc > 0 ? toAfterBal / n.loc.adc : null;
          out.push({
            id: `dm:${it.key}:${normalize(n.loc.name)}:${normalize(ms.name)}`,
            kind: "dispense_from_main",
            itemName: it.name, tradeNames: it.tradeNames, itemCode: it.code, unit: it.unit,
            itemKey: it.key,
            to: n.loc.name, toType: n.loc.type,
            from: ms.name, fromType: ms.type, qty: give,
            balance: n.loc.balance, monthly: n.loc.monthly, adc: n.loc.adc, days: n.loc.days,
            why:
              `الصيدلية: رصيد ${fmtNum(n.loc.balance)} ÷ ${fmtNum(n.loc.adc, 2)}/يوم = ${n.loc.days?.toFixed(1) ?? "—"} يوم (الهدف ${target}). ` +
              `المخزن: رصيد ${fmtNum(msBeforeBal)} - احتياطي ${fmtNum(Math.ceil(mainReserve))} ` +
              `(${fmtNum(Math.round(totalBranchAdc * 10) / 10)}/يوم × ${target} يوم) = متاح ${fmtNum(Math.floor(msBeforeBal - mainReserve))}. ` +
              `تغطية المخزن قبل ${msBeforeDays?.toFixed(0) ?? "—"} يوم ← بعد ${msAfterDays?.toFixed(0) ?? "—"} يوم. ` +
              `تغطية الصيدلية قبل ${n.loc.days?.toFixed(0) ?? "—"} ← بعد ${toAfterDays?.toFixed(0) ?? "—"} يوم.`,
            action: `اصرف ${fmtNum(give)} ${it.unit || ""} من ${ms.name} إلى ${n.loc.name}.`,
            priority: computePriority({ days: n.loc.days, targetDays: target, isVital: vital }),
            fromBalance: msBeforeBal,
            fromDays: msBeforeDays,
          });
          ms.balance -= give;
          ms.days = msAfterDays;
          n.loc.balance += give;
          remaining -= give;
        }
        // 2) transfer between branches
        if (remaining > 0) {
          const donors = branches
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
            out.push({
              id: `tr:${it.key}:${normalize(n.loc.name)}:${normalize(d.loc.name)}`,
              kind: "transfer_between",
              itemName: it.name, tradeNames: it.tradeNames, itemCode: it.code, unit: it.unit,
              itemKey: it.key,
              to: n.loc.name, toType: n.loc.type,
              from: d.loc.name, fromType: d.loc.type, qty: give,
              balance: n.loc.balance, monthly: n.loc.monthly, adc: n.loc.adc, days: n.loc.days,
              why: (mainBlockedReasons.length ? mainBlockedReasons.join(" ") + " " : "") +
                `${d.loc.name} لديها فائض (تغطية ${d.loc.days?.toFixed(0)} يوم). ${n.loc.name} تغطي ${n.loc.days?.toFixed(1)} يوم فقط.`,
              action: `حوّل ${fmtNum(give)} ${it.unit || ""} من ${d.loc.name} إلى ${n.loc.name}.`,
              priority: computePriority({ days: n.loc.days, targetDays: target, isVital: vital }),
              fromBalance: d.loc.balance, fromDays: d.loc.days,
            });
            d.loc.balance = newFromBal;
            d.loc.days = newFromDays;
            n.loc.balance += give;
            remaining -= give;
          }
        }
        // 3) purchase if still short and main doesn't have enough
        if (remaining > 0) {
          out.push({
            id: `pu:${it.key}:${normalize(n.loc.name)}`,
            kind: "purchase",
            itemName: it.name, tradeNames: it.tradeNames, itemCode: it.code, unit: it.unit,
            itemKey: it.key,
            to: n.loc.name, toType: n.loc.type, qty: remaining,
            balance: n.loc.balance, monthly: n.loc.monthly, adc: n.loc.adc, days: n.loc.days,
            why: (mainBlockedReasons.length ? mainBlockedReasons.join(" ") + " " : "") +
              `بعد محاولة الصرف من المخزن والتحويل من صيدليات الفائض، ما زال هناك عجز ${fmtNum(remaining)} ${it.unit || ""}.`,
            action: `اطلب توريد ${fmtNum(remaining)} ${it.unit || ""} على الأقل لتغطية احتياج ${n.loc.name}.`,
            // No main, no donor → bump to very_urgent per spec
            priority: computePriority({ days: n.loc.days, targetDays: target, isVital: vital, noMainNoDonor: true }),
          });
        }
      }

      // 4) do not order — surplus or deadstock at branch level
      for (const b of branches) {
        const dead = b.monthly === 0 && b.balance > 0;
        const veryOver = b.adc > 0 && b.days != null && b.days > 2 * target;
        if (!dead && !veryOver) continue;
        out.push({
          id: `nd:${it.key}:${normalize(b.name)}`,
          kind: "do_not_order",
          itemName: it.name, tradeNames: it.tradeNames, itemCode: it.code, unit: it.unit,
          itemKey: it.key,
          to: b.name, toType: b.type,
          balance: b.balance, monthly: b.monthly, adc: b.adc, days: b.days,
          why: dead
            ? `الرصيد ${fmtNum(b.balance)} والمنصرف الشهري = 0 → صنف راكد.`
            : `الرصيد ${fmtNum(b.balance)} ÷ متوسط الصرف اليومي ${fmtNum(b.adc, 2)} = ${b.days?.toFixed(0)} يوم، أكثر من ضعف الهدف (${target * 2} يوم).`,
          action: dead ? "لا تطلب هذا الصنف. راجع جدوى الاحتفاظ به." : "لا تطلب هذا الشهر — الرصيد يكفي مدة طويلة.",
          priority: computePriority({ days: b.days, kind: dead ? "deadstock" : "very_over", targetDays: target, isVital: vital }),
        });
      }
    }
    return out.sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority]);
  }, [itemsData, target, isVital]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    return recs.filter((r) => {
      if (prioFilter !== "all" && r.priority !== prioFilter) return false;
      if (s && !normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.to} ${r.from || ""}`).includes(s)) return false;
      return true;
    });
  }, [recs, q, prioFilter]);

  const dispense = filtered.filter((r) => r.kind === "dispense_from_main");
  const transfers = filtered.filter((r) => r.kind === "transfer_between");
  const purchase = filtered.filter((r) => r.kind === "purchase");
  const noOrder = filtered.filter((r) => r.kind === "do_not_order");

  // Summary
  const summary = useMemo(() => {
    let critical = 0, below = 0, over = 0, dead = 0;
    for (const it of itemsData) for (const l of it.locs.values()) {
      if (isMain(l.type)) continue;
      if (l.monthly === 0 && l.balance > 0) dead++;
      else if (l.days == null) continue;
      else if (l.days < 14) critical++;
      else if (l.days < target) below++;
      else if (l.days > 2 * target) over++;
    }
    return { critical, below, over, dead, transfers: transfers.length };
  }, [itemsData, target, transfers.length]);

  // Per pharmacy summary
  const pharmacySummary = useMemo(() => {
    const m = new Map<string, { name: string; critical: number; below: number; over: number; worstName: string; worstDays: number | null }>();
    for (const it of itemsData) for (const l of it.locs.values()) {
      if (isMain(l.type)) continue;
      const k = normalize(l.name);
      const prev = m.get(k) || { name: l.name, critical: 0, below: 0, over: 0, worstName: "", worstDays: null };
      if (l.days != null) {
        if (l.days < 14) prev.critical++;
        else if (l.days < target) prev.below++;
        else if (l.days > 2 * target) prev.over++;
        if (prev.worstDays == null || l.days < prev.worstDays) {
          prev.worstDays = l.days; prev.worstName = it.name;
        }
      }
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.critical - a.critical);
  }, [itemsData, target]);

  function decisionButtons(r: Recommendation) {
    const st = (decisions[r.id] as DecisionStatus) || "new";
    const Btn = ({ to, label, variant }: { to: DecisionStatus; label: string; variant: any }) => (
      <Button
        size="sm"
        variant={st === to ? "default" : variant}
        onClick={() => {
          if (to === "executed") {
            const qStr = window.prompt("الكمية المنفذة فعلًا:", String(r.qty ?? ""));
            if (qStr === null) return;
            const note = window.prompt("ملاحظة (اختياري):", "") || null;
            const qty = qStr.trim() === "" ? null : Number(qStr);
            setDecision(r, to, { executed_qty: Number.isFinite(qty as number) ? (qty as number) : null, note });
          } else {
            setDecision(r, to);
          }
        }}
      >
        {label}
      </Button>
    );
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className={`px-2 py-0.5 rounded text-[10px] border ${st === "new" ? "border-border text-muted-foreground" : "border-primary/30 text-primary"}`}>
          {STATUS_LABEL[st]}
        </span>
        <Btn to="approved" label="اعتماد" variant="outline" />
        <Btn to="rejected" label="رفض" variant="outline" />
        <Btn to="postponed" label="تأجيل" variant="outline" />
        <Btn to="executed" label="تم التنفيذ" variant="outline" />
      </div>
    );
  }

  function RecCard({ r, icon: Icon }: { r: Recommendation; icon: any }) {
    const open = whyOpen === r.id;
    return (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-[280px]">
            <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
              <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">
                {r.from ? <>من <span className="font-medium text-foreground">{r.from}</span> ← </> : null}
                إلى <span className="font-medium text-foreground">{r.to}</span>
              </div>
            </div>
          </div>
          <span className={`px-2 py-1 rounded text-xs ${PRIO_CLASS[r.priority]} shrink-0`}>{PRIO_LABEL[r.priority]}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
          <div><div className="text-muted-foreground">الرصيد الحالي</div><div className="font-semibold mt-0.5">{fmtNum(r.balance)}</div></div>
          <div><div className="text-muted-foreground">المنصرف الشهري</div><div className="font-semibold mt-0.5">{fmtNum(r.monthly, 1)}</div></div>
          <div><div className="text-muted-foreground">متوسط يومي</div><div className="font-semibold mt-0.5">{fmtNum(r.adc, 2)}</div></div>
          <div><div className="text-muted-foreground">يكفي</div><div className="font-semibold mt-0.5">{r.days == null ? "—" : `${r.days.toFixed(1)} يوم`}</div></div>
        </div>

        <div className="mt-3 text-sm whitespace-normal break-words" dir="auto">
          <span className="text-muted-foreground">الإجراء المقترح: </span>
          <span className="font-medium">{r.action}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground whitespace-normal break-words" dir="auto">
          <span>السبب: </span>{r.why}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3 justify-between">
          <Button size="sm" variant="ghost" onClick={() => setWhyOpen(open ? null : r.id)}>
            <HelpCircle className="w-4 h-4 ml-1" /> لماذا؟
          </Button>
          {decisionButtons(r)}
        </div>
        {open && (
          <div className="mt-3 p-3 rounded-md bg-muted/50 text-xs leading-relaxed" dir="auto">
            <div className="font-semibold mb-1">شرح الحساب</div>
            <div>أيام التغطية = الرصيد ÷ متوسط الصرف اليومي.</div>
            <div className="mt-1">
              {fmtNum(r.balance)} ÷ {fmtNum(r.adc, 2)} = <span className="font-semibold">{r.days == null ? "—" : `${r.days.toFixed(1)} يوم`}</span>.
            </div>
            <div className="mt-1">متوسط الصرف اليومي = المنصرف الشهري ({fmtNum(r.monthly, 1)}) ÷ 30.</div>
            <div className="mt-1">هدف التغطية الحالي = <span className="font-semibold">{target} يوم</span>. الحالة تتحدد بمقارنة أيام التغطية بالهدف.</div>
          </div>
        )}
      </Card>
    );
  }

  function Section({ title, icon: Icon, items, emptyText, iconColor }: { title: string; icon: any; items: Recommendation[]; emptyText: string; iconColor: string }) {
    return (
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold flex items-center gap-2">
            <span className={`w-8 h-8 rounded-md flex items-center justify-center ${iconColor}`}><Icon className="w-4 h-4" /></span>
            {title}
          </h2>
          <span className="text-xs text-muted-foreground">{items.length} توصية</span>
        </div>
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">{emptyText}</div>
        ) : (
          <div className="grid gap-3">
            {items.map((r) => <RecCard key={r.id} r={r} icon={Icon} />)}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title="ماذا أفعل الآن؟"
        description="قرارات عملية مبنية على آخر ملف محفوظ — صرف من المخزن، تحويل بين الصيدليات، طلب توريد، وما لا يجب طلبه."
      />

      {latestBatch && (
        <Card className="p-4 mb-4 bg-primary-soft/40 border-primary/20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">مصدر البيانات</div><div className="font-semibold truncate" dir="auto" title={latestBatch.file_name}>{latestBatch.file_name}</div></div>
            <div><div className="text-xs text-muted-foreground">الشهر</div><div className="font-semibold">{fmtMonth(latestBatch.month)}</div></div>
            <div><div className="text-xs text-muted-foreground">الصفوف المحفوظة</div><div className="font-semibold">{fmtNum(latestBatch.rows_saved)}</div></div>
            <div><div className="text-xs text-muted-foreground">upload_batch_id</div><div className="font-mono text-xs truncate" dir="ltr">{latestBatch.id}</div></div>
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
      </Card>

      {error ? (
        <Card className="p-6 text-destructive">تعذر تحميل البيانات. {(error as any)?.message}</Card>
      ) : loading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : !latestBatch ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card className="p-4"><div className="text-xs text-muted-foreground">خطر جدًا (أقل من 14 يوم)</div><div className="text-2xl font-bold mt-1 text-destructive">{summary.critical}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أقل من الهدف</div><div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{summary.below}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">تحويلات مقترحة</div><div className="text-2xl font-bold mt-1">{summary.transfers}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أصناف زائدة</div><div className="text-2xl font-bold mt-1 text-sky-600 dark:text-sky-400">{summary.over}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أصناف راكدة</div><div className="text-2xl font-bold mt-1 text-muted-foreground">{summary.dead}</div></Card>
          </div>

          {/* Per pharmacy */}
          <Card className="p-5 mb-6">
            <h2 className="font-bold mb-3">ملخص حسب الصيدلية</h2>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-right p-2 min-w-[160px]">الصيدلية</th>
                    <th className="text-right p-2">خطر نقص</th>
                    <th className="text-right p-2">أقل من الهدف</th>
                    <th className="text-right p-2">زائد</th>
                    <th className="text-right p-2 min-w-[280px]">أسوأ صنف</th>
                    <th className="text-right p-2 whitespace-nowrap">أيام التغطية</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmacySummary.length === 0 && (
                    <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">لا توجد بيانات</td></tr>
                  )}
                  {pharmacySummary.map((p) => (
                    <tr key={p.name} className="border-b border-border/50">
                      <td className="p-2 whitespace-normal break-words align-top" dir="auto">{p.name}</td>
                      <td className="p-2 text-destructive align-top">{p.critical}</td>
                      <td className="p-2 text-amber-600 dark:text-amber-400 align-top">{p.below}</td>
                      <td className="p-2 text-sky-600 dark:text-sky-400 align-top">{p.over}</td>
                      <td className="p-2 align-top whitespace-normal break-words" dir="auto" title={p.worstName}>{p.worstName || "—"}</td>
                      <td className="p-2 align-top whitespace-nowrap font-semibold">{p.worstDays == null ? "—" : `${p.worstDays.toFixed(1)} يوم`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6">
            <Section
              title="أصناف يجب صرفها من المخزن للصيدليات"
              icon={Warehouse} iconColor="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              items={dispense} emptyText="لا توجد توصيات صرف من المخزن." />
            <Section
              title="أصناف يجب تحويلها بين الصيدليات"
              icon={ArrowLeftRight} iconColor="bg-sky-500/15 text-sky-600 dark:text-sky-400"
              items={transfers} emptyText="لا توجد تحويلات مقترحة بين الصيدليات." />
            <Section
              title="أصناف يجب طلب توريد لها"
              icon={ShoppingCart} iconColor="bg-destructive/15 text-destructive"
              items={purchase} emptyText="لا توجد أصناف تحتاج توريد بعد إجراء الصرف والتحويل." />
            <Section
              title="لا تطلب هذا الشهر"
              icon={PackageOpen} iconColor="bg-muted text-muted-foreground"
              items={noOrder} emptyText="لا توجد أصناف زائدة أو راكدة." />
          </div>
        </>
      )}
    </div>
  );
}
