import {memoizeItem} from "../../shared/itemMemo";
import {buildInventoryHistory,locationKey,stockBalances,todayISO,type ConsumptionPeriod} from "../../shared/inventoryHistory";
import {applyStockLedger,forecastForUncoveredDays} from "../../shared/stockLedger";
import type {AnalysisRow,AlertKind,Movement,UploadBatch,DictEntry} from "./batchAnalysis";
import {enrichMovementsWithDictionary} from './itemIdentity';
import {itemKey,itemKeyAliases,itemDisplayName,itemTradeNames,normalize,isMainLocation} from "./itemIdentity";
import {classifyBranch as classifyBranchDays,classifyMain as classifyMainDays} from "./statusRules";
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

export type ContinuousOptions = { groupBy?: "sku" | "scientific"; batchIds?: string[]; monthsWindow?: number; targetDays?: number; asOf?: string };
export function computeContinuousAnalysis({selected,movements,txns,dictionary,firstActiveMap=new Map(),opts={}}:{selected:BatchWithSnapshot[];movements:Movement[];txns:StockTxn[];dictionary?:Map<string,DictEntry>;firstActiveMap?:Map<string,string>;opts?:ContinuousOptions}):ContinuousDataset {
  if(dictionary)movements=enrichMovementsWithDictionary(movements.map((m:any)=>({...m,issued_from:m.upload_batches?.issued_from??m.issued_from,issued_to:m.upload_batches?.issued_to??m.issued_to})),dictionary);
  const identify=memoizeItem((m:Movement)=>[m.item_code,m.item_name,m.trade_name,m.scientific_name,m.strength,m.dosage_form,m.unit,m.therapeutic_group_key],m=>{
    const sku=[m.item_code,m.trade_name,m.item_name,m.unit].map(normalize).join('|');
    return {sku,key:opts.groupBy==="sku"?sku:itemKey(m),aliases:itemKeyAliases(m),name:itemDisplayName(m),trades:itemTradeNames(m)};
  });
  const historyItemKey=(m:Movement)=>identify(m).key;
  const monthsWindow = opts.monthsWindow ?? 3;
  const targetDays = opts.targetDays ?? 30;
  const asOf = (opts.asOf ?? todayISO());

  const history = buildInventoryHistory(selected, movements.map((m) => ({
    sample: m, batchId: m.upload_batch_id, item: historyItemKey(m),
    sku: identify(m).sku,
    locationName: m.location_name, locationType: m.location_type,
    balance: m.current_balance, issued: m.issued_quantity,
  })), monthsWindow, asOf);
  const namesByCell = new Map<string, Set<string>>();
  for (const movement of movements) {
    const key = `${historyItemKey(movement)}|${locationKey(movement.location_name, movement.location_type)}`;
    const names = namesByCell.get(key) || new Set<string>();
    identify(movement).trades.forEach((name) => names.add(name));
    namesByCell.set(key, names);
  }
  const ledger = applyStockLedger(history,txns,asOf,historyItemKey,m=>identify(m).aliases,normalize,movements);
  const cells = new Map(ledger.map((cell,index)=>[index,{
    ...cell, tradeNames:namesByCell.get(`${historyItemKey(cell.sample)}|${locationKey(cell.locName,cell.locType)}`) || new Set(identify(cell.sample).trades),
  }]));

  const branchAdcByItem = new Map<string, number>();
  for (const c of cells.values()) {
    if (isMainLocation(c.locType)) continue;
    const itm = historyItemKey(c.sample);
    branchAdcByItem.set(itm, (branchAdcByItem.get(itm) || 0) + c.adc);
  }

  const numberFormat=new Intl.NumberFormat('ar-EG');
  const compareNames=new Intl.Collator('ar').compare;
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
      why = `يوجد رصيد ${numberFormat.format(Math.round(balance))} في المخزن الرئيسي بدون صرف واضح في الفروع.`;
      action = "راجع احتياج الفروع قبل اعتبار الرصيد راكدًا.";
    } else if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد المسجل مع الحركات ${numberFormat.format(Math.round(balance))} ÷ متوسط الصرف اليومي ${adc.toFixed(1)} = ${days == null ? 0 : Math.round(days)} يوم تغطية، والهدف ${targetDays} يوم.`;
      action = `زوّد الكمية لتغطية ${targetDays} يوم — حوالي ${numberFormat.format(Math.max(0,Math.ceil(adc*targetDays-balance)))} وحدة.`;
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
      itemName: identify(c.sample).name,
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
    return order[a.kind] - order[b.kind] || compareNames(a.itemName,b.itemName);
  });

  return {
    batches: selected,
    latestBatch: selected[0] || null,
    rows,
    monthsCount: Math.min(monthsWindow, rows.reduce((n,row)=>isMainLocation(row.locationType)?n:Math.max(n,row.monthsOfData),0)),
    preliminary: rows.filter((row) => !isMainLocation(row.locationType)).some((row) => row.preliminaryForecast),
  };
}
