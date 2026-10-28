import { buildInventoryHistory, locationKey, stockBalances, todayISO, type ConsumptionPeriod } from "../../../shared/inventoryHistory";
import { applyStockLedger,forecastForUncoveredDays } from "../../../shared/stockLedger";
import { api, tokenStore, type Movement, type UploadBatch, type StockTxn } from "@/integrations/desktop/client";
import {
  itemKey, itemKeyAliases, itemDisplayName, itemTradeNames, normalize, num, isMainLocation,
  type AnalysisRow, type AlertKind,
} from "./desktopAnalytics";

export type Confidence = "high" | "medium" | "low" | "weak";
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "ثقة عالية", medium: "ثقة متوسطة", low: "ثقة منخفضة", weak: "بيانات ضعيفة",
};
export const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: "bg-success-soft text-success border border-success/30",
  medium: "bg-primary-soft text-primary border border-primary/30",
  low: "bg-warn-soft text-warn border border-warn/30",
  weak: "bg-danger-soft text-danger border border-danger/40",
};

export type ProjectedRow = AnalysisRow & {
  consumptionPeriods: ConsumptionPeriod[];
  snapshotDate: string;
  hasBalance: boolean;
  hasConsumption: boolean;
  mixedSnapshots: boolean;
  recordedBalance: number;
  recordedDays: number | null;
  projectedDays: number | null;
  ledgerNet: number;
  ledgerWarnings: string[];
  snapshotBoundary: string | null;
  projectionSuppressed: boolean;
  snapshotBalance: number;
  projectedBalance: number;
  projectedKind: AlertKind;
  daysSinceSnapshot: number;
  expectedConsumption: number;
  receiptsAfter: number;
  issuesAfter: number;
  transfersInAfter: number;
  transfersOutAfter: number;
  returnsAfter: number;
  monthsOfData: number;
  activeDays: number;
  confidence: Confidence;
  shortHistoryWarning: boolean;
  preliminaryForecast: boolean;
};

export type ContinuousDataset = {
  batches: UploadBatch[];
  latestBatch: UploadBatch | null;
  rows: ProjectedRow[];
  monthsCount: number;
  preliminary: boolean;
};

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function classifyBranchDays(days: number | null, balance: number, issued: number, target: number): AlertKind {
  const adc = issued / 30;
  if (issued === 0 && balance === 0) return "no_data";
  if (issued === 0 && balance > 0) return "deadstock";
  if (days == null || adc <= 0) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < target) return "below";
  if (days <= target * 2) return "safe";
  if (days <= target * 3) return "over";
  return "very_over";
}

function classifyMainDays(days: number | null, balance: number, branchAdc: number, target: number): AlertKind {
  if (balance <= 0 && branchAdc <= 0) return "no_data";
  if (balance <= 0 && branchAdc > 0) return "critical";
  if (branchAdc <= 0) return "no_data";
  if (days == null) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < target) return "below";
  if (days <= target * 2) return "safe";
  if (days <= target * 3) return "over";
  return "very_over";
}

function severityFor(kind: AlertKind): AnalysisRow["severity"] {
  return kind === "critical" || kind === "danger" ? "high"
    : kind === "below" || kind === "very_over" ? "medium" : "low";
}

