export type HistoryBatch = {
  id: string;
  month: string;
  snapshot_date?: string | null;
  batch_kind?: string | null;
  created_at?: string;
  uploaded_at?: string;
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
};

// Revisions replace the same SKU/period. Separate brands are additive, not revisions.
export function buildInventoryHistory<T>(
  batches: HistoryBatch[], observations: HistoryObservation<T>[], monthsWindow: number, asOf: string,
): HistoryCell<T>[] {
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  type Value = { sample: T; balance: number | null; issued: number | null; batch: HistoryBatch };
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
    const value: Value = { sample: observation.sample, balance, issued, batch };
    if (batch.batch_kind !== "period_consumption" && balance != null) {
      const old = sku.snapshots.get(snapshot);
      if (!old || later(batch, old.batch) > 0) sku.snapshots.set(snapshot, value);
      else if (old.batch.id === batch.id) old.balance = (old.balance ?? 0) + balance;
    }
    const days = monthDays(batch.month);
    const periodEnd = days ? `${batch.month.slice(0, 7)}-${String(days).padStart(2, "0")}` : "";
    if (isConsumptionBatch(batch) && issued != null && days && periodEnd < asOf) {
      const old = sku.periods.get(batch.month);
      if (!old || later(batch, old.batch) > 0) sku.periods.set(batch.month, value);
      else if (old.batch.id === batch.id) old.issued = (old.issued ?? 0) + issued;
    }
  }
  return Array.from(groups.values()).map((group) => {
    const snapshots: Value[] = [];
    const periods = new Set<string>();
    const totalsByMonth = new Map<string, { issued: number; reportedSkus: number }>();
    let adc = 0, activeDays = 0, hasConsumption = true;
    for (const sku of group.skus.values()) {
      for (const [month, value] of sku.periods) {
        const total = totalsByMonth.get(month) || { issued: 0, reportedSkus: 0 };
        total.issued += value.issued ?? 0;
        total.reportedSkus++;
        totalsByMonth.set(month, total);
      }
      const latest = Array.from(sku.snapshots.entries()).sort(([a], [b]) => b.localeCompare(a))[0];
      if (latest) snapshots.push(latest[1]);
      const history = Array.from(sku.periods.entries()).sort(([a], [b]) => b.localeCompare(a)).slice(0, Math.max(1, monthsWindow));
      const days = history.reduce((sum, [month]) => sum + monthDays(month), 0);
      if (!days) hasConsumption = false;
      adc += days ? history.reduce((sum, [, value]) => sum + (value.issued ?? 0), 0) / days : 0;
      activeDays = Math.max(activeDays, days);
      history.forEach(([month]) => periods.add(month));
    }
    const dates = snapshots.map((value) => value.batch.snapshot_date || value.batch.month).sort();
    const newest = [...snapshots].sort((a, b) => later(b.batch, a.batch))[0];
    return {
      sample: newest?.sample ?? group.sample, locName: group.locName, locType: group.locType,
      latestBalance: snapshots.reduce((sum, value) => sum + (value.balance ?? 0), 0),
      latestSnapshot: dates[0] || asOf, latestUploadedAt: newest ? saved(newest.batch) : "",
      adc, issuedAverage: adc * 30, monthsOfData: periods.size, activeDays,
      hasBalance: snapshots.length === group.skus.size,
      hasConsumption, mixedSnapshots: new Set(dates).size > 1,
      consumptionPeriods: Array.from(totalsByMonth, ([month, total]) => ({ month, ...total, totalSkus: group.skus.size }))
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
