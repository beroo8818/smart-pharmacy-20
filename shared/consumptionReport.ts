import type { ConsumptionPeriod } from "./inventoryHistory";

type ConsumptionRow = {
  itemKey: string;
  locationName: string;
  locationType: string;
  unit?: string | null;
  consumptionPeriods: ConsumptionPeriod[];
};

export function summarizeConsumption<T extends ConsumptionRow>(rows: T[], item: string, month: string) {
  const locations = rows.filter((row) => row.itemKey === item && row.locationType !== "main_warehouse" && row.locationType !== "main_store")
    .map((row) => ({ row, period: row.consumptionPeriods.find((period) => period.month === month) || null }));
  const reported = locations.filter((location) => location.period !== null);
  const units = new Set(reported.map(({ row }) => (row.unit || "").trim().toLowerCase()));
  const unitCompatible = units.size === 1 && !units.has("");
  const missing = locations.filter(({ period }) => !period || period.reportedSkus < period.totalSkus || period.partial);
  return {
    locations,
    reportedCount: reported.length,
    missingCount: missing.length,
    unitCompatible,
    total: reported.length && unitCompatible ? reported.reduce((sum, { period }) => sum + period!.issued, 0) : null,
    unit: reported[0]?.row.unit || null,
    complete: reported.length > 0 && unitCompatible && missing.length === 0,
  };
}
