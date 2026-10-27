import { supabase } from "@/integrations/supabase/client";
import {
  type AnalysisRow,
  type AlertKind,
  type Movement,
  type UploadBatch,
  itemKey,
  itemKeyAliases,
  itemDisplayName,
  itemTradeNames,
  normalize,
  num,
  isMainLocation,
  fetchActiveIngredientDictionary,
  enrichMovementsWithDictionary,
  sortBatchesForAnalysis,
} from "./batchAnalysis";
import { classifyBranch as classifyBranchDays, classifyMain as classifyMainDays } from "@/lib/statusRules";

export type Confidence = "high" | "medium" | "low" | "weak";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "ثقة عالية",
  medium: "ثقة متوسطة",
  low: "ثقة منخفضة",
  weak: "بيانات ضعيفة",
};

export const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  medium: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  low: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  weak: "bg-destructive/15 text-destructive border-destructive/40",
};

export type BatchWithSnapshot = UploadBatch & {
  snapshot_date: string | null;
  batch_kind: string | null;
};

export type StockTxn = {
  id: string;
  txn_date: string;
  txn_type:
    | "warehouse_receipt"
    | "warehouse_issue_to_pharmacy"
    | "pharmacy_issue"
    | "pharmacy_transfer"
    | "warehouse_return"
    | "pharmacy_return_to_warehouse";
  item_key: string;
  item_name: string | null;
  item_code: string | null;
  unit: string | null;
  from_location_name: string | null;
  from_location_type: string | null;
  to_location_name: string | null;
  to_location_type: string | null;
  qty: number | string;
  note: string | null;
  created_by: string;
  created_at: string;
};

export const TXN_LABEL: Record<StockTxn["txn_type"], string> = {
  warehouse_receipt: "وارد للمخزن",
  warehouse_issue_to_pharmacy: "منصرف من المخزن لصيدلية",
  pharmacy_issue: "منصرف من الصيدلية",
  pharmacy_transfer: "تحويل بين صيدليات",
  warehouse_return: "مرتجع للمخزن",
  pharmacy_return_to_warehouse: "مرتجع من صيدلية للمخزن",
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
  isNewItem: boolean;
  firstActiveDate: string | null;
  preliminaryNewItem: boolean;
};

export async function fetchRecentBatches(months = 6): Promise<BatchWithSnapshot[]> {
  const { data, error } = await (supabase as any)
    .from("upload_batches")
    .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
    .eq("status", "saved")
    .order("created_at", { ascending: false })
    .order("snapshot_date", { ascending: false, nullsFirst: false })
    .limit(months * 2);
  if (error) throw error;
  return sortBatchesForAnalysis((data || []) as BatchWithSnapshot[]);
}

/** Map normalized item_code -> first_active_date (ISO). */
export async function fetchFirstActiveDates(): Promise<Map<string, string>> {
  const { data, error } = await (supabase as any)
    .from("item_master")
    .select("item_code,first_active_date")
    .not("first_active_date", "is", null)
    .range(0, 99999);
  if (error) throw error;
  const map = new Map<string, string>();
  (data || []).forEach((r: any) => {
    if (r.item_code && r.first_active_date) map.set(normalize(r.item_code), r.first_active_date);
  });
  return map;
}

export async function fetchMovementsForBatches(batchIds: string[]): Promise<Movement[]> {
  if (!batchIds.length) return [];
  const { data, error } = await (supabase as any)
    .from("inventory_movements")
    .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance")
    .in("upload_batch_id", batchIds)
    .range(0, 99999);
  if (error) throw error;
  const dict = await fetchActiveIngredientDictionary();
  return enrichMovementsWithDictionary((data || []) as Movement[], dict);
}