export async function loadContinuousAnalysis(opts: {
  groupBy?: "sku" | "scientific";
  batchIds?: string[];
  monthsWindow?: number; targetDays?: number; asOf?: string;
} = {}): Promise<ContinuousDataset> {
  const historyItemKey = (m: Movement) => opts.groupBy === "sku"
    ? [m.item_code, m.item_name_en, m.item_name_ar, m.unit].map(normalize).join("|")
    : itemKey(m);
  const monthsWindow = opts.monthsWindow ?? 3;
  const targetDays = opts.targetDays ?? 30;
  const asOf = opts.asOf ?? todayISO();
  const token = tokenStore.get();

  const bRes = await api.queries.listBatchesContinuous({ token, limit: 10000 });
  const batches = (bRes.batches || []) as UploadBatch[];
  if (!batches.length) return { batches: [], latestBatch: null, rows: [], monthsCount: 0, preliminary: true };

  const selected = batches.filter((b) => (b.snapshot_date || b.month) <= asOf && (!opts.batchIds || opts.batchIds.includes(b.id)));
  const mRes = await api.queries.movementsByBatchIds({ token, batchIds: selected.map((b) => b.id) });
  if (!mRes.ok) throw new Error("تعذر قراءة بيانات الأرصدة");
  let movements = (mRes.movements || []) as Movement[];
  if(api.operations?.call){
    const result=await api.operations.call({token,action:'local_table',payload:{table:'active_ingredient_dictionary',operation:'select',filters:[]}});
    if(!result.ok)throw new Error(result.error||'تعذر قراءة القاموس المحلي');
    const dictionary=new Map<string,any>();
    for(const entry of result.rows||[])if(entry.approved)for(const name of [entry.original_item_name,entry.scientific_name,entry.trade_name,entry.standard_name])if(name)dictionary.set(normalize(name),entry);
    movements=movements.map(m=>{const d=dictionary.get(normalize(m.item_name_ar))||dictionary.get(normalize(m.active_ingredient_ar))||dictionary.get(normalize(m.item_name_en));return d?{...m,active_ingredient_ar:m.active_ingredient_ar||d.active_ingredient||d.scientific_name,item_name_en:m.item_name_en||d.trade_name,strength:m.strength||d.strength,dosage_form:m.dosage_form||d.dosage_form,unit:m.unit||d.unit,therapeutic_group_key:d.therapeutic_group_key}:m;});
  }
  const history = buildInventoryHistory(selected, movements.map((m) => ({
    sample: m, batchId: m.upload_batch_id, item: historyItemKey(m),
    sku: [m.item_code, m.item_name_en, m.item_name_ar, m.unit].map(normalize).join("|"),
    locationName: m.location_name, locationType: m.location_type,
    balance: m.closing_balance, issued: m.issued_qty,
  })), monthsWindow, asOf);
  const namesByCell = new Map<string, Set<string>>();
  for (const movement of movements) {
    const key = `${historyItemKey(movement)}|${locationKey(movement.location_name, movement.location_type)}`;
    const names = namesByCell.get(key) || new Set<string>();
    itemTradeNames(movement).forEach((name) => names.add(name));
    namesByCell.set(key, names);
  }
  const earliest = history.filter(c=>c.hasBalance).reduce((acc,c)=>c.latestSnapshot<acc?c.latestSnapshot:acc,asOf);
  const txRes = await api.stockTxn.list({ token, sinceISO: earliest, all: true });
  if (!txRes.ok) throw new Error('تعذر قراءة الحركات الفعلية');
  const txns = (txRes.rows || []) as StockTxn[];
  const ledger = applyStockLedger(history,txns,asOf,historyItemKey,itemKeyAliases,normalize,movements);
  const cells = new Map(ledger.map((cell,index)=>[index,{
    ...cell, tradeNames:namesByCell.get(`${historyItemKey(cell.sample)}|${locationKey(cell.locName,cell.locType)}`) || new Set(itemTradeNames(cell.sample)),
  }]));

  const branchAdcByItem = new Map<string, number>();
  for (const c of cells.values()) {
    if (isMainLocation(c.locType)) continue;
    const itm = historyItemKey(c.sample);
    branchAdcByItem.set(itm, (branchAdcByItem.get(itm) || 0) + c.adc);
  }

  const rows: ProjectedRow[] = [];
  for (const c of cells.values()) {
    const monthsForItem = c.monthsOfData;
    const issuedAvg = c.issuedAverage;
    const activeDays = c.activeDays;
    const itm = historyItemKey(c.sample);
    const isMain = isMainLocation(c.locType);
    const branchAdc = branchAdcByItem.get(itm) || 0;
    const adc = isMain ? branchAdc : c.adc;

    const agg = c.adjustments;
    const hasBalance = c.hasBalance && !c.mixedSnapshots && c.ledgerWarnings.length === 0;
    const daysSince = c.latestSnapshot ? daysBetween(c.latestSnapshot, asOf) + (c.snapshotBoundary === 'start_of_day' ? 1 : 0) : 0;
    const forecast=forecastForUncoveredDays(adc,daysSince,agg);
    const expectedConsumption = isMain || !hasBalance || !c.hasConsumption ? 0 : forecast.expected;
    const balances = stockBalances(c.latestBalance, agg.receipts, agg.issues,
      agg.transfersIn, agg.transfersOut, agg.returns, expectedConsumption, forecast.suppressed?agg.patientIssues:0);
    const balance = balances.recorded;
    const days = hasBalance && adc > 0 && balance >= 0 ? balance / adc : null;
    const projectedDays = hasBalance && adc > 0 && balance >= 0 ? balances.projected / adc : null;
    const kind: AlertKind = !c.sample.unit || !hasBalance || (!isMain && !c.hasConsumption) || balance < 0
      ? "no_data"
      : isMain ? classifyMainDays(days, balance, branchAdc, targetDays)
      : classifyBranchDays(days, balance, issuedAvg, targetDays);

    let confidence: Confidence = "low";
    const hasTxns = (agg.receipts + agg.issues + agg.transfersIn + agg.transfersOut + agg.returns) > 0;
    if (monthsForItem < 1) confidence = "weak";
    else if (daysSince <= 7 && hasTxns) confidence = "high";
    else if (daysSince <= 7) confidence = "medium";
    if (activeDays < 30 || !c.hasBalance || !c.hasConsumption || c.mixedSnapshots) confidence = "weak";

    let why = "الرصيد المسجل مع الحركات يغطي احتياج فترة قياسية.";
    let action = "لا يوجد إجراء عاجل.";
    if (kind === "no_data") {
      why = c.ledgerWarnings.length ? c.ledgerWarnings.join('؛ ') : !c.hasBalance ? "رصيد غير مسجل؛ لا يعامل كصفر." : c.mixedSnapshots ? "أرصدة بتواريخ أو حدود مختلفة؛ يلزم التحقق قبل القرار." : "بيانات غير مكتملة للحساب.";
      action = "راجع البيانات قبل اقتراح شراء أو تحويل.";
    } else if (isMain && balance <= 0 && branchAdc > 0) {
      why = `المخزن الرئيسي غير متوفر لهذا الصنف، بينما متوسط صرف الفروع ${adc.toFixed(1)} وحدة/يوم.`;
      action = "المخزن الرئيسي لا يغطي الاحتياج؛ راجع التوريد أو التحويلات فورًا.";
    } else if (isMain && balance > 0 && branchAdc <= 0) {
      why = `يوجد رصيد ${Math.round(balance).toLocaleString("ar-EG")} في المخزن الرئيسي بدون صرف واضح في الفروع.`;
      action = "راجع احتياج الفروع قبل اعتبار الرصيد راكدًا.";
    } else if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد المسجل مع الحركات ${Math.round(balance).toLocaleString("ar-EG")} ÷ متوسط الصرف اليومي ${adc.toFixed(1)} = ${days == null ? 0 : Math.round(days)} يوم تغطية، والهدف ${targetDays} يوم.`;
      action = `زوّد الكمية لتغطية ${targetDays} يوم — حوالي ${Math.max(0, Math.ceil(adc * targetDays - balance)).toLocaleString("ar-EG")} وحدة.`;
    } else if (kind === "over" || kind === "very_over") {
      why = `الرصيد المسجل مع الحركات يغطي ${days == null ? 0 : Math.round(days)} يوم — أعلى من الاحتياج.`;
      action = "أوقف الطلب مؤقتًا أو حوّل الفائض لصيدلية ناقصة.";
    } else if (kind === "deadstock") {
      why = "رصيد موجود بدون صرف خلال آخر فترة.";
      action = "راجع الاحتياج أو انقل الصنف لمكان يستخدمه.";

    }

    if (!hasBalance) confidence = 'weak';
    rows.push({
      key: `${itm}|${c.locType}|${c.locName}`,
      itemKey: itm,
      itemName: itemDisplayName(c.sample),
      tradeNames: Array.from(c.tradeNames),
      itemCode: c.sample.item_code,
      unit: c.sample.unit,
      locationName: c.locName,
      locationType: c.locType,
      balance, issued: issuedAvg, adc, days, kind,
      severity: severityFor(kind),
      why, action,
      consumptionPeriods: c.consumptionPeriods,
      snapshotDate: c.latestSnapshot,
      hasBalance,
      hasConsumption: c.hasConsumption,
      mixedSnapshots: c.mixedSnapshots,
      recordedBalance: balance,
      recordedDays: days,
      projectedDays,
      ledgerNet: agg.receipts - agg.issues + agg.transfersIn - agg.transfersOut + agg.returns,
      ledgerWarnings: c.ledgerWarnings,
      snapshotBoundary: c.snapshotBoundary,
      projectionSuppressed: forecast.suppressed,
      snapshotBalance: c.latestBalance,
      projectedBalance: balances.projected,
      projectedKind: kind === 'no_data' ? 'no_data' : isMain ? classifyMainDays(projectedDays, balances.projected, branchAdc, targetDays) : classifyBranchDays(projectedDays, balances.projected, issuedAvg, targetDays),
      daysSinceSnapshot: daysSince,
      expectedConsumption: balances.estimated,
      receiptsAfter: agg.receipts,
      issuesAfter: agg.issues,
      transfersInAfter: agg.transfersIn,
      transfersOutAfter: agg.transfersOut,
      returnsAfter: agg.returns,
      monthsOfData: monthsForItem,
      activeDays, confidence,
      shortHistoryWarning: activeDays < 30,
      preliminaryForecast: monthsForItem < 3,
    });
  }

  rows.sort((a, b) => {
    const order: Record<AlertKind, number> = { critical: 0, danger: 1, below: 2, very_over: 3, over: 4, deadstock: 5, no_data: 6, safe: 7 };
    return order[a.kind] - order[b.kind] || a.itemName.localeCompare(b.itemName, "ar");
  });

  return { batches: selected, latestBatch: selected[0] || null, rows, monthsCount: Math.min(monthsWindow, Math.max(0, ...rows.filter((row) => !isMainLocation(row.locationType)).map((row) => row.monthsOfData))), preliminary: rows.filter((row) => !isMainLocation(row.locationType)).some((row) => row.preliminaryForecast) };
}

export { isMainLocation };
