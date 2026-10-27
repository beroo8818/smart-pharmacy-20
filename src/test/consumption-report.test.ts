import { describe, expect, it } from "vitest";
import { buildInventoryHistory, type HistoryBatch, type HistoryObservation } from "../../shared/inventoryHistory";
import { summarizeConsumption } from "../../shared/consumptionReport";

const batches: HistoryBatch[] = [
  { id: "jan", month: "2026-01-01", snapshot_date: "2026-02-01", batch_kind: "monthly", created_at: "2026-02-01" },
  { id: "revision", month: "2026-01-01", snapshot_date: "2026-02-01", batch_kind: "monthly", created_at: "2026-02-02" },
  { id: "update", month: "2026-01-01", snapshot_date: "2026-02-10", batch_kind: "partial_update", created_at: "2026-02-10" },
];
const observation = (batchId: string, issued: number | null, extra = {}): HistoryObservation<string> => ({
  sample: "test", batchId, item: "medicine", sku: "brand-a", locationName: "branch-a", locationType: "sub_pharmacy",
  balance: 100, issued, ...extra,
});
const history = (rows: HistoryObservation<string>[], window = 3) => buildInventoryHistory(batches, rows, window, "2026-03-01");
const reportRow = (locationName: string, issued: number | null, extra = {}) => ({
  itemKey: "medicine", locationName, locationType: "sub_pharmacy", unit: "tablet",
  consumptionPeriods: issued == null ? [] : [{ month: "2026-01-01", issued, reportedSkus: 1, totalSkus: 1 }], ...extra,
});

describe("actual monthly hospital dispensing", () => {
  it("keeps the real 31-day month total distinct from a standardized 30-day mean", () => {
    const result = history([observation("jan", 310)])[0];
    expect(result.issuedAverage).toBe(300);
    expect(result.consumptionPeriods[0].issued).toBe(310);
  });
  it("replaces revisions and ignores balance-only updates", () => {
    const result = history([observation("jan", 310), observation("revision", 620), observation("update", 999)])[0];
    expect(result.consumptionPeriods).toEqual([{ month: "2026-01-01", issued: 620, reportedSkus: 1, totalSkus: 1 }]);
  });
  it("retains all available periods independently of the forecasting window", () => {
    const result = buildInventoryHistory([...batches, { id: "feb", month: "2026-02-01", snapshot_date: "2026-03-01" }],
      [observation("jan", 310), observation("feb", 280)], 1, "2026-03-02")[0];
    expect(result.monthsOfData).toBe(1);
    expect(result.consumptionPeriods).toHaveLength(2);
  });
  it("excludes warehouse issues and other items rather than double-counting internal transfers", () => {
    const result = summarizeConsumption([reportRow("a", 310), reportRow("b", 20),
      reportRow("warehouse", 999, { locationType: "main_warehouse" }), reportRow("store", 999, { locationType: "main_store" }),
      reportRow("other", 999, { itemKey: "other" })], "medicine", "2026-01-01");
    expect(result.total).toBe(330);
    expect(result.complete).toBe(true);
    expect(result.locations).toHaveLength(2);
  });
  it("counts an explicit zero as reported while marking missing reports as incomplete", () => {
    const result = summarizeConsumption([reportRow("a", 0), reportRow("b", null)], "medicine", "2026-01-01");
    expect(result.total).toBe(0);
    expect(result.reportedCount).toBe(1);
    expect(result.missingCount).toBe(1);
    expect(result.complete).toBe(false);
    expect(summarizeConsumption([reportRow("b", null)], "medicine", "2026-01-01").total).toBeNull();
  });
  it("marks a partially reported scientific group as incomplete", () => {
    const cell = history([observation("jan", 310), observation("update", null, { sku: "brand-b" })])[0];
    const result = summarizeConsumption([{ ...reportRow("a", 0), consumptionPeriods: cell.consumptionPeriods }], "medicine", "2026-01-01");
    expect(result.total).toBe(310);
    expect(result.complete).toBe(false);
  });
  it("does not add incompatible or unknown units", () => {
    for (const unit of ["strip", ""]) {
      const result = summarizeConsumption([reportRow("a", 10), reportRow("b", 20, { unit })], "medicine", "2026-01-01");
      expect(result.total).toBeNull();
      expect(result.complete).toBe(false);
    }
  });
});
