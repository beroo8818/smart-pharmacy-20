import { useCallback, useMemo, useState } from "react";
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../../shared/accessPolicy';
import {loadNativeActions,latestDecisions} from '../../../shared/recommendationActions';
import {operationsCall} from '@/lib/operationsClient';
import {useLiveInventory} from '../../../shared/useLiveInventory';
import {hospitalPurchaseQuantity} from '../../../shared/supplyPolicy';
import { api, tokenStore, type UploadBatch } from "@/integrations/desktop/client";
import { fmtMonth, fmtNum, isMainLocation, type AnalysisRow } from "@/lib/desktopAnalytics";
import { loadContinuousAnalysis, type ProjectedRow } from "@/lib/continuousAnalysis";
import ItemIdentity from "@/components/ItemIdentity";

type Priority = "very_urgent" | "urgent" | "soon" | "normal" | "low";
const PRIO_LABEL: Record<Priority, string> = {
  very_urgent: "عاجل جدًا", urgent: "عاجل", soon: "قريبًا", normal: "عادي", low: "منخفض",
};
const PRIO_CLASS: Record<Priority, string> = {
  very_urgent: "bg-danger-soft text-danger border border-danger/40",
  urgent: "bg-warn-soft text-warn border border-warn/40",
  soon: "bg-primary-soft text-primary border border-primary/30",
  normal: "bg-muted text-muted-fg border border-border",
  low: "bg-muted text-muted-fg border border-border",
};
const PRIO_RANK: Record<Priority, number> = { very_urgent: 0, urgent: 1, soon: 2, normal: 3, low: 4 };

function computePriority(days: number | null, target: number, kind?: string): Priority {
  if (kind === "no_data" || kind === "deadstock") return "low";
  if (days == null) return "normal";
  if (days < 7) return "very_urgent";
  if (days < 14) return "urgent";
  if (days < target) return "soon";
  if (days > 2 * target) return "low";
  return "normal";
}

type DecisionStatus = "new" | "approved" | "rejected" | "postponed" | "executed";
const STATUS_LABEL: Record<DecisionStatus, string> = {
  new: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", postponed: "مؤجل", executed: "تم التنفيذ",
};

type Rec = {
  id: string;
  section: "urgent" | "main" | "transfer" | "no_order" | "review";
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  unit?:string|null;
  to: string;
  from?: string;
  problem: string;
  action: string;
  why: string;
  priority: Priority;
  qty?: number;
  kind: string;
};

type Decision = { status: DecisionStatus; at: string; qty?: number | null; note?: string | null; rec: Rec };

