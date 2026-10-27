import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import {
  analyzeMovements, fmtMonth, fmtNum, isMainLocation,
  KIND_CLASS, KIND_LABEL, loadLatestDataset, tradeNamesLabel,
} from "@/lib/desktopAnalytics";

type DecisionKind = "dispense" | "transfer" | "order" | "none" | "watch";

const DECISION_CLS: Record<DecisionKind, string> = {
  dispense: "bg-success-soft text-success border-success/40",
  transfer: "bg-primary-soft text-primary border-primary/40",
  order: "bg-danger-soft text-danger border-danger/40",
  none: "bg-muted text-muted-fg border-border",
  watch: "bg-warn-soft text-warn border-warn/40",
};

const DECISION_ICON: Record<DecisionKind, string> = {
  dispense: "📦", transfer: "🔁", order: "🛒", none: "⛔", watch: "👁️",
};

export default function ItemDetail() {
  const [sp] = useSearchParams();
  const key = sp.get("key") || "";
  const [target, setTarget] = useState(30);
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    try {
      const d = await loadLatestDataset(api, tokenStore.get());
      setBatch(d.batch); setMovements(d.movements);
    } finally { setLoading(false); }
  })(); }, []);

  const allRows = useMemo(() => analyzeMovements(movements, target), [movements, target]);
  const itemRows = useMemo(() => allRows.filter((r) => r.itemKey === key), [allRows, key]);
  const header = itemRows[0];
  const headerTradeNames = useMemo(() => Array.from(new Set(itemRows.flatMap((r) => r.tradeNames || []))), [itemRows]);
  const headerTradeLabel = tradeNamesLabel(headerTradeNames);

  const mainRows = itemRows.filter((r) => isMainLocation(r.locationType));
  const branchRows = itemRows.filter((r) => !isMainLocation(r.locationType));
  const mainBalance = mainRows.reduce((s, r) => s + r.balance, 0);
  const branchBalance = branchRows.reduce((s, r) => s + r.balance, 0);
  const hospitalBalance = mainBalance + branchBalance;
  const totalIssued = itemRows.reduce((s, r) => s + r.issued, 0);
  const hospitalAdc = totalIssued / 30;
  const branchesAdc = branchRows.reduce((s, r) => s + r.adc, 0);
  const hospitalDays = hospitalAdc > 0 ? hospitalBalance / hospitalAdc : null;
  const mainReserve = Math.ceil(branchesAdc * target);
  const mainAvailable = Math.max(0, mainBalance - mainReserve);

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

  let decision: { kind: DecisionKind; text: string; reason: string } = {
    kind: "watch", text: "متابعة فقط", reason: "لا يوجد نقص حالي يستدعي إجراء.",
  };
  if (shortages.length > 0) {
    if (mainAvailable >= totalNeed && mainAvailable > 0) {
      decision = { kind: "dispense", text: "اصرف من المخزن الرئيسي",
        reason: `المخزن يملك ${fmtNum(mainBalance)} وحدة، وبعد حماية رصيد الأمان (${fmtNum(mainReserve)}) يبقى ${fmtNum(mainAvailable)} متاح للصرف، وهو يكفي لتغطية النقص (${fmtNum(totalNeed)}).` };
    } else if (totalSurplus >= totalNeed && totalSurplus > 0) {
      decision = { kind: "transfer", text: "حوّل من صيدلية فائضة",
        reason: `المخزن لا يملك فائضًا آمنًا كافيًا (المتاح ${fmtNum(mainAvailable)})، لكن يوجد فائض في صيدليات أخرى بإجمالي ${fmtNum(totalSurplus)} يكفي تغطية النقص (${fmtNum(totalNeed)}).` };
    } else {
      decision = { kind: "order", text: "اطلب توريد",
        reason: `النقص ${fmtNum(totalNeed)} لا يمكن تغطيته من المخزن (متاح ${fmtNum(mainAvailable)}) ولا من فائض الصيدليات (${fmtNum(totalSurplus)}).` };
    }
  } else if (surpluses.length > 0) {
    decision = { kind: "none", text: "لا تطلب",
      reason: `لا توجد صيدلية ناقصة، ويوجد فائض ${fmtNum(totalSurplus)} وحدة. تجنّب الطلب حاليًا.` };
  }

  if (loading) return <div className="p-6 text-muted-fg">جارٍ التحميل...</div>;
  if (!header) return <div className="p-6">صنف غير موجود في آخر دفعة. <Link className="text-primary" to="/dictionary">عودة للقاموس</Link></div>;

  const sample = movements.find((m) => itemRows.some((r) => r.itemKey === key));

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" dir="auto">{header.itemName}</h1>
          <p className="text-sm text-muted-fg mt-1">
            {[headerTradeLabel, sample?.active_ingredient_ar, sample?.strength, sample?.dosage_form, sample?.unit].filter(Boolean).join(" — ") || "تفاصيل الصنف لكل صيدلية في الملف الحالي"}
          </p>
          {batch && <div className="text-xs text-muted-fg mt-1">المصدر: {batch.file_name} — {fmtMonth(batch.month)}</div>}
        </div>
        <div className="flex items-center gap-2">
          <select className="input h-9 w-auto" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            <option value={14}>14 يوم</option>
            <option value={30}>30 يوم</option>
            <option value={60}>60 يوم</option>
            <option value={90}>90 يوم</option>
          </select>
          <Link to="/dictionary" className="btn-outline">رجوع</Link>
        </div>
      </header>

      {/* 1. ملخص سريع */}
      <section className="card p-5">
        <div className="font-bold mb-3">ملخص سريع</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
          <Stat label="إجمالي رصيد الصيدليات" value={fmtNum(branchBalance)} />
          <Stat label="رصيد المخزن الرئيسي" value={fmtNum(mainBalance)} />
          <Stat label="إجمالي رصيد المستشفى" value={fmtNum(hospitalBalance)} />
          <Stat label="متوسط الصرف اليومي" value={fmtNum(hospitalAdc, 1)} />
          <Stat label="تغطية المستشفى (يوم)" value={hospitalDays == null ? "—" : fmtNum(hospitalDays)} />
          <Stat label="كود الصنف" value={header.itemCode || "—"} />
        </div>
        <div className={`mt-4 p-4 rounded border flex items-start gap-3 ${DECISION_CLS[decision.kind]}`}>
          <div className="text-xl shrink-0">{DECISION_ICON[decision.kind]}</div>
          <div>
            <div className="text-xs opacity-80">القرار المقترح</div>
            <div className="font-bold text-base">{decision.text}</div>
            <div className="text-xs mt-1 opacity-90">{decision.reason}</div>
          </div>
        </div>
      </section>

      {/* 2. جدول الصيدليات */}
      <section className="card p-5">
        <div className="font-bold mb-3">تغطية الصنف لكل صيدلية</div>
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-fg text-xs">
              <tr>
                <th className="text-right p-2 min-w-[200px]">الصيدلية</th>
                <th className="p-2">الرصيد</th>
                <th className="p-2">المنصرف</th>
                <th className="p-2">متوسط يومي</th>
                <th className="p-2">يكفي (يوم)</th>
                <th className="p-2">الحالة</th>
                <th className="text-right p-2 min-w-[240px]">الإجراء المقترح</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((r) => (
                <tr key={r.key} className="border-t border-border/60 align-top">
                  <td className="p-2 font-semibold">{r.locationName}
                    <div className="text-[10px] text-muted-fg">{isMainLocation(r.locationType) ? "مخزن رئيسي" : "صيدلية فرعية"}</div>
                  </td>
                  <td className="p-2 text-center">{fmtNum(r.balance)}</td>
                  <td className="p-2 text-center">{fmtNum(r.issued)}</td>
                  <td className="p-2 text-center">{fmtNum(r.adc, 1)}</td>
                  <td className="p-2 text-center font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                  <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                  <td className="p-2 text-xs text-muted-fg leading-snug">{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 & 4. أين النقص / أين الفائض */}
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card p-5">
          <div className="font-bold mb-3">📉 أين النقص؟</div>
          {shortages.length === 0 ? (
            <div className="text-sm text-muted-fg">لا توجد صيدلية تحتاج دعمًا.</div>
          ) : (
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-fg"><tr>
                  <th className="text-right p-2">الصيدلية</th>
                  <th className="p-2">الرصيد</th>
                  <th className="p-2">يكفي (يوم)</th>
                  <th className="p-2">الاحتياج</th>
                  <th className="p-2">الحالة</th>
                </tr></thead>
                <tbody>
                  {shortages.map((r) => (
                    <tr key={`s-${r.key}`} className="border-t border-border/60">
                      <td className="p-2 font-semibold">{r.locationName}</td>
                      <td className="p-2 text-center">{fmtNum(r.balance)}</td>
                      <td className="p-2 text-center font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                      <td className="p-2 text-center">{fmtNum(r.need)}</td>
                      <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="font-bold mb-3">📈 أين الفائض؟</div>
          {surpluses.length === 0 ? (
            <div className="text-sm text-muted-fg">لا توجد صيدلية لديها فائض قابل للتحويل.</div>
          ) : (
            <div className="overflow-x-auto border border-border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-fg"><tr>
                  <th className="text-right p-2">الصيدلية</th>
                  <th className="p-2">الرصيد</th>
                  <th className="p-2">يكفي (يوم)</th>
                  <th className="p-2">الفائض</th>
                  <th className="p-2">الحالة</th>
                </tr></thead>
                <tbody>
                  {surpluses.map((r) => (
                    <tr key={`o-${r.key}`} className="border-t border-border/60">
                      <td className="p-2 font-semibold">{r.locationName}</td>
                      <td className="p-2 text-center">{fmtNum(r.balance)}</td>
                      <td className="p-2 text-center font-semibold">{r.days == null ? "—" : r.days.toFixed(0)}</td>
                      <td className="p-2 text-center">{fmtNum(r.surplus)}</td>
                      <td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* 5. ماذا أفعل؟ */}
      <section className="card p-5">
        <div className="font-bold mb-3">ماذا أفعل؟</div>
        <div className="grid md:grid-cols-2 gap-3">
          <ActionBlock active={decision.kind === "dispense"} icon="📦" title="اصرف من المخزن الرئيسي"
            body={mainAvailable > 0 && shortages.length > 0
              ? `يوجد ${fmtNum(mainAvailable)} وحدة متاحة بعد حماية رصيد الأمان (${fmtNum(mainReserve)}). وزّعها على الصيدليات الناقصة حسب الأولوية.`
              : `لا يمكن الصرف الآن. رصيد المخزن ${fmtNum(mainBalance)} ورصيد الأمان المطلوب ${fmtNum(mainReserve)}، أي متاح ${fmtNum(mainAvailable)}.`} />
          <ActionBlock active={decision.kind === "transfer"} icon="🔁" title="حوّل من صيدلية فائضة"
            body={surpluses.length > 0 && shortages.length > 0
              ? `يوجد فائض ${fmtNum(totalSurplus)} وحدة في ${surpluses.length} صيدلية يمكن تحويلها لتغطية النقص (${fmtNum(totalNeed)}).`
              : "لا توجد صيدلية فائضة قابلة للتحويل حاليًا، أو لا يوجد نقص."} />
          <ActionBlock active={decision.kind === "order"} icon="🛒" title="اطلب توريد"
            body={decision.kind === "order"
              ? `النقص ${fmtNum(totalNeed)} لا يغطيه لا المخزن ولا فائض الصيدليات. اطلب توريدًا بكمية لا تقل عن ${fmtNum(totalNeed)} وحدة.`
              : "لا حاجة لطلب توريد حاليًا."} />
          <ActionBlock active={decision.kind === "none"} icon="⛔" title="لا تطلب"
            body={shortages.length === 0
              ? `رصيد المستشفى ${fmtNum(hospitalBalance)} يكفي ${hospitalDays == null ? "—" : Math.round(hospitalDays)} يوم. لا تطلب الآن.`
              : "يوجد نقص — لا ينطبق."} />
        </div>
      </section>

      {/* 6. لماذا؟ */}
      <section className="card p-5">
        <div className="font-bold mb-3">لماذا؟ شرح الحسابات</div>
        <ul className="space-y-2 text-sm leading-7 list-disc pr-5">
          <li>إجمالي المنصرف الشهري <b>{fmtNum(totalIssued)}</b> ÷ 30 = متوسط صرف يومي <b>{fmtNum(hospitalAdc, 1)}</b> وحدة/يوم.</li>
          <li>إجمالي رصيد المستشفى <b>{fmtNum(hospitalBalance)}</b> (مخزن {fmtNum(mainBalance)} + صيدليات {fmtNum(branchBalance)}) ÷ المتوسط اليومي = <b>{hospitalDays == null ? "—" : fmtNum(hospitalDays)}</b> يوم تغطية.</li>
          <li>إجمالي متوسط صرف الصيدليات الفرعية <b>{fmtNum(branchesAdc, 1)}</b> × هدف التغطية <b>{target}</b> يوم = رصيد الأمان المطلوب للمخزن <b>{fmtNum(mainReserve)}</b>.</li>
          <li>المتاح للصرف من المخزن = رصيد المخزن <b>{fmtNum(mainBalance)}</b> − رصيد الأمان <b>{fmtNum(mainReserve)}</b> = <b>{fmtNum(mainAvailable)}</b>.</li>
          <li>إجمالي احتياج الصيدليات الناقصة = <b>{fmtNum(totalNeed)}</b>. إجمالي فائض الصيدليات = <b>{fmtNum(totalSurplus)}</b>.</li>
          <li>القرار: <b>{decision.text}</b> — {decision.reason}</li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded border border-border p-3">
      <div className="text-xs text-muted-fg">{label}</div>
      <div className="text-base font-bold mt-1" dir="auto">{value}</div>
    </div>
  );
}

function ActionBlock({ active, icon, title, body }: { active: boolean; icon: string; title: string; body: string }) {
  return (
    <div className={`p-4 rounded border ${active ? "border-primary bg-primary-soft" : "border-border bg-muted/30 opacity-70"}`}>
      <div className="flex items-center gap-2 font-semibold mb-1">
        <span>{icon}</span>
        <span>{title}</span>
        {active && <span className="pill border bg-primary text-white border-primary text-[10px]">القرار الحالي</span>}
      </div>
      <div className="text-sm text-muted-fg leading-snug">{body}</div>
    </div>
  );
}
