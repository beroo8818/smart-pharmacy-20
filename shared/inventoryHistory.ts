export type HistoryBatch = {
  id: string;
  month: string;
  snapshot_date?: string | null;
  batch_kind?: string | null;
  snapshot_boundary?: string | null;
  created_at?: string;
  uploaded_at?: string;
  issued_from?: string | null;
  issued_to?: string | null;
  received_from?: string | null;
  received_to?: string | null;
};

export function todayISO(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

export function validISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function numericValue(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const result = Number(String(value).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[,٬\s]/g, "").replace(/٫/g, "."));
  return Number.isFinite(result) ? result : null;
}

export function locationKey(name: unknown, type: unknown): string {
  const clean = (value: unknown) => String(value ?? "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "").replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const t = clean(type);
  return `${t === "main_store" ? "main_warehouse" : t}|${clean(name)}`;
}

export function monthDays(month: string): number {
  const match = /^(\d{4})-(\d{2})-01$/.exec(month);
  if (!match || +match[2] < 1 || +match[2] > 12) return 0;
  return new Date(Date.UTC(+match[1], +match[2], 0)).getUTCDate();
}

export function previousMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

export function isConsumptionBatch(batch: HistoryBatch): boolean {
  return !batch.batch_kind || batch.batch_kind === "monthly" || batch.batch_kind === "period_consumption";
}

export type DateRange = { from: string; to: string };
export type ReportDates = { issued_from?: string | null; issued_to?: string | null; received_from?: string | null; received_to?: string | null; snapshot_boundary?: string | null };
export function dateRangeDays(from: string, to: string): number {
  return validISODate(from) && validISODate(to) && from <= to
    ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1 : 0;
}
export function consumptionRange(batch: HistoryBatch, asOf = todayISO()): DateRange | null {
  if (!isConsumptionBatch(batch)) return null;
  if (batch.issued_from || batch.issued_to) {
    return dateRangeDays(batch.issued_from || '', batch.issued_to || '') && batch.issued_to! <= asOf
      ? { from: batch.issued_from!, to: batch.issued_to! } : null;
  }
  const days = monthDays(batch.month), to = days ? batch.month.slice(0,7) + '-' + String(days).padStart(2,'0') : '';
  return days && to < asOf ? { from: batch.month, to } : null;
}
export function validateReportDates(month: string, snapshot: string, kind: string, dates: ReportDates, asOf = todayISO(), requireExplicit = false): ReportDates {
  if (!monthDays(month) || month > asOf.slice(0,7)+'-01' || !validISODate(snapshot) || snapshot > asOf) throw new Error('اختر شهر التقرير وتاريخ رصيد صحيحًا غير مستقبلي');
  const result: ReportDates = { issued_from: null, issued_to: null, received_from: null, received_to: null };
  if (kind !== 'period_consumption' && (dates.snapshot_boundary || requireExplicit)) {
    const boundary = dates.snapshot_boundary || 'end_of_day';
    if (!['start_of_day','end_of_day'].includes(boundary)) throw new Error('اختر الرصيد في بداية اليوم أو نهايته');
    result.snapshot_boundary = boundary;
  }
  for (const prefix of ['issued','received'] as const) {
    const from = dates[`${prefix}_from`] || '', to = dates[`${prefix}_to`] || '';
    if (prefix === 'issued' && !isConsumptionBatch({id:'',month,batch_kind:kind})) continue;
    if (!from && !to) {
      if (prefix === 'issued' && (requireExplicit || month >= asOf.slice(0,7) + '-01')) throw new Error('حدد المنصرف من يوم إلى يوم؛ يمكن رفع الشهر الحالي حتى اليوم');
      continue;
    }
    if (!dateRangeDays(from,to) || from.slice(0,7) !== month.slice(0,7) || to.slice(0,7) !== month.slice(0,7) || to > asOf) throw new Error(prefix === 'issued' ? 'فترة المنصرف غير صالحة: داخل الشهر المختار، البداية لا تتجاوز النهاية ولا تاريخ اليوم' : 'فترة الوارد غير صالحة: حدد البداية والنهاية داخل الشهر المختار وحتى اليوم');
    result[`${prefix}_from`] = from; result[`${prefix}_to`] = to;
  }
  return result;
}
export function rangesCross(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to &&
    !(a.from <= b.from && a.to >= b.to) && !(b.from <= a.from && b.to >= a.to);
}
export function selectConsumptionRanges<T extends DateRange>(values: T[]): { selected: T[]; conflict: boolean } {
  const selected=values.filter(a => !values.some(b => b !== a && b.from <= a.from && b.to >= a.to && (b.from < a.from || b.to > a.to)));
  if (selected.some((a,i) => selected.slice(i+1).some(b => rangesCross(a,b)))) return { selected: [], conflict: true };
  return { selected, conflict: false };
}
export function consumptionPeriodLabel(period: ConsumptionPeriod): string {
  return period.ranges?.length ? period.ranges.map(r => r.from + ' إلى ' + r.to).join('، ') : period.month.slice(0,7);
}
export function movementPeriodDays(row: {month:string;issued_from?:string|null;issued_to?:string|null}): number {
  return row.issued_from || row.issued_to ? dateRangeDays(row.issued_from||'',row.issued_to||'') : monthDays(row.month);
}

export type HistoryObservation<T> = {
  sample: T;
  batchId: string;
  item: string;
  sku: string;
  locationName: string;
  locationType: string;
  balance: unknown;
  issued: unknown;
};

export type HistoryCell<T> = {
  sample: T;
  locName: string;
  locType: string;
  latestBalance: number;
  latestSnapshot: string;
  latestUploadedAt: string;
  snapshotBoundary: string | null;
  adc: number;
  issuedAverage: number;
  monthsOfData: number;
  activeDays: number;
  hasBalance: boolean;
  hasConsumption: boolean;
  mixedSnapshots: boolean;
  consumptionPeriods: ConsumptionPeriod[];
};

export type ConsumptionPeriod = {
  month: string;
  issued: number;
  reportedSkus: number;
  totalSkus: number;
  ranges?: DateRange[];
  days?: number;
  partial?: boolean;
};

// Revisions replace the same SKU/period. Separate brands are additive, not revisions.
export function buildInventoryHistory<T>(
  batches: HistoryBatch[], observations: HistoryObservation<T>[], monthsWindow: number, asOf: string,
): HistoryCell<T>[] {
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  type Value = { sample: T; balance: number | null; issued: number | null; batch: HistoryBatch; from: string; to: string };
  type Sku = { snapshots: Map<string, Value>; periods: Map<string, Value> };
  const groups = new Map<string, { sample: T; locName: string; locType: string; skus: Map<string, Sku> }>();
  const saved = (batch: HistoryBatch) => batch.uploaded_at || batch.created_at || "";
  const later = (a: HistoryBatch, b: HistoryBatch) => saved(a).localeCompare(saved(b)) || a.id.localeCompare(b.id);
  for (const observation of observations) {
    const batch = batchMap.get(observation.batchId);
    if (!batch) continue;
    const snapshot = batch.snapshot_date || batch.month;
    if (!validISODate(snapshot) || snapshot > asOf) continue;
    const key = `${observation.item}|${locationKey(observation.locationName, observation.locationType)}`;
    let group = groups.get(key);
    if (!group) {
      group = { sample: observation.sample, locName: observation.locationName, locType: observation.locationType, skus: new Map() };
      groups.set(key, group);
    }
    let sku = group.skus.get(observation.sku);
    if (!sku) { sku = { snapshots: new Map(), periods: new Map() }; group.skus.set(observation.sku, sku); }
    const balance = numericValue(observation.balance);
    const issued = numericValue(observation.issued);
    const range = consumptionRange(batch, asOf);
    const value: Value = { sample: observation.sample, balance, issued, batch, from: range?.from || '', to: range?.to || '' };
    if (batch.batch_kind !== "period_consumption" && balance != null) {
      const snapshotKey = snapshot + '|' + (batch.snapshot_boundary === 'end_of_day' ? '2' : batch.snapshot_boundary === 'start_of_day' ? '0' : '1');
      const old = sku.snapshots.get(snapshotKey);
      if (!old || later(batch, old.batch) > 0) sku.snapshots.set(snapshotKey, value);
      else if (old.batch.id === batch.id) old.balance = (old.balance ?? 0) + balance;
    }
    if (range && issued != null) {
      const periodKey = range.from + '|' + range.to;
      const old = sku.periods.get(periodKey);
      if (!old || later(batch, old.batch) > 0) sku.periods.set(periodKey, value);
      else if (old.batch.id === batch.id) old.issued = (old.issued ?? 0) + issued;
    }
  }
  return Array.from(groups.values()).map((group) => {
    const snapshots: Value[] = [];
    const periods = new Set<string>();
    const totalsByMonth = new Map<string, { issued: number; reportedSkus: number; ranges: Map<string,DateRange>; partial: boolean }>();
    let adc = 0, activeDays = 0, hasConsumption = true;
    for (const sku of group.skus.values()) {
      const resolved = selectConsumptionRanges(Array.from(sku.periods.values()));
      if (resolved.conflict) hasConsumption = false;
      const reported = new Set<string>();
      for (const value of resolved.selected) {
        const month = value.batch.month;
        const total = totalsByMonth.get(month) || { issued: 0, reportedSkus: 0, ranges: new Map(), partial: false };
        total.issued += value.issued ?? 0;
        if (!reported.has(month)) total.reportedSkus++;
        reported.add(month);
        total.ranges.set(value.from + '|' + value.to, {from:value.from,to:value.to});
        totalsByMonth.set(month, total);
      }
      const latest = Array.from(sku.snapshots.entries()).sort(([a], [b]) => b.localeCompare(a))[0];
      if (latest) snapshots.push(latest[1]);
      const months = [...new Set(resolved.selected.map(v=>v.batch.month))].sort().reverse().slice(0,Math.max(1,monthsWindow));
      const history = resolved.selected.filter(v=>months.includes(v.batch.month));
      const days = history.reduce((sum, value) => sum + dateRangeDays(value.from,value.to), 0);
      if (!days) hasConsumption = false;
      adc += days ? history.reduce((sum, value) => sum + (value.issued ?? 0), 0) / days : 0;
      activeDays = Math.max(activeDays, days);
      history.forEach(value => periods.add(value.batch.month));
      for (const month of reported) {
        const covered = resolved.selected.filter(v=>v.batch.month===month).reduce((n,v)=>n+dateRangeDays(v.from,v.to),0);
        if (covered < monthDays(month)) totalsByMonth.get(month)!.partial = true;
      }
    }
    const dates = snapshots.map((value) => value.batch.snapshot_date || value.batch.month).sort();
    const newest = [...snapshots].sort((a, b) => later(b.batch, a.batch))[0];
    return {
      sample: newest?.sample ?? group.sample, locName: group.locName, locType: group.locType,
      latestBalance: snapshots.reduce((sum, value) => sum + (value.balance ?? 0), 0),
      latestSnapshot: dates[0] || asOf, latestUploadedAt: newest ? saved(newest.batch) : "",
      snapshotBoundary: snapshots.length && snapshots.every(v => v.batch.snapshot_boundary === snapshots[0].batch.snapshot_boundary) ? snapshots[0].batch.snapshot_boundary || null : null,
      adc, issuedAverage: adc * 30, monthsOfData: periods.size, activeDays,
      hasBalance: snapshots.length === group.skus.size,
      hasConsumption, mixedSnapshots: new Set(snapshots.map(v => (v.batch.snapshot_date || v.batch.month) + '|' + (v.batch.snapshot_boundary || 'unknown'))).size > 1,
      consumptionPeriods: Array.from(totalsByMonth, ([month, total]) => ({ month, issued: total.issued, reportedSkus: total.reportedSkus, partial: total.partial,
        ranges: Array.from(total.ranges.values()).sort((a,b)=>a.from.localeCompare(b.from)), totalSkus: group.skus.size }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    };
  });
}

export function stockBalances(snapshot: number, receipts: number, issues: number, transfersIn: number,
  transfersOut: number, returns: number, expected: number, patientIssues: number) {
  const recorded = snapshot + receipts - issues + transfersIn - transfersOut + returns;
  // Without issue-period coverage, do not stack a forecast on actual patient dispensing.
  const estimated = patientIssues > 0 ? 0 : Math.max(0, expected);
  return { recorded, projected: Math.max(0, recorded - estimated), estimated };
}