export async function fetchStockTransactions(sinceISO?: string): Promise<StockTxn[]> {
  let q: any = (supabase as any)
    .from("stock_transactions")
    .select("*")
    .order("txn_date", { ascending: false })
    .range(0, 9999);
  if (sinceISO) q = q.gte("txn_date", sinceISO);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as StockTxn[];
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export type ContinuousDataset = {
  batches: BatchWithSnapshot[];
  latestBatch: BatchWithSnapshot | null;
  rows: ProjectedRow[];
  monthsCount: number;
  preliminary: boolean;
};

/**
 * Build continuous, projected-to-today analysis using:
 *  - Multiple monthly snapshots (for ADC)
 *  - Latest snapshot per (item+location) for starting balance
 *  - stock_transactions after that snapshot for live adjustments
 */
export async function loadContinuousAnalysis(opts: {
  monthsWindow?: number;
  targetDays?: number;
  asOf?: string; // ISO date, defaults to today
} = {}): Promise<ContinuousDataset> {
  const monthsWindow = opts.monthsWindow ?? 3;
  const targetDays = opts.targetDays ?? 30;
  const asOf = (opts.asOf ?? new Date().toISOString().substring(0, 10));

  const batches = await fetchRecentBatches(monthsWindow);
  if (!batches.length) {
    return { batches: [], latestBatch: null, rows: [], monthsCount: 0, preliminary: true };
  }
  const selected = batches.slice(0, monthsWindow);
  const movements = await fetchMovementsForBatches(selected.map((b) => b.id));
  const firstActiveMap = await fetchFirstActiveDates();
  const latestBatchId = selected[0]?.id;

  // Group movements: for ADC we average issued across N months; for balance we take latest snapshot.
  type Cell = {
    sample: Movement;
    locName: string;
    locType: string;
    issuedByBatch: Map<string, number>;
    latestBalance: number;
    latestSnapshot: string;
    latestUploadedAt: string;
    appearsInBatches: Set<string>;
    tradeNames: Set<string>;
  };
  const cells = new Map<string, Cell>();
  const batchById = new Map(selected.map((b) => [b.id, b]));

  for (const m of movements) {
    const b = batchById.get(m.upload_batch_id);
    if (!b) continue;
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    let c = cells.get(key);
    if (!c) {
      c = {
        sample: m,
        locName: m.location_name,
        locType: m.location_type,
        issuedByBatch: new Map(),
        latestBalance: 0,
        latestSnapshot: "1970-01-01",
        latestUploadedAt: "1970-01-01T00:00:00.000Z",
        appearsInBatches: new Set<string>(),
        tradeNames: new Set<string>(),
      };
      cells.set(key, c);
    }
    itemTradeNames(m).forEach((n) => c.tradeNames.add(n));
    c.appearsInBatches.add(b.id);
    const prev = c.issuedByBatch.get(b.id) || 0;
    c.issuedByBatch.set(b.id, prev + num(m.issued_quantity));
    const snap = b.snapshot_date || b.month;
    if (snap && snap > c.latestSnapshot) {
      c.latestSnapshot = snap;
      c.latestBalance = num(m.current_balance);
      c.latestUploadedAt = b.created_at;
      c.sample = m;
    }
  }

  // Load transactions only after the earliest needed snapshot.
  const earliest = Array.from(cells.values()).reduce((acc, c) => (c.latestSnapshot < acc ? c.latestSnapshot : acc), asOf);
  const txns = await fetchStockTransactions(earliest);

  // Index transactions by item_key + location name
  function locBucket(name: string | null, type: string | null) {
    return `${normalize(type)}|${normalize(name)}`;
  }
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

  type TxnAgg = {
    receipts: number; issues: number; transfersIn: number; transfersOut: number; returns: number;
  };
  const txnIndex = new Map<string, Map<string, TxnAgg>>(); // itemKey -> locBucket -> agg
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
      case "warehouse_receipt": {
        const loc = locBucket(t.to_location_name, t.to_location_type || "main_warehouse");
        applyTxn(itm, loc, t, "receipts", q);
        break;
      }
      case "warehouse_issue_to_pharmacy": {
        const fromLoc = locBucket(t.from_location_name, t.from_location_type || "main_warehouse");
        const toLoc = locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy");
        applyTxn(itm, fromLoc, t, "issues", q);
        applyTxn(itm, toLoc, t, "receipts", q);
        break;
      }
      case "pharmacy_issue": {
        const loc = locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy");
        applyTxn(itm, loc, t, "issues", q);
        break;
      }
      case "pharmacy_transfer": {
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "transfersOut", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "sub_pharmacy"), t, "transfersIn", q);
        break;
      }
      case "warehouse_return": {
        const loc = locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy");
        applyTxn(itm, loc, t, "returns", q);
        break;
      }
      case "pharmacy_return_to_warehouse": {
        applyTxn(itm, locBucket(t.from_location_name, t.from_location_type || "sub_pharmacy"), t, "issues", q);
        applyTxn(itm, locBucket(t.to_location_name, t.to_location_type || "main_warehouse"), t, "receipts", q);
        break;
      }
    }
  }

  const branchAdcByItem = new Map<string, number>();
  for (const c of cells.values()) {
    if (isMainLocation(c.locType)) continue;
    const issuedValues = Array.from(c.issuedByBatch.values());
    const monthsForItem = issuedValues.length;
    const issuedAvg = monthsForItem ? issuedValues.reduce((a, b) => a + b, 0) / monthsForItem : 0;
    const itemCodeNorm = c.sample.item_code ? normalize(c.sample.item_code) : "";
    const firstActive = itemCodeNorm ? (firstActiveMap.get(itemCodeNorm) || null) : null;
    const isNewItem = !!latestBatchId
      && c.appearsInBatches.size === 1
      && c.appearsInBatches.has(latestBatchId);
    let activeDays: number;
    if (firstActive) activeDays = Math.max(1, daysBetween(firstActive, asOf));
    else activeDays = monthsForItem > 0 ? monthsForItem * 30 : 0;
    let denomDays: number;
    if (firstActive) denomDays = Math.max(1, activeDays);
    else if (isNewItem) denomDays = 30;
    else denomDays = activeDays > 0 && activeDays < 30 ? activeDays : 30;
    const adc = issuedAvg / denomDays;
    const itm = itemKey(c.sample);
    branchAdcByItem.set(itm, (branchAdcByItem.get(itm) || 0) + adc);
  }

  const rows: ProjectedRow[] = [];
  for (const c of cells.values()) {
    const issuedValues = Array.from(c.issuedByBatch.values());
    const monthsForItem = issuedValues.length;
    const issuedAvg = monthsForItem ? issuedValues.reduce((a, b) => a + b, 0) / monthsForItem : 0;
    const itm = itemKey(c.sample);
    const itemCodeNorm = c.sample.item_code ? normalize(c.sample.item_code) : "";
    const firstActive = itemCodeNorm ? (firstActiveMap.get(itemCodeNorm) || null) : null;
    const isNewItem = !!latestBatchId
      && c.appearsInBatches.size === 1
      && c.appearsInBatches.has(latestBatchId);

    // active days: prefer first_active_date when present, otherwise estimate from months of data.
    let activeDays: number;
    if (firstActive) {
      activeDays = Math.max(1, daysBetween(firstActive, asOf));
    } else {
      activeDays = monthsForItem > 0 ? monthsForItem * 30 : 0;
    }
    // ADC denominator: use actual active days when known; fallback to 30 to avoid over-inflated ADC.
    let denomDays: number;
    if (firstActive) {
      denomDays = Math.max(1, activeDays);
    } else if (isNewItem) {
      denomDays = 30; // preliminary — flagged below
    } else {
      denomDays = activeDays > 0 && activeDays < 30 ? activeDays : 30;
    }
    const isMain = isMainLocation(c.locType);
    const branchAdc = branchAdcByItem.get(itm) || 0;
    const adc = isMain ? branchAdc : issuedAvg / denomDays;

    const lb = locBucket(c.locName, c.locType);
    const agg = txnIndex.get(itm)?.get(lb) || { receipts: 0, issues: 0, transfersIn: 0, transfersOut: 0, returns: 0 };
    const daysSince = c.latestSnapshot ? daysBetween(c.latestSnapshot, asOf) : 0;
    const expectedConsumption = adc * daysSince;
    const projected = c.latestBalance
      - expectedConsumption
      + agg.receipts - agg.issues
      + agg.transfersIn - agg.transfersOut
      + agg.returns;

    const balance = Math.max(0, projected);
    const days = adc > 0 ? balance / adc : null;
    const kind: AlertKind = isMain ? classifyMainDays(days, balance, branchAdc, targetDays) : classifyBranchDays(days, balance, issuedAvg, targetDays);

    // Confidence
    const snapAge = daysSince;
    const hasTxns = (agg.receipts + agg.issues + agg.transfersIn + agg.transfersOut + agg.returns) > 0;
    let confidence: Confidence = "low";
    if (monthsForItem < 1) confidence = "weak";
    else if (snapAge <= 7 && hasTxns) confidence = "high";
    else if (snapAge <= 7) confidence = "medium";
    else confidence = "low";
    if (activeDays < 30) confidence = "weak";

    // New-item rule: never allow strong/high confidence for items with short history.
    if (isNewItem) {
      if (activeDays < 14) confidence = "weak";
      else if (activeDays < 60) confidence = "medium";
      else if (confidence === "high") confidence = "medium";
    }

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
      scientific: c.sample.scientific_name,
      unit: c.sample.unit,
      locationName: c.locName,
      locationType: c.locType,
      balance,
      issued: issuedAvg,
      adc,
      days,
      kind,
      why,
      action,
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
      activeDays,
      confidence,
      shortHistoryWarning: activeDays < 30,
      preliminaryForecast: selected.length < 3,
      isNewItem,
      firstActiveDate: firstActive,
      preliminaryNewItem: isNewItem && !firstActive,
    });
  }

  rows.sort((a, b) => {
    const order: Record<AlertKind, number> = { critical: 0, danger: 1, below: 2, very_over: 3, over: 4, deadstock: 5, no_data: 6, safe: 7 };
    return order[a.kind] - order[b.kind] || a.itemName.localeCompare(b.itemName, "ar");
  });

  return {
    batches: selected,
    latestBatch: selected[0] || null,
    rows,
    monthsCount: selected.length,
    preliminary: selected.length < 3,
  };
}