export default function DailyActionCenter() {
  const [monthsWindow, setMonthsWindow] = useState(3);
  const [target, setTarget] = useState(30);
  const [q, setQ] = useState("");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [saving,setSaving]=useState(false),[actionError,setActionError]=useState('');
  const {roles,access}=useAuth(),canDecide=hasPermission(roles,access,'decisions.write');

  const loader=useCallback(async()=>{
    const analysis=await loadContinuousAnalysis({monthsWindow,targetDays:target,groupBy:'sku'});
    const decisions=analysis.latestBatch?latestDecisions(await loadNativeActions(operationsCall,analysis.latestBatch.id)):{};
    return {...analysis,decisions};
  },[monthsWindow,target]);
  const {data,loading,error}=useLiveInventory(loader);
  const batch=data?.latestBatch||null,rows=data?.rows||[],preliminary=data?.preliminary||false;
  const decisions=data?.decisions||{};

  async function setDecision(r: Rec, status: DecisionStatus) {
    if (!batch||saving||!canDecide||loading) return;
    let qty: number | null | undefined; let note: string | null | undefined;
    if (status === "executed") {
      const qStr = window.prompt("الكمية المنفذة فعلًا:", String(r.qty ?? ""));
      if (qStr === null) return;
      note = window.prompt("ملاحظة (اختياري):", "") || null;
      const n = qStr.trim() === "" ? NaN : Number(qStr);
      if(!Number.isFinite(n)||n<=0){setActionError('اكتب كمية منفذة موجبة');return;}
      qty = n;
    }
    setSaving(true);setActionError('');
    try{await operationsCall('recommendation_save',{upload_batch_id:batch.id,recommendation_key:r.id,recommendation_type:r.kind,item_key:r.itemKey,item_name:r.itemName,item_code:r.itemCode,unit:r.unit||null,from_location:r.from||null,to_location:r.to,suggested_qty:r.qty??null,executed_qty:qty??null,note:note||null,status,client_id:crypto.randomUUID()});}
    catch(e){setActionError((e as Error).message);}finally{setSaving(false);}
  }

  const recs = useMemo<Rec[]>(() => {
    const out: Rec[] = [];
    const byItem = new Map<string, AnalysisRow[]>();
    rows.forEach((r) => { const a = byItem.get(r.itemKey) || []; a.push(r); byItem.set(r.itemKey, a); });

    for (const list of byItem.values()) {
      if (list.some((row) => row.kind === "no_data")) continue;
      const s = list[0];
      const recItemKey = s.itemKey;
      const itemName = s.itemName, itemCode = s.itemCode;
      const tradeNames = s.tradeNames || [];
      const branches = list.filter((l) => !isMainLocation(l.locationType));
      const mains = list.filter((l) => isMainLocation(l.locationType)).map((l) => ({ ...l }));
      const totalBranchAdc = branches.reduce((a, b) => a + (b.adc || 0), 0);
      const reserve = totalBranchAdc * target;
      const hospitalBalance=list.reduce((sum,row)=>sum+row.balance,0);
      let unmet=0;
      mains.forEach((m) => { (m as any).coverageDays = totalBranchAdc > 0 ? m.balance / totalBranchAdc : null; });
      const branchState = branches.map((b) => ({ ...b }));
      const needs = branchState
        .filter((b) => b.adc > 0 && b.days != null && b.days < target)
        .map((b) => ({ loc: b, needed: Math.max(0, Math.ceil(b.adc * target - b.balance)) }))
        .filter((n) => n.needed > 0)
        .sort((a, b) => (a.loc.days ?? 0) - (b.loc.days ?? 0));

      for (const b of branches.filter((x) => x.days != null && x.days < 7)) {
        out.push({
          id: `ur:${b.itemKey}:${b.locationName}`, section: "urgent",
          itemKey: recItemKey, itemName, tradeNames, itemCode,unit:s.unit, to: b.locationName,
          problem: `الرصيد ${fmtNum(b.balance)} يكفي ${b.days?.toFixed(1)} يوم فقط — أقل من 7 أيام.`,
          action: `وفّر الصنف فورًا لـ ${b.locationName}.`,
          why: `الرصيد ${fmtNum(b.balance)} ÷ متوسط الصرف اليومي ${fmtNum(b.adc, 2)} = ${b.days?.toFixed(1)} يوم.`,
          priority: computePriority(b.days, target, b.kind), kind: "urgent",
        });
      }

      const mainBlocked: string[] = [];
      for (const ms of mains) {
        if (ms.balance <= 0) continue;
        const avail = Math.floor(ms.balance - reserve);
        if (avail <= 0) mainBlocked.push(`المخزن (${ms.locationName}) رصيده ${fmtNum(ms.balance)} يغطي ${(ms as any).coverageDays?.toFixed(0) ?? "—"} يوم فقط، والحد الآمن ${target} يوم.`);
      }

      for (const n of needs) {
        let remaining = n.needed;
        for (const ms of mains) {
          if (remaining <= 0) break;
          const avail = Math.max(0, Math.floor(ms.balance - reserve));
          if (avail <= 0) continue;
          const give = Math.min(remaining, avail); if (give <= 0) continue;
          const beforeBal = ms.balance, beforeDays = (ms as any).coverageDays as number | null;
          const afterBal = beforeBal - give, afterDays = totalBranchAdc > 0 ? afterBal / totalBranchAdc : null;
          const toAfterBal = n.loc.balance + give, toAfterDays = n.loc.adc > 0 ? toAfterBal / n.loc.adc : null;
          out.push({
            id: `dm:${n.loc.itemKey}:${n.loc.locationName}:${ms.locationName}`, section: "main",
            itemKey: recItemKey, itemName, tradeNames, itemCode,unit:s.unit, to: n.loc.locationName, from: ms.locationName,
            problem: `${n.loc.locationName} تغطي ${n.loc.days?.toFixed(1) ?? "—"} يوم — أقل من الهدف ${target}.`,
            action: `اصرف ${fmtNum(give)} من ${ms.locationName} إلى ${n.loc.locationName}.`,
            why: `احتياج الصيدلية = ${fmtNum(Math.ceil(n.loc.adc * target - n.loc.balance))}. المخزن: رصيد ${fmtNum(beforeBal)} − احتياطي ${fmtNum(Math.ceil(reserve))} = متاح ${fmtNum(avail)}. تغطية المخزن ${beforeDays?.toFixed(0) ?? "—"} ← ${afterDays?.toFixed(0) ?? "—"} يوم. تغطية الصيدلية ${n.loc.days?.toFixed(0) ?? "—"} ← ${toAfterDays?.toFixed(0) ?? "—"} يوم.`,
            priority: computePriority(n.loc.days, target), qty: give, kind: "dispense_from_main",
          });
          ms.balance = afterBal; (ms as any).coverageDays = afterDays;
          n.loc.balance = toAfterBal; n.loc.days = toAfterDays;
          remaining -= give;
        }
        if (remaining > 0) {
          const donors = branchState
            .filter((b) => b !== n.loc && b.adc > 0 && b.days != null && b.days > 2 * target)
            .map((b) => ({ loc: b, surplus: Math.max(0, Math.floor(b.balance - b.adc * target)) }))
            .filter((d) => d.surplus > 0)
            .sort((a, b) => b.surplus - a.surplus);
          for (const d of donors) {
            if (remaining <= 0) break;
            const give = Math.min(remaining, d.surplus); if (give <= 0) continue;
            const newFromBal = d.loc.balance - give;
            const newFromDays = d.loc.adc > 0 ? newFromBal / d.loc.adc : null;
            if (newFromDays != null && newFromDays < target) continue;
            const fromBeforeDays = d.loc.days, toBeforeDays = n.loc.days;
            const toAfterBal = n.loc.balance + give;
            const toAfterDays = n.loc.adc > 0 ? toAfterBal / n.loc.adc : null;
            out.push({
              id: `tr:${n.loc.itemKey}:${n.loc.locationName}:${d.loc.locationName}`, section: "transfer",
              itemKey: recItemKey, itemName, tradeNames, itemCode,unit:s.unit, to: n.loc.locationName, from: d.loc.locationName,
              problem: `${d.loc.locationName} لديها فائض (${fromBeforeDays?.toFixed(0)} يوم)، ${n.loc.locationName} ناقصة (${toBeforeDays?.toFixed(0)} يوم).`,
              action: `حوّل ${fmtNum(give)} من ${d.loc.locationName} إلى ${n.loc.locationName}.`,
              why: (mainBlocked.length ? mainBlocked.join(" ") + " " : "") + `المرسل: ${fromBeforeDays?.toFixed(0)} ← ${newFromDays?.toFixed(0)} يوم. المستقبل: ${toBeforeDays?.toFixed(0)} ← ${toAfterDays?.toFixed(0)} يوم.`,
              priority: computePriority(n.loc.days, target), qty: give, kind: "transfer_between",
            });
            d.loc.balance = newFromBal; d.loc.days = newFromDays;
            n.loc.balance = toAfterBal; n.loc.days = toAfterDays;
            remaining -= give;
          }
        }
        unmet+=Math.max(0,remaining);
      }
      if(unmet>0&&hospitalPurchaseQuantity(hospitalBalance,totalBranchAdc,target)===0)out.push({id:`reserve:${recItemKey}`,section:'review',itemKey:recItemKey,itemName,tradeNames,itemCode,unit:s.unit,to:needs[0].loc.locationName,problem:'الرصيد الإجمالي يغطي الهدف، لكن بعض الفروع ناقصة وتحتاج مراجعة التوزيع.',action:'راجع أولوية توزيع الرصيد وسياسة احتياطي المخزن قبل طلب شراء إضافي.',why:`إجمالي الرصيد ${fmtNum(hospitalBalance)} واحتياج الهدف ${fmtNum(totalBranchAdc*target)}. هذا تنبيه مراجعة، وليس تحويلًا أو تغييرًا للاحتياطي.`,priority:'urgent',kind:'review_reserve_policy'});

      for (const b of branches) {
        const dead = b.issued === 0 && b.balance > 0;
        const veryOver = b.adc > 0 && b.days != null && b.days > 2 * target;
        if (!dead && !veryOver) continue;
        out.push({
          id: `nd:${b.itemKey}:${b.locationName}`, section: "no_order",
          itemKey: recItemKey, itemName, tradeNames, itemCode,unit:s.unit, to: b.locationName,
          problem: dead ? `رصيد ${fmtNum(b.balance)} بدون أي صرف هذا الشهر — صنف راكد.` : `الرصيد يغطي ${b.days?.toFixed(0)} يوم — أكثر من ضعف الهدف.`,
          action: dead ? "لا تطلب — راجع جدوى الاحتفاظ به." : "لا تطلب هذا الشهر.",
          why: `رصيد ${fmtNum(b.balance)} • منصرف ${fmtNum(b.issued)} • ${b.days?.toFixed(0) ?? "—"} يوم.`,
          priority: "low", kind: "do_not_order",
        });
      }
      for (const b of branches.filter((x) => x.kind === "no_data")) {
        out.push({
          id: `rv:${b.itemKey}:${b.locationName}`, section: "review",
          itemKey: recItemKey, itemName, tradeNames, itemCode,unit:s.unit, to: b.locationName,
          problem: "البيانات غير كافية للحساب (لا صرف ولا رصيد واضح).",
          action: "راجع صف هذا الصنف في ملف الإكسل.",
          why: `رصيد ${fmtNum(b.balance)} • منصرف ${fmtNum(b.issued)}.`,
          priority: "low", kind: "review_data",
        });
      }
    }
    const helped = new Set<string>();
    for (const r of out) if (r.section === "main" || r.section === "transfer") helped.add(`${r.itemKey}|${r.to}`);
    for (const r of out) {
      if (r.section === "urgent" && !helped.has(`${r.itemKey}|${r.to}`)) {
        r.priority = "very_urgent";
        r.why = `لا يوجد رصيد آمن في المخزن ولا فائض في صيدلية أخرى. ` + r.why;
      }
    }
    return out.sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority]);
  }, [rows, target]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return recs.filter((r) => {
      if (prioFilter !== "all" && r.priority !== prioFilter) return false;
      if (s && !`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.to} ${r.from || ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [recs, q, prioFilter]);

  const sec = (k: Rec["section"]) => filtered.filter((r) => r.section === k);
  const sections: { key: Rec["section"]; title: string }[] = [
    { key: "urgent", title: "نقص عاجل (< 7 أيام)" },
    { key: "main", title: "اصرف من المخزن" },
    { key: "transfer", title: "حوّل بين الصيدليات" },
    { key: "no_order", title: "لا تطلب" },
    { key: "review", title: "راجع البيانات" },
  ];

  function RecCard({ r }: { r: Rec }) {
    const st = (decisions[r.id]?.status as DecisionStatus) || "new";
    const open = whyOpen === r.id;
    return (
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
            <div className="text-xs text-muted-fg mt-1" dir="auto">
              {r.from ? <>من <span className="font-medium text-foreground">{r.from}</span> ← </> : null}
              {r.to ? <>إلى <span className="font-medium text-foreground">{r.to}</span></> : null}
            </div>
          </div>
          <span className={`px-2 py-1 rounded text-xs ${PRIO_CLASS[r.priority]}`}>{PRIO_LABEL[r.priority]}</span>
        </div>
        <div className="mt-3 text-sm" dir="auto"><span className="text-muted-fg">المشكلة: </span>{r.problem}</div>
        <div className="mt-1 text-sm" dir="auto"><span className="text-muted-fg">الإجراء: </span><span className="font-medium">{r.action}</span></div>
        <div className="flex flex-wrap items-center gap-2 mt-3 justify-between">
          <button className="btn-outline text-xs px-2 py-1" onClick={() => setWhyOpen(open ? null : r.id)}>لماذا؟</button>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="px-2 py-0.5 rounded text-[10px] border border-border text-muted-fg">{STATUS_LABEL[st]}</span>
            <button disabled={!canDecide||saving||loading} className="btn-outline text-xs px-2 py-1" onClick={() => setDecision(r, "postponed")}>تأجيل</button>
            <button disabled={!canDecide||saving||loading} className="btn-outline text-xs px-2 py-1" onClick={() => setDecision(r, "rejected")}>رفض</button>
            <button disabled={!canDecide||saving||loading} className="btn-outline text-xs px-2 py-1" onClick={() => setDecision(r, "executed")}>تسجيل كمنفذ</button>
          </div>
        </div>
        {open && <div className="mt-3 text-xs text-muted-fg bg-muted rounded p-3" dir="auto">{r.why}</div>}
      </div>
    );
  }

  if(error)return <p role="alert" className="p-6">تعذر تحديث توصيات العمل: {error}. راجع الاتصال قبل التنفيذ.</p>;
  return (
    <div className="p-6 space-y-5">
      <header>
        <p>القرارات تحفظ في قاعدة البيانات وتدخل النسخ الاحتياطي. الحالة لا تغير المخزون؛ سجل الحركة الفعلية مرة واحدة من سجل الحركات.</p>
        <p className="text-sm text-muted-fg">إجمالي المستشفى = المخزن + الفروع. احتياطي المخزن الحالي قيد على اقتراح التوزيع فقط؛ لا يضاف مرة ثانية إلى احتياج شراء المستشفى.</p>
        {actionError&&<p role="alert">{actionError}</p>}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">مركز العمل اليومي</h1>
            <p className="text-sm text-muted-fg mt-1">قائمة قرارات بناءً على الرصيد المسجل والحركات الفعلية.</p>
          </div>
          <label className="text-sm flex items-center gap-2">
            <span className="text-muted-fg">نافذة:</span>
            <select className="input py-1" value={monthsWindow} onChange={(e) => setMonthsWindow(Number(e.target.value))}>
              <option value={1}>آخر شهر</option><option value={3}>آخر 3 شهور</option><option value={6}>آخر 6 شهور</option>
            </select>
          </label>
        </div>
        {preliminary && <div className="mt-2 text-xs p-2 rounded border border-warn/30 bg-warn-soft text-warn">تنبؤ مبدئي — يحتاج بيانات أشهر إضافية.</div>}
      </header>

      <section className="card p-4 flex flex-wrap items-end gap-3">
        <label><span className="label">هدف التغطية (يوم)</span>
          <input className="input w-32" type="number" value={target} onChange={(e) => setTarget(Number(e.target.value) || 30)} /></label>
        <label className="flex-1 min-w-[180px]"><span className="label">بحث</span>
          <input className="input w-full" placeholder="صنف / صيدلية..." value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label><span className="label">الأولوية</span>
          <select className="input" value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as any)}>
            <option value="all">الكل</option>
            {(Object.keys(PRIO_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIO_LABEL[p]}</option>)}
          </select></label>
        {batch && <div className="text-xs text-muted-fg pb-2">{batch.file_name} — {fmtMonth(batch.month)}</div>}
      </section>

      {loading ? <div className="card p-8 text-center text-muted-fg">جارٍ التحميل...</div>
        : !batch ? <div className="card p-8 text-center">ارفع ملف Excel أولًا.</div>
        : sections.map((s) => {
            const list = sec(s.key);
            if (!list.length) return null;
            return (
              <section key={s.key} className="space-y-2">
                <h2 className="text-lg font-bold">{s.title} <span className="text-sm text-muted-fg">({list.length})</span></h2>
                <div className="grid md:grid-cols-2 gap-3">{list.map((r) => <RecCard key={r.id} r={r} />)}</div>
              </section>
            );
          })}
    </div>
  );
}
