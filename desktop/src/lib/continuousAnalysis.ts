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
  monthsWindow?: number; targetDays?: number; asOf?: string;
} = {}): Promise<ContinuousDataset> {
  const monthsWindow = opts.monthsWindow ?? 3;
  const targetDays = opts.targetDays ?? 30;
  const asOf = opts.asOf ?? new Date().toISOString().substring(0, 10);
  const token = tokenStore.get();

  const bRes = await api.queries.listBatchesContinuous({ token, limit: Math.max(monthsWindow * 2, 6) });
  const batches = (bRes.batches || []) as UploadBatch[];
  if (!batches.length) return { batches: [], latestBatch: null, rows: [], monthsCount: 0, preliminary: true };

  const selected = batches.slice(0, monthsWindow);
  const mRes = await api.queries.movementsByBatchIds({ token, batchIds: selected.map((b) => b.id) });
  const movements = (mRes.movements || []) as Movement[];

  type Cell = {
    sample: Movement; locName: string; locType: string;
    tradeNames: Set<string>;
    issuedByBatch: Map<string, number>;
    latestBalance: number; latestSnapshot: string;
    latestUploadedAt: string;
  };
  const cells = new Map<string, Cell>();
  const batchById = new Map(selected.map((b) => [b.id, b]));

  for (const m of movements) {
    const b = batchById.get(m.upload_batch_id);
    if (!b) continue;
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    let c = cells.get(key);
    if (!c) {
      c = { sample: m, locName: m.location_name, locType: m.location_type,
            tradeNames: new Set<string>(),
            issuedByBatch: new Map(), latestBalance: 0, latestSnapshot: "1970-01-01",
            latestUploadedAt: "1970-01-01T00:00:00.000Z" };
      cells.set(key, c);
    }
    itemTradeNames(m).forEach((n) => c.tradeNames.add(n));
    const prev = c.issuedByBatch.get(b.id) || 0;
    c.issuedByBatch.set(b.id, prev + num(m.issued_qty));
    const snap = (b.snapshot_date || b.month) as string | null;
    if (snap && snap > c.latestSnapshot) {
      c.latestSnapshot = snap;
      c.latestBalance = num(m.closing_balance);
      c.latestUploadedAt = b.uploaded_at;
      c.sample = m;
    }
  }

  const earliest = Array.from(cells.values()).reduce((acc, c) => (c.latestSnapshot < acc ? c.latestSnapshot : acc), asOf);
  const txRes = await api.stockTxn.list({ token, sinceISO: earliest });
  const txns = (txRes.rows || []) as StockTxn[];

  function locBucket(name: string | null, type: string | null) { return `${normalize(type)}|${normalize(name)}`; }
  const snapshotIndex = new Map<string, { snapshot: string; uploadedAt: string }>();
  const itemAliasToCanonical = new Map<string, string>();
  for (const c of cells.values()) {
    const canonical = itemKey(c.sample);
    snapshotIndex.set(`${canonical}|${locBucket(c.locName, c.locType)}`, {
      snapshot: c.latestSnapshot,
      uploadedAt: c.latestUploadedAt,
    });
    for (const alias of itemKeyAliases(c.sample)) itemAliasToCanonical.set(alias, canonical);
  }
  type TxnAgg = { receipts: number; issues: number; transfersIn: number; transfersOut: number; returns: number };
  const txnIndex = new Map<string, Map<string, TxnAgg>>();
  function ensureAgg(itemK: string, loc: string): TxnAgg {
    let m = txnIndex.get(itemK);
    if (!m) { m = new Map(); txnIndex.set(itemK, m); }
    let a = m.get(loc);
    if (!a) { a = { receipts: 0, issues: 0, transfersIn: 0, transfersOut: 0, returns: 0 }; m.set(loc, a); }
    return a;
  }
  function shouldApplyTxn(itemK: string, loc: string, t: StockTxn): boolean {
    const ref = snapshotIndex.get(`${itemK}|${loc}`);
    if (!ref) return false;
    if (t.txn_date > ref.snapshot) return true;
    if (t.txn_date < ref.snapshot) return false;
    if (!t.created_at || !ref.uploadedAt) return false;
    return new Date(t.created_at).getTime() > new Date(ref.uploadedAt).getTime();
  }
  function applyTxn(itemK: string, loc: string, t: StockTxn, field: keyof TxnAgg, q: number) {
    if (shouldApplyTxn(itemK, loc, t)) ensureAgg(itemK, loc)[field] += q;
  }
  function canonicalTxnKey(t: StockTxn): string {
    const raw = normalize(t.item_key || t.item_code || t.item_name);
    return itemAliasToCanonical.get(raw) || raw;
  }
  for (const t of txns) {
    const q = num(t.qty);
    const itm = canonicalTxnKey(t);
    switch (t.txn_type) {
      case "warehouse_receipt":
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "main_warehouse"), t, "receipts", q); break;
      case "warehouse_issue_to_pharmacy":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "main_warehouse"), t, "issues", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy"), t, "receipts", q); break;
      case "pharmacy_issue":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "issues", q); break;
      case "pharmacy_transfer":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "transfersOut", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy"), t, "transfersIn", q); break;
      case "warehouse_return":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "returns", q); break;
      case "pharmacy_return_to_warehouse":
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "issues", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "main_warehouse"), t, "receipts", q); break;
    }
  }

  const branchAdcByItem = new Map<string, number>();
  for (const c of cells.values()) {
    if (isMainLocation(c.locType)) continue;
    const issuedValues = Array.from(c.issuedByBatch.values());
    const monthsForItem = issuedValues.length;
    const issuedAvg = monthsForItem ? issuedValues.reduce((a, b) => a + b, 0) / monthsForItem : 0;
    const activeDays = monthsForItem > 0 ? monthsForItem * 30 : 0;
    const denomDays = activeDays > 0 && activeDays < 30 ? activeDays : 30;
    const adc = issuedAvg / denomDays;
    const itm = itemKey(c.sample);
    branchAdcByItem.set(itm, (branchAdcByItem.get(itm) || 0) + adc);
  }

  const rows: ProjectedRow[] = [];
  for (const c of cells.values()) {
    const issuedValues = Array.from(c.issuedByBatch.values());
    const monthsForItem = issuedValues.length;
    const issuedAvg = monthsForItem ? issuedValues.reduce((a, b) => a + b, 0) / monthsForItem : 0;
    const activeDays = monthsForItem > 0 ? monthsForItem * 30 : 0;
    const denomDays = activeDays > 0 && activeDays < 30 ? activeDays : 30;
    const itm = itemKey(c.sample);
    const isMain = isMainLocation(c.locType);
    const branchAdc = branchAdcByItem.get(itm) || 0;
    const adc = isMain ? branchAdc : issuedAvg / denomDays;

    const lb = locBucket(c.locName, c.locType);
    const agg = txnIndex.get(itm)?.get(lb) || { receipts: 0, issues: 0, transfersIn: 0, transfersOut: 0, returns: 0 };
    const daysSince = c.latestSnapshot ? daysBetween(c.latestSnapshot, asOf) : 0;
    const expectedConsumption = adc * daysSince;
    const projected = c.latestBalance - expectedConsumption
      + agg.receipts - agg.issues
      + agg.transfersIn - agg.transfersOut
      + agg.returns;
    const balance = Math.max(0, projected);
    const days = adc > 0 ? balance / adc : null;
    const kind = isMain ? classifyMainDays(days, balance, branchAdc, targetDays) : classifyBranchDays(days, balance, issuedAvg, targetDays);

    let confidence: Confidence = "low";
    const hasTxns = (agg.receipts + agg.issues + agg.transfersIn + agg.transfersOut + agg.returns) > 0;
    if (monthsForItem < 1) confidence = "weak";
    else if (daysSince <= 7 && hasTxns) confidence = "high";
    else if (daysSince <= 7) confidence = "medium";
    if (activeDays < 30) confidence = "weak";

    let why = "الرصيد المتوقع يغطي احتياج فترة قياسية.";
    let action = "لا يوجد إجراء عاجل.";
    if (isMain && balance <= 0 && branchAdc > 0) {
      why = `المخزن الرئيسي غير متوفر لهذا الصنف، بينما متوسط صرف الفروع ${adc.toFixed(1)} وحدة/يوم.`;
      action = "المخزن الرئيسي لا يغطي الاحتياج؛ راجع التوريد أو التحويلات فورًا.";
    } else if (isMain && balance > 0 && branchAdc <= 0) {
      why = `يوجد رصيد ${Math.round(balance).toLocaleString("ar-EG")} في المخزن الرئيسي بدون صرف واضح في الفروع.`;
      action = "راجع احتياج الفروع قبل اعتبار الرصيد راكدًا.";
    } else if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد المتوقع ${Math.round(balance).toLocaleString("ar-EG")} ÷ متوسط الصرف اليومي ${adc.toFixed(1)} = ${days == null ? 0 : Math.round(days)} يوم تغطية، والهدف ${targetDays} يوم.`;
      action = `زوّد الكمية لتغطية ${targetDays} يوم — حوالي ${Math.max(0, Math.ceil(adc * targetDays - balance)).toLocaleString("ar-EG")} وحدة.`;
    } else if (kind === "over" || kind === "very_over") {
      why = `الرصيد المتوقع يغطي ${days == null ? 0 : Math.round(days)} يوم — أعلى من الاحتياج.`;
      action = "أوقف الطلب مؤقتًا أو حوّل الفائض لصيدلية ناقصة.";
    } else if (kind === "deadstock") {
      why = "رصيد موجود بدون صرف خلال آخر فترة.";
      action = "راجع الاحتياج أو انقل الصنف لمكان يستخدمه.";
    } else if (kind === "no_data") {
      why = "لا يوجد صرف ولا رصيد كافيان للحساب.";
      action = "راجع بيانات الملف لهذا الصنف.";
    }

    rows.push({
      key: `${itm}|${c.locType}|${c.locName}`,
      itemKey: itm,
      itemName: itemDisplayName(c.sample),
      tradeNames: Array.from(c.tradeNames),
      itemCode: c.sample.item_code,
      locationName: c.locName,
      locationType: c.locType,
      balance, issued: issuedAvg, adc, days, kind,
      severity: severityFor(kind),
      why, action,
      snapshotBalance: c.latestBalance,
      projectedBalance: balance,
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
      preliminaryForecast: selected.length < 3,
    });
  }

  rows.sort((a, b) => {
    const order: Record<AlertKind, number> = { critical: 0, danger: 1, below: 2, very_over: 3, over: 4, deadstock: 5, no_data: 6, safe: 7 };
    return order[a.kind] - order[b.kind] || a.itemName.localeCompare(b.itemName, "ar");
  });

  return { batches: selected, latestBatch: selected[0] || null, rows, monthsCount: selected.length, preliminary: selected.length < 3 };
}

export { isMainLocation };
