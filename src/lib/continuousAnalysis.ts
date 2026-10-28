import { fetchPagedRows } from "./pagedQuery";
import { buildInventoryHistory, locationKey, stockBalances, todayISO, movementPeriodDays, type ConsumptionPeriod } from "../../shared/inventoryHistory";
import { applyStockLedger,forecastForUncoveredDays } from "../../shared/stockLedger";
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
  issued_from?:string|null;issued_to?:string|null;
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
  isNewItem: boolean;
  firstActiveDate: string | null;
  preliminaryNewItem: boolean;
};

export async function fetchRecentBatches(months = 6): Promise<BatchWithSnapshot[]> {
  const data = await fetchPagedRows<BatchWithSnapshot>(() => (supabase as any)
    .from("upload_batches").select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind,issued_from,issued_to,received_from,received_to,snapshot_boundary")
    .eq("status", "saved").order("created_at", { ascending: false }).order("id", { ascending: false }));
  return sortBatchesForAnalysis(data);
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
  const data: Movement[] = [];
  for (let start = 0; start < batchIds.length; start += 50) {
    data.push(...await fetchPagedRows<Movement>(() => (supabase as any)
      .from("inventory_movements")
      .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance,upload_batches(issued_from,issued_to)")
      .in("upload_batch_id", batchIds.slice(start, start + 50)).order("id", { ascending: true })));
  }
  const dict = await fetchActiveIngredientDictionary();
  return enrichMovementsWithDictionary(data.map((m:any)=>({...m,issued_from:m.upload_batches?.issued_from,issued_to:m.upload_batches?.issued_to})), dict);
}

export async function fetchStockTransactions(sinceISO?: string): Promise<StockTxn[]> {
  return fetchPagedRows<StockTxn>(() => {
    let query = (supabase as any).from('stock_transactions').select('*').order('txn_date',{ascending:false}).order('id',{ascending:true});
    if(sinceISO) query=query.gte('txn_date',sinceISO);
    return query;
  });
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
  groupBy?: "sku" | "scientific";
  batchIds?: string[];
  monthsWindow?: number;
  targetDays?: number;
  asOf?: string; // ISO date, defaults to today
} = {}): Promise<ContinuousDataset> {
  const historyItemKey = (m: Movement) => opts.groupBy === "sku"
    ? [m.item_code, m.trade_name, m.item_name, m.unit].map(normalize).join("|")
    : itemKey(m);
  const monthsWindow = opts.monthsWindow ?? 3;
  const targetDays = opts.targetDays ?? 30;
  const asOf = (opts.asOf ?? todayISO());

  const batches = await fetchRecentBatches(monthsWindow);
  if (!batches.length) {
    return { batches: [], latestBatch: null, rows: [], monthsCount: 0, preliminary: true };
  }
  const selected = batches.filter((b) => (b.snapshot_date || b.month) <= asOf && (!opts.batchIds || opts.batchIds.includes(b.id)));
  const movements = await fetchMovementsForBatches(selected.map((b) => b.id));
  const firstActiveMap = await fetchFirstActiveDates();
  const history = buildInventoryHistory(selected, movements.map((m) => ({
    sample: m, batchId: m.upload_batch_id, item: historyItemKey(m),
    sku: [m.item_code, m.trade_name, m.item_name, m.unit].map(normalize).join("|"),
    locationName: m.location_name, locationType: m.location_type,
    balance: m.current_balance, issued: m.issued_quantity,
  })), monthsWindow, asOf);
  const namesByCell = new Map<string, Set<string>>();
  for (const movement of movements) {
    const key = `${historyItemKey(movement)}|${locationKey(movement.location_name, movement.location_type)}`;
    const names = namesByCell.get(key) || new Set<string>();
    itemTradeNames(movement).forEach((name) => names.add(name));
    namesByCell.set(key, names);
  }
  const earliest = history.filter(c=>c.hasBalance).reduce((acc,c)=>c.latestSnapshot<acc?c.latestSnapshot:acc,asOf);
  const txns = await fetchStockTransactions(earliest);
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
    const firstActive = firstActiveMap.get(normalize(c.sample.item_code)) || null;
    const isNewItem = monthsForItem <= 1;
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

    // Confidence
    const snapAge = daysSince;
    const hasTxns = (agg.receipts + agg.issues + agg.transfersIn + agg.transfersOut + agg.returns) > 0;
    let confidence: Confidence = "low";
    if (monthsForItem < 1) confidence = "weak";
    else if (snapAge <= 7 && hasTxns) confidence = "high";
    else if (snapAge <= 7) confidence = "medium";
    else confidence = "low";
    if (activeDays < 30 || !c.hasBalance || !c.hasConsumption || c.mixedSnapshots) confidence = "weak";

    // New-item rule: never allow strong/high confidence for items with short history.
    if (isNewItem) {
      if (activeDays < 14) confidence = "weak";
      else if (activeDays < 60) confidence = "medium";
      else if (confidence === "high") confidence = "medium";
    }

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
      activeDays,
      confidence,
      shortHistoryWarning: activeDays < 30,
      preliminaryForecast: monthsForItem < 3,
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
    monthsCount: Math.min(monthsWindow, Math.max(0, ...rows.filter((row) => !isMainLocation(row.locationType)).map((row) => row.monthsOfData))),
    preliminary: rows.filter((row) => !isMainLocation(row.locationType)).some((row) => row.preliminaryForecast),
  };
}

/** Month-over-month comparison between two batches. */
export async function compareMonths(batchAId: string, batchBId: string, targetDays = 30) {
  const movements = await fetchMovementsForBatches([batchAId, batchBId]);
  type Agg = { issuedA: number; balanceA: number; issuedB: number; balanceB: number; adcA:number;adcB:number; sample: Movement; locName: string; locType: string };
  const map = new Map<string, Agg>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    let a = map.get(key);
    if (!a) {
      a = { issuedA: 0, balanceA: 0, issuedB: 0, balanceB: 0, adcA:0,adcB:0, sample: m, locName: m.location_name, locType: m.location_type };
      map.set(key, a);
    }
    const days=movementPeriodDays(m),daily=days>0?num(m.issued_quantity)/days:0;
    if (m.upload_batch_id === batchAId) { a.issuedA += num(m.issued_quantity); a.balanceA = num(m.current_balance);a.adcA+=daily; }
    else { a.issuedB += num(m.issued_quantity); a.balanceB = num(m.current_balance);a.adcB+=daily; }
  }

  const items = Array.from(map.values()).map((a) => {
    const adcA = a.adcA, adcB = a.adcB;
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
