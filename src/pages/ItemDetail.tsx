import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
import { useParams, Link } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import DataSourceCard from "@/components/DataSourceCard";
import { Card } from "@/components/ui/card";
import { fmtNum } from "@/lib/format";
import { ArrowRight, AlertTriangle, TrendingUp, TrendingDown, Package, ArrowLeftRight, ShoppingCart, Ban } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchLatestBatch, fetchMovementsByBatch, analyzeMovements,
  KIND_CLASS, KIND_LABEL, isMainLocation, tradeNamesLabel,
} from "@/lib/batchAnalysis";
import FirstActiveDateButton from "@/components/FirstActiveDateButton";
import { supabase } from "@/integrations/supabase/client";

export default function ItemDetail() {
  const { id } = useParams(); // id is the itemKey
  const [target, setTarget] = useState(30);

  const datasetQ = useQuery({ queryKey: ["item-current-history", target], queryFn: () => loadContinuousAnalysis({ targetDays: target }) });
  const batch = datasetQ.data?.latestBatch || null;
  const movements = datasetQ.data?.rows || [];
  const loading = datasetQ.isLoading;
  const rows = datasetQ.data?.rows || [];
  const itemRows = useMemo(() => rows.filter((r) => r.itemKey === decodeURIComponent(id || "")), [rows, id]);

  const header = itemRows[0];
  const headerTradeNames = useMemo(
    () => Array.from(new Set(itemRows.flatMap((r) => r.tradeNames || []))),
    [itemRows],
  );
  const headerTradeLabel = tradeNamesLabel(headerTradeNames);

  // Item master metadata: first_active_date + new-item detection
  const itemMetaQ = useQuery({
    queryKey: ["item-meta", header?.itemCode],
    enabled: !!header?.itemCode,
    queryFn: async () => {
      const code = header!.itemCode!;
      const [masterRes, distinctRes] = await Promise.all([
        (supabase as any).from("item_master")
          .select("first_active_date").eq("item_code", code).maybeSingle(),
        (supabase as any).from("inventory_movements")
          .select("upload_batch_id").eq("item_code", code).range(0, 999),
      ]);
      const firstActiveDate = (masterRes.data?.first_active_date as string | null) || null;
      const batchIds = new Set((distinctRes.data || []).map((r: any) => r.upload_batch_id));
      const isNew = batch?.id ? (batchIds.size === 1 && batchIds.has(batch.id)) : false;
      return { firstActiveDate, isNew };
    },
  });
  const meta = itemMetaQ.data;
  const preliminaryNew = meta?.isNew && !meta?.firstActiveDate;

  const mainRows = itemRows.filter((r) => isMainLocation(r.locationType));
  const branchRows = itemRows.filter((r) => !isMainLocation(r.locationType));
  const mainBalance = mainRows.reduce((s, r) => s + r.balance, 0);
  const branchBalance = branchRows.reduce((s, r) => s + r.balance, 0);
  const hospitalBalance = mainBalance + branchBalance;
  const totalIssued = branchRows.reduce((s, r) => s + r.issued, 0);
  const hospitalAdc = branchRows.reduce((sum, row) => sum + row.adc, 0);
  const branchesAdc = branchRows.reduce((s, r) => s + r.adc, 0);
  const hospitalDays = itemRows.every((row) => row.hasBalance) && new Set(itemRows.map((row) => row.snapshotDate)).size <= 1 && hospitalAdc > 0 ? hospitalBalance / hospitalAdc : null;
  const mainReserve = Math.ceil(branchesAdc * target);
  const mainAvailable = Math.max(0, mainBalance - mainReserve);

  const incomplete = itemRows.some((row) => row.kind === "no_data") || new Set(itemRows.map((row) => row.snapshotDate)).size > 1;
  const shortages = branchRows
    .filter((r) => r.kind === "critical" || r.kind === "danger" || r.kind === "below")
    .map((r) => ({ ...r, need: Math.max(0, Math.ceil(r.adc * target - r.balance)) }))
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  const surpluses = branchRows
    .filter((r) => r.kind === "over" || r.kind === "very_over" || r.kind === "deadstock")
    .map((r) => ({ ...r, surplus: Math.max(0, Math.floor(r.balance - r.adc * target)) }))
    .sort((a, b) => b.surplus - a.surplus);

  const totalNeed = shortages.reduce((s, r) => s + r.need, 0);
  const totalSurplus = surpluses.reduce((s, r) => s + r.surplus, 0);

  // Decision
  let decision: { kind: "dispense" | "transfer" | "order" | "none" | "watch"; text: string; reason: string } = {
    kind: "watch", text: "متابعة فقط", reason: "لا يوجد نقص حالي يستدعي إجراء.",
  };
  if (shortages.length > 0) {
    if (mainAvailable >= totalNeed && mainAvailable > 0) {
      decision = {
        kind: "dispense",
        text: "اصرف من المخزن الرئيسي",
        reason: `المخزن يملك ${fmtNum(mainBalance)} وحدة، وبعد حماية رصيد الأمان (${fmtNum(mainReserve)}) يبقى ${fmtNum(mainAvailable)} متاح للصرف، وهو يكفي لتغطية النقص (${fmtNum(totalNeed)}).`,
      };
    } else if (totalSurplus >= totalNeed && totalSurplus > 0) {
      decision = {
        kind: "transfer",
        text: "حوّل من صيدلية فائضة",
        reason: `المخزن لا يملك فائضًا آمنًا كافيًا (المتاح ${fmtNum(mainAvailable)})، لكن يوجد فائض في صيدليات أخرى بإجمالي ${fmtNum(totalSurplus)} يكفي تغطية النقص (${fmtNum(totalNeed)}).`,
      };
    } else {
      decision = {
        kind: "order",
        text: "اطلب توريد",
        reason: `النقص ${fmtNum(totalNeed)} لا يمكن تغطيته من المخزن (متاح ${fmtNum(mainAvailable)}) ولا من فائض الصيدليات (${fmtNum(totalSurplus)}).`,
      };
    }
  } else if (surpluses.length > 0 && shortages.length === 0) {
    decision = {
      kind: "none",
      text: "لا تطلب",
      reason: `لا توجد صيدلية ناقصة، ويوجد فائض ${fmtNum(totalSurplus)} وحدة. تجنّب الطلب حاليًا.`,
    };
  }

  if (incomplete) decision = { kind: "watch", text: "راجع البيانات أولًا", reason: "بيانات غير مكتملة أو أرصدة بتواريخ مختلفة؛ لا يعتمد شراء أو تحويل تلقائيًا." };

  const DECISION_STYLE: Record<typeof decision.kind, { cls: string; Icon: any }> = {
    dispense: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40", Icon: Package },
    transfer: { cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40", Icon: ArrowLeftRight },
    order: { cls: "bg-destructive/15 text-destructive border-destructive/40", Icon: ShoppingCart },
    none: { cls: "bg-muted text-muted-foreground border-border", Icon: Ban },
    watch: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40", Icon: AlertTriangle },
  };
  const DStyle = DECISION_STYLE[decision.kind];

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title={header?.itemName || "صنف"}
        description={[headerTradeLabel, header?.scientific, header?.unit].filter(Boolean).join(" · ") || "تفاصيل الصنف لكل صيدلية في الملف الحالي"}
        actions={
          <div className="flex items-center gap-2">
            {header?.itemCode && (
              <FirstActiveDateButton
                itemCode={header.itemCode}
                itemName={header.itemName}
                currentDate={meta?.firstActiveDate || null}
              />
            )}
            <select className="rounded-md border border-input bg-background px-3 h-9 text-sm"
              value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
            <Link to="/dictionary" className="text-sm text-primary inline-flex items-center gap-1">
              <ArrowRight className="w-4 h-4" /> رجوع
            </Link>
          </div>
        }
      />

      <DataSourceCard batch={batch} loading={loading} targetDays={target} rowsCount={movements.length} />

      {meta?.isNew && (
        <Card className="p-4 mb-4 border-sky-500/40 bg-sky-500/10">
          <div className="flex items-start gap-3 text-sm">
            <span className="px-2 py-0.5 rounded text-xs border border-sky-500/40 bg-sky-500/20 text-sky-800 dark:text-sky-200 shrink-0">
              صنف جديد
            </span>
            <div>
              <div className="font-semibold">
                ظهر هذا الصنف لأول مرة في آخر ملف مرفوع.
              </div>
              {preliminaryNew ? (
                <div className="text-xs mt-1 text-amber-700 dark:text-amber-300">
                  ⚠️ توقع مبدئي — لم يتم تحديد تاريخ بداية استخدام الصنف. الحساب يستخدم 30 يوم مؤقتًا، وقد يكون متوسط الصرف اليومي غير دقيق.
                </div>
              ) : (
                <div className="text-xs mt-1 text-muted-foreground">
                  يتم حساب متوسط الصرف اليومي على عدد الأيام منذ <b>{meta?.firstActiveDate}</b>.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {!loading && !header && (
        <Card className="p-8 text-center text-muted-foreground">
          هذا الصنف غير موجود في الملف الحالي.
        </Card>
      )}

      {header && (
        <>
          {/* 1. ملخص سريع */}
          <Card className="p-5 mb-4">
            <div className="font-bold mb-3">ملخص سريع</div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              <Stat label="إجمالي رصيد الصيدليات" value={fmtNum(branchBalance)} />
              <Stat label="رصيد المخزن الرئيسي" value={fmtNum(mainBalance)} />
              <Stat label="إجمالي رصيد المستشفى" value={fmtNum(hospitalBalance)} />
              <Stat label="متوسط الصرف اليومي" value={fmtNum(hospitalAdc, 1)} />
              <Stat label="تغطية المستشفى (يوم)" value={hospitalDays == null ? "—" : fmtNum(hospitalDays)} />
              <Stat label="كود الصنف" value={header.itemCode || "—"} />
            </div>
            <div className={`mt-4 p-4 rounded-md border flex items-start gap-3 ${DStyle.cls}`}>
              <DStyle.Icon className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <div className="text-xs opacity-80">القرار المقترح</div>
                <div className="font-bold text-base">{decision.text}</div>
                <div className="text-xs mt-1 opacity-90">{decision.reason}</div>
              </div>
            </div>
          </Card>

          {/* 2. جدول الصيدليات */}
          <Card className="p-5 mb-4">
            <div className="font-bold mb-3">تغطية الصنف لكل صيدلية</div>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs">
                  <tr>
                    <th className="text-right p-2 min-w-[200px]">الصيدلية</th>
                    <th className="text-right p-2">الرصيد</th>
                    <th className="text-right p-2">متوسط منصرف (30 يومًا)</th>
                    <th className="text-right p-2">متوسط يومي</th>
                    <th className="text-right p-2">يكفي (يوم)</th>
                    <th className="text-right p-2">الحالة</th>
                    <th className="text-right p-2 min-w-[240px]">التوصية</th>
                  </tr>
                </thead>
                <tbody>
                  {itemRows.map((r) => (
                    <tr key={r.key} className="border-t align-top">
                      <td className="p-2 font-medium">{r.locationName}
                        <div className="text-[10px] text-muted-foreground">
                          {r.locationType === "main_warehouse" || r.locationType === "main_store" ? "مخزن رئيسي" : "صيدلية فرعية"}
                        </div>
                      </td>
                      <td className="p-2">{fmtNum(r.balance)}</td>
                      <td className="p-2">{fmtNum(r.issued)}</td>
                      <td className="p-2">{fmtNum(r.adc, 1)}</td>
                      <td className="p-2 font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                      <td className="p-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${KIND_CLASS[r.kind]}`}>
                          {KIND_LABEL[r.kind]}
                        </span>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground whitespace-normal break-words leading-snug">
                        {r.action}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* 3 & 4. النقص والفائض */}
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Card className="p-5">
              <div className="font-bold mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-destructive" /> أين النقص؟
              </div>
              {shortages.length === 0 ? (
                <div className="text-sm text-muted-foreground">لا توجد صيدلية تحتاج دعمًا.</div>
              ) : (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        <th className="text-right p-2">الصيدلية</th>
                        <th className="text-right p-2">الرصيد</th>
                        <th className="text-right p-2">يكفي (يوم)</th>
                        <th className="text-right p-2">الاحتياج</th>
                        <th className="text-right p-2">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortages.map((r) => (
                        <tr key={`s-${r.key}`} className="border-t">
                          <td className="p-2 font-medium">{r.locationName}</td>
                          <td className="p-2">{fmtNum(r.balance)}</td>
                          <td className="p-2 font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                          <td className="p-2">{fmtNum(r.need)}</td>
                          <td className="p-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${KIND_CLASS[r.kind]}`}>
                              {KIND_LABEL[r.kind]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="font-bold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-600" /> أين الفائض؟
              </div>
              {surpluses.length === 0 ? (
                <div className="text-sm text-muted-foreground">لا توجد صيدلية لديها فائض قابل للتحويل.</div>
              ) : (
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        <th className="text-right p-2">الصيدلية</th>
                        <th className="text-right p-2">الرصيد</th>
                        <th className="text-right p-2">يكفي (يوم)</th>
                        <th className="text-right p-2">الفائض</th>
                        <th className="text-right p-2">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {surpluses.map((r) => (
                        <tr key={`o-${r.key}`} className="border-t">
                          <td className="p-2 font-medium">{r.locationName}</td>
                          <td className="p-2">{fmtNum(r.balance)}</td>
                          <td className="p-2 font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                          <td className="p-2">{fmtNum(r.surplus)}</td>
                          <td className="p-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${KIND_CLASS[r.kind]}`}>
                              {KIND_LABEL[r.kind]}
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

          {/* 5. ماذا أفعل؟ */}
          <Card className="p-5 mb-4">
            <div className="font-bold mb-3">ماذا أفعل؟</div>
            <div className="grid md:grid-cols-2 gap-3">
              <ActionBlock active={decision.kind === "dispense"} icon={Package}
                title="اصرف من المخزن الرئيسي"
                body={mainAvailable > 0 && shortages.length > 0
                  ? `يوجد ${fmtNum(mainAvailable)} وحدة متاحة بعد حماية رصيد الأمان (${fmtNum(mainReserve)}). وزّعها على الصيدليات الناقصة بالترتيب حسب الأولوية.`
                  : `لا يمكن الصرف الآن. رصيد المخزن ${fmtNum(mainBalance)} ورصيد الأمان المطلوب ${fmtNum(mainReserve)}، أي متاح ${fmtNum(mainAvailable)}.`}
              />
              <ActionBlock active={decision.kind === "transfer"} icon={ArrowLeftRight}
                title="حوّل من صيدلية فائضة"
                body={surpluses.length > 0 && shortages.length > 0
                  ? `يوجد فائض ${fmtNum(totalSurplus)} وحدة في ${surpluses.length} صيدلية يمكن تحويلها لتغطية النقص (${fmtNum(totalNeed)}).`
                  : "لا توجد صيدلية فائضة قابلة للتحويل حاليًا، أو لا يوجد نقص."}
              />
              <ActionBlock active={decision.kind === "order"} icon={ShoppingCart}
                title="اطلب توريد"
                body={decision.kind === "order"
                  ? `النقص ${fmtNum(totalNeed)} لا يغطيه لا المخزن ولا فائض الصيدليات. اطلب توريدًا بكمية لا تقل عن ${fmtNum(totalNeed)} وحدة.`
                  : "لا حاجة لطلب توريد حاليًا."}
              />
              <ActionBlock active={decision.kind === "none"} icon={Ban}
                title="لا تطلب"
                body={shortages.length === 0
                  ? `رصيد المستشفى ${fmtNum(hospitalBalance)} يكفي ${hospitalDays == null ? "—" : Math.round(hospitalDays)} يوم. لا تطلب الآن.`
                  : "يوجد نقص — لا ينطبق."}
              />
            </div>
          </Card>

          {/* 6. لماذا؟ */}
          <Card className="p-5 mb-4">
            <div className="font-bold mb-3">لماذا؟ شرح الحسابات</div>
            <ul className="space-y-2 text-sm leading-7 list-disc pr-5">
              <li>متوسط منصرف الفروع المعياري (30 يومًا) <b>{fmtNum(totalIssued)}</b> ÷ 30 = متوسط صرف يومي <b>{fmtNum(hospitalAdc, 1)}</b> وحدة/يوم. منصرف شهر بعينه متاح في صفحة «منصرف المستشفى».</li>
              <li>إجمالي رصيد المستشفى <b>{fmtNum(hospitalBalance)}</b> (مخزن {fmtNum(mainBalance)} + صيدليات {fmtNum(branchBalance)}) ÷ المتوسط اليومي = <b>{hospitalDays == null ? "—" : fmtNum(hospitalDays)}</b> يوم تغطية.</li>
              <li>إجمالي متوسط صرف الصيدليات الفرعية <b>{fmtNum(branchesAdc, 1)}</b> × هدف التغطية <b>{target}</b> يوم = رصيد الأمان المطلوب للمخزن <b>{fmtNum(mainReserve)}</b>.</li>
              <li>المتاح للصرف من المخزن = رصيد المخزن <b>{fmtNum(mainBalance)}</b> − رصيد الأمان <b>{fmtNum(mainReserve)}</b> = <b>{fmtNum(mainAvailable)}</b>.</li>
              <li>إجمالي احتياج الصيدليات الناقصة = <b>{fmtNum(totalNeed)}</b>. إجمالي فائض الصيدليات = <b>{fmtNum(totalSurplus)}</b>.</li>
              <li>القرار: <b>{decision.text}</b> — {decision.reason}</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold mt-1" dir="auto">{value}</div>
    </div>
  );
}

function ActionBlock({ active, icon: Icon, title, body }: { active: boolean; icon: any; title: string; body: string }) {
  return (
    <div className={`p-4 rounded-md border flex items-start gap-3 ${active ? "border-primary bg-primary/5" : "border-border bg-muted/20 opacity-80"}`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <div>
        <div className="font-bold text-sm">{title}{active && <span className="text-[10px] text-primary mr-2">(موصى به)</span>}</div>
        <div className="text-xs text-muted-foreground mt-1 leading-6">{body}</div>
      </div>
    </div>
  );
}