/** Month-over-month comparison between two batches. */
export async function compareMonths(batchAId: string, batchBId: string, targetDays = 30) {
  const movements = await fetchMovementsForBatches([batchAId, batchBId]);
  type Agg = { issuedA: number; balanceA: number; issuedB: number; balanceB: number; sample: Movement; locName: string; locType: string };
  const map = new Map<string, Agg>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    let a = map.get(key);
    if (!a) {
      a = { issuedA: 0, balanceA: 0, issuedB: 0, balanceB: 0, sample: m, locName: m.location_name, locType: m.location_type };
      map.set(key, a);
    }
    if (m.upload_batch_id === batchAId) { a.issuedA += num(m.issued_quantity); a.balanceA = num(m.current_balance); }
    else { a.issuedB += num(m.issued_quantity); a.balanceB = num(m.current_balance); }
  }

  const items = Array.from(map.values()).map((a) => {
    const adcA = a.issuedA / 30, adcB = a.issuedB / 30;
    const daysA = adcA > 0 ? a.balanceA / adcA : null;
    const daysB = adcB > 0 ? a.balanceB / adcB : null;
    const becameRisky =
      classifyBranchDays(daysB, a.balanceB, a.issuedB, targetDays) === "safe" &&
      ["critical","danger","below"].includes(classifyBranchDays(daysA, a.balanceA, a.issuedA, targetDays));
    const improved =
      ["critical","danger","below"].includes(classifyBranchDays(daysB, a.balanceB, a.issuedB, targetDays)) &&
      classifyBranchDays(daysA, a.balanceA, a.issuedA, targetDays) === "safe";
    return {
      itemName: itemDisplayName(a.sample),
      locationName: a.locName,
      locationType: a.locType,
      issuedDelta: a.issuedA - a.issuedB,
      balanceDelta: a.balanceA - a.balanceB,
      coverageDeltaDays: (daysA ?? 0) - (daysB ?? 0),
      becameRisky,
      improved,
      isMain: isMainLocation(a.locType),
    };
  });

  return {
    items,
    becameRisky: items.filter((i) => i.becameRisky),
    improved: items.filter((i) => i.improved),
    worsePharmacies: Object.entries(
      items.filter((i) => !i.isMain && i.coverageDeltaDays < 0)
        .reduce<Record<string, number>>((acc, i) => { acc[i.locationName] = (acc[i.locationName] || 0) + 1; return acc; }, {})
    ).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}
