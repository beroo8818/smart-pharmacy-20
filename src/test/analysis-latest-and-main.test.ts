import { describe, expect, it } from "vitest";
import {
  analyzeMovements,
  sortBatchesForAnalysis,
  type Movement,
  type UploadBatch,
} from "@/lib/batchAnalysis";

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: "m",
    upload_batch_id: "batch",
    month: "2024-05-01",
    item_name: "Paracetamol 500 mg tab",
    item_code: "P500",
    scientific_name: "Paracetamol 500 mg",
    trade_name: "Panadol",
    unit: "tab",
    location_name: "صيدلية فرعية",
    location_type: "sub_pharmacy",
    issued_quantity: 0,
    current_balance: 0,
    ...overrides,
  };
}

describe("latest batch and main store analysis", () => {
  it("sorts saved batches by actual save time before snapshot/month", () => {
    const batches: UploadBatch[] = [
      {
        id: "dec",
        file_name: "dec.xlsx",
        month: "2023-12-01",
        rows_saved: 100,
        status: "saved",
        created_at: "2026-06-10T12:00:00.000Z",
        snapshot_date: "2023-12-31",
      },
      {
        id: "may",
        file_name: "may.xlsx",
        month: "2024-05-01",
        rows_saved: 100,
        status: "saved",
        created_at: "2026-06-11T12:00:00.000Z",
        snapshot_date: "2024-05-31",
      },
    ];

    expect(sortBatchesForAnalysis(batches).map((b) => b.id)).toEqual(["may", "dec"]);
  });

  it("does not let an old future snapshot override a newer saved batch", () => {
    const batches: UploadBatch[] = [
      {
        id: "old-future",
        file_name: "dec.xlsx",
        month: "2023-12-01",
        rows_saved: 100,
        status: "saved",
        created_at: "2026-06-10T12:00:00.000Z",
        snapshot_date: "2026-12-31",
      },
      {
        id: "new-may",
        file_name: "may.xlsx",
        month: "2024-05-01",
        rows_saved: 100,
        status: "saved",
        created_at: "2026-06-11T12:00:00.000Z",
        snapshot_date: "2024-05-31",
      },
    ];

    expect(sortBatchesForAnalysis(batches).map((b) => b.id)).toEqual(["new-may", "old-future"]);
  });

  it("marks deadstock only for branch stock with no issue, not zero balance or main store", () => {
    const rows = analyzeMovements([
      movement({
        id: "branch-deadstock",
        item_code: "A",
        item_name: "Atenolol 50 mg tab",
        scientific_name: "Atenolol 50 mg",
        trade_name: "Tenormin",
        issued_quantity: 0,
        current_balance: 12,
      }),
      movement({
        id: "branch-zero",
        item_code: "B",
        item_name: "Bisoprolol 5 mg tab",
        scientific_name: "Bisoprolol 5 mg",
        trade_name: "Concor",
        issued_quantity: 0,
        current_balance: 0,
      }),
      movement({
        id: "branch-need",
        item_code: "C",
        item_name: "Ceftriaxone 1 gm vial",
        scientific_name: "Ceftriaxone 1 gm",
        trade_name: "Rocephin",
        issued_quantity: 30,
        current_balance: 0,
      }),
      movement({
        id: "main-zero-with-demand",
        item_code: "C",
        item_name: "Ceftriaxone 1 gm vial",
        scientific_name: "Ceftriaxone 1 gm",
        trade_name: "Rocephin",
        location_name: "المخزن الرئيسي",
        location_type: "main_warehouse",
        issued_quantity: 0,
        current_balance: 0,
      }),
      movement({
        id: "main-without-demand",
        item_code: "D",
        item_name: "Diclofenac 75 mg amp",
        scientific_name: "Diclofenac 75 mg",
        trade_name: "Voltaren",
        location_name: "المخزن الرئيسي",
        location_type: "main_warehouse",
        issued_quantity: 0,
        current_balance: 20,
      }),
    ]);

    const byCodeAndType = new Map(rows.map((r) => [`${r.itemCode}|${r.locationType}`, r]));

    expect(byCodeAndType.get("A|sub_pharmacy")?.kind).toBe("deadstock");
    expect(byCodeAndType.get("B|sub_pharmacy")?.kind).toBe("no_data");
    expect(byCodeAndType.get("C|sub_pharmacy")?.kind).toBe("critical");
    expect(byCodeAndType.get("C|main_warehouse")?.kind).toBe("critical");
    expect(byCodeAndType.get("D|main_warehouse")?.kind).toBe("no_data");
  });
});
