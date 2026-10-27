import { buildInventoryHistory, locationKey, stockBalances, todayISO, type ConsumptionPeriod } from "../../../shared/inventoryHistory";
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
  projectionSuppressed: boolean;
  snapshotBalance: number;
  projectedBalance: number;
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
  const movements = (mRes.movements || []) as Movement[];
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
  const cells = new Map(history.map((cell, index) => [index, {
    ...cell, tradeNames: namesByCell.get(`${historyItemKey(cell.sample)}|${locationKey(cell.locName, cell.locType)}`) || new Set<string>(),
  }]));

  const earliest = Array.from(cells.values()).reduce((acc, c) => (c.latestSnapshot < acc ? c.latestSnapshot : acc), asOf);
  const txRes = await api.stockTxn.list({ token, sinceISO: earliest });
  const txns = (txRes.rows || []) as StockTxn[];

  function locBucket(name: string | null, type: string | null) { return locationKey(name, type); }
  const snapshotIndex = new Map<string, { snapshot: string; uploadedAt: string; mixed: boolean; unit: string | null }>();
  const itemAliasToCanonical = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  for (const c of cells.values()) {
    const canonical = historyItemKey(c.sample);
    snapshotIndex.set(`${canonical}|${locBucket(c.locName, c.locType)}`, {
      mixed: c.mixedSnapshots,
      unit: c.sample.unit,
      snapshot: c.latestSnapshot,
      uploadedAt: c.latestUploadedAt,
    });
    for (const alias of itemKeyAliases(c.sample)) {
      const prior = itemAliasToCanonical.get(alias);
      if (prior && prior !== canonical) ambiguousAliases.add(alias);
      else itemAliasToCanonical.set(alias, canonical);
    }
  }
  for (const movement of movements) {
    const canonical = historyItemKey(movement);
    for (const alias of itemKeyAliases(movement)) {
      const prior = itemAliasToCanonical.get(alias);
      if (prior && prior !== canonical) ambiguousAliases.add(alias);
      else itemAliasToCanonical.set(alias, canonical);
    }
  }

  type TxnAgg = { receipts: number; issues: number; patientIssues: number; transfersIn: number; transfersOut: number; returns: number };
  const txnIndex = new Map<string, Map<string, TxnAgg>>();
  function ensureAgg(itemK: string, loc: string): TxnAgg {
    let m = txnIndex.get(itemK);
    if (!m) { m = new Map(); txnIndex.set(itemK, m); }
    let a = m.get(loc);
    if (!a) { a = { receipts: 0, issues: 0, patientIssues: 0, transfersIn: 0, transfersOut: 0, returns: 0 }; m.set(loc, a); }
    return a;
  }
  function shouldApplyTxn(itemK: string, loc: string, t: StockTxn): boolean {
    const ref = snapshotIndex.get(`${itemK}|${loc}`);
    if (!ref || ref.mixed || (t.unit && normalize(t.unit) !== normalize(ref.unit))) return false;
    if (t.txn_date > ref.snapshot) return true;
    if (t.txn_date < ref.snapshot) return false;
    if (!t.created_at || !ref.uploadedAt) return false;
    return new Date(t.created_at).getTime() > new Date(ref.uploadedAt).getTime();
  }
  function applyTxn(itemK: string, loc: string, t: StockTxn, field: keyof TxnAgg, q: number) {
    if (shouldApplyTxn(itemK, loc, t)) ensureAgg(itemK, loc)[field] += q;
  }
  function canonicalTxnKey(t: StockTxn): string {
    const raw = normalize(t.item_code || t.item_key || t.item_name);
    return ambiguousAliases.has(raw) ? "" : itemAliasToCanonical.get(raw) || raw;
  }
  for (const t of txns) {
    if (t.txn_date > asOf) continue;
    const q = num(t.qty);
    if (q <= 0) continue;
    const itm = canonicalTxnKey(t);
    switch (t.txn_type) {
      case "warehouse_receipt":
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "main_warehouse"), t, "receipts", q); break;
      case "warehouse_issue_to_pharmacy":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "main_warehouse"), t, "issues", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy"), t, "receipts", q); break;
      case "pharmacy_issue":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "issues", q);
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "patientIssues", q); break;
      case "pharmacy_transfer":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "transfersOut", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy"), t, "transfersIn", q); break;
      case "warehouse_return":
      case "pharmacy_return_to_warehouse":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "issues", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "main_warehouse"), t, "receipts", q); break;
    }
  }

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

    const lb = locBucket(c.locName, c.locType);
    const agg = txnIndex.get(itm)?.get(lb) || { receipts: 0, issues: 0, patientIssues: 0, transfersIn: 0, transfersOut: 0, returns: 0 };
    const daysSince = c.latestSnapshot ? daysBetween(c.latestSnapshot, asOf) : 0;
    const expectedConsumption = isMain ? 0 : adc * daysSince;
    const balances = stockBalances(c.latestBalance, agg.receipts, agg.issues,
      agg.transfersIn, agg.transfersOut, agg.returns, expectedConsumption, agg.patientIssues);
    const balance = balances.recorded;
    const days = c.hasBalance && adc > 0 ? balance / adc : null;
    const kind: AlertKind = !c.sample.unit || !c.hasBalance || c.mixedSnapshots || (!isMain && !c.hasConsumption) || balance < 0
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
      why = !c.hasBalance ? "رصيد غير مسجل؛ لا يعامل كصفر." : c.mixedSnapshots ? "أرصدة بتواريخ مختلفة؛ يلزم التحقق قبل القرار." : "بيانات غير مكتملة للحساب.";
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
      hasBalance: c.hasBalance,
      hasConsumption: c.hasConsumption,
      mixedSnapshots: c.mixedSnapshots,
      recordedBalance: balance,
      projectionSuppressed: agg.patientIssues > 0,
      snapshotBalance: c.latestBalance,
      projectedBalance: balances.projected,
      daysSinceSnapshot: daysSince,
      expectedConsumption,
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
