import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as XLSX from "xlsx";
import {
  buildInventoryHistory, locationKey, monthDays, numericValue, previousMonth, stockBalances, validISODate, todayISO,
  type HistoryBatch, type HistoryObservation,
} from "../../shared/inventoryHistory";
import { analyzeMovements, type Movement } from "@/lib/batchAnalysis";
import { planTransfers } from "../../shared/transferPlan";

const batch = (id: string, extra: Partial<HistoryBatch> = {}): HistoryBatch => ({
  id, month: "2026-04-01", snapshot_date: "2026-05-01", batch_kind: "monthly",
  created_at: `${id}T10:00:00Z`, ...extra,
});
const row = (batchId: string, extra: Partial<HistoryObservation<string>> = {}): HistoryObservation<string> => ({
  sample: batchId, batchId, item: "medicine|tablet", sku: "brand-a|tablet",
  locationName: "صيدلية الداخلي A", locationType: "sub_pharmacy", balance: 100, issued: 300, ...extra,
});
const history = (batches: HistoryBatch[], rows: HistoryObservation<string>[], window = 3) =>
  buildInventoryHistory(batches, rows, window, "2026-05-10");

describe("inventory periods and snapshots", () => {
  it("does not count two balance updates as consumption months", () => {
    const result = history([
      batch("monthly"), batch("update1", { batch_kind: "partial_update", snapshot_date: "2026-05-02" }),
      batch("update2", { batch_kind: "weekly_update", snapshot_date: "2026-05-03" }),
    ], [row("monthly"), row("update1", { balance: 90, issued: null }), row("update2", { balance: 80, issued: null })])[0];
    expect(result.latestBalance).toBe(80);
    expect(result.adc).toBe(10);
    expect(result.monthsOfData).toBe(1);
  });
  it("uses actual calendar days across distinct completed months", () => {
    const result = history([
      batch("feb", { month: "2026-02-01", snapshot_date: "2026-03-01" }),
      batch("mar", { month: "2026-03-01", snapshot_date: "2026-04-01" }), batch("apr"),
    ], [row("feb", { issued: 280 }), row("mar", { issued: 310 }), row("apr", { issued: 300 })])[0];
    expect(result.activeDays).toBe(89);
    expect(result.adc).toBe(10);
    expect(monthDays("2024-02-01")).toBe(29);
  });
  it("replaces repeated consumption reports for the same SKU and month", () => {
    const result = history([batch("a", { created_at: "2026-05-01T10:00:00Z" }),
      batch("b", { created_at: "2026-05-02T10:00:00Z" })],
    [row("a"), row("b", { balance: 120, issued: 600 })])[0];
    expect(result.adc).toBe(20);
    expect(result.latestBalance).toBe(120);
    expect(result.monthsOfData).toBe(1);
  });
  it("sums different brands without dropping the first balance", () => {
    const result = history([batch("a")], [row("a", { balance: 100, issued: 90 }),
      row("a", { sku: "brand-b|tablet", balance: 200, issued: 60 })])[0];
    expect(result.latestBalance).toBe(300);
    expect(result.adc).toBe(5);
  });
  it("retains a pharmacy whose report is not one of the last three uploads", () => {
    const batches = [batch("a"), batch("b"), batch("c"), batch("d")];
    const results = history(batches, batches.map((b) => row(b.id, { locationName: b.id })));
    expect(results).toHaveLength(4);
  });
  it("rejects future snapshots", () => {
    const results = history([batch("a"), batch("future", { snapshot_date: "2026-12-31" })],
      [row("a", { balance: 50 }), row("future", { balance: 900 })]);
    expect(results[0].latestBalance).toBe(50);
  });
  it("distinguishes unknown quantities from a real zero", () => {
    expect(numericValue(null)).toBeNull();
    expect(numericValue("")).toBeNull();
    expect(numericValue(0)).toBe(0);
    expect(numericValue("١٬٢٣٤٫٥")).toBe(1234.5);
    expect(validISODate("2026-02-31")).toBe(false);
    expect(todayISO(new Date("2026-10-27T23:00:00Z"))).toBe("2026-10-28");
    const result = history([batch("a")], [row("a", { balance: null, issued: null })])[0];
    expect(result.hasBalance).toBe(false);
    expect(result.hasConsumption).toBe(false);
    const zero = history([batch("a")], [row("a", { balance: 0, issued: 0 })])[0];
    expect(zero.hasBalance).toBe(true);
    expect(zero.hasConsumption).toBe(true);
  });
  it("does not replace a known balance with a consumption-only report", () => {
    const result = history([batch("a"), batch("b", { batch_kind: "period_consumption", snapshot_date: "2026-05-03" })],
      [row("a"), row("b", { balance: 0, issued: 600 })])[0];
    expect(result.latestBalance).toBe(100);
    expect(result.adc).toBe(20);
  });
  it("reports mixed dates instead of presenting an aligned inventory count", () => {
    const result = history([batch("a"), batch("b", { batch_kind: "partial_update", snapshot_date: "2026-05-03" })],
      [row("a"), row("a", { sku: "brand-b", balance: 200 }), row("b", { balance: 80, issued: null })])[0];
    expect(result.latestBalance).toBe(280);
    expect(result.mixedSnapshots).toBe(true);
  });
  it("normalizes warehouse aliases and parentheses without merging numbered pharmacies", () => {
    expect(locationKey("صيدلية الداخلي (A)", "sub_pharmacy")).toBe(locationKey("صيدلية الداخلي A", "sub_pharmacy"));
    expect(locationKey("المخزن", "main_store")).toBe(locationKey("المخزن", "main_warehouse"));
    expect(locationKey("الرعاية ٣", "sub_pharmacy")).not.toBe(locationKey("الرعاية 1", "sub_pharmacy"));
    expect(previousMonth("2026-01-01")).toBe("2025-12");
  });
});

describe("recorded and forecast inventory", () => {
  it("never deducts forecast consumption again when actual patient issues are recorded", () => {
    const result = stockBalances(100, 0, 20, 0, 0, 0, 20, 20);
    expect(result.recorded).toBe(80);
    expect(result.projected).toBe(80);
  });
  it("keeps an estimate separate from the recorded balance", () => {
    const result = stockBalances(100, 0, 0, 0, 0, 0, 20, 0);
    expect(result.recorded).toBe(100);
    expect(result.projected).toBe(80);
  });
  it("conserves total hospital stock during an internal transfer", () => {
    const warehouse = stockBalances(200, 0, 30, 0, 0, 0, 0, 0);
    const pharmacy = stockBalances(100, 30, 0, 0, 0, 0, 0, 0);
    expect(warehouse.recorded + pharmacy.recorded).toBe(300);
  });
});

// Exercise the same pure parser declarations shipped in both UI entry points.
function importer(relative: string) {
  const file = path.resolve(relative);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "UploadPage") break;
    if (!ts.isImportDeclaration(node)) declarations.push(node.getText(source));
  }
  const code = ts.transpileModule(declarations.join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} as Record<string, (...args: any[]) => any>, XLSX, supabase: {}, numericValue, previousMonth };
  vm.runInNewContext(code, context);
  return context.exports;
}
for (const target of ["src/pages/Upload.tsx", "desktop/src/pages/Upload.tsx"]) {
  describe(`importer ${target}`, () => {
    const parser = importer(target);
    it("detects a dated warehouse column and metadata in column A", () => {
      const structure = parser.detectStructure([
        ["اسم الصنف", "الوحدة", "رصيد 1/5/2026", "صيدلية أ", null, "صيدلية ب"],
        [null, null, null, "منصرف", "رصيد", "منصرف", "رصيد"],
        ["Medicine 500mg", "قرص", 200, 30, 100, 60, 50],
      ]);
      expect(structure.meta.itemName).toBe(0);
      expect(structure.mainStoreCandidates.map((v: any) => v.col)).toContain(2);
      const built = parser.buildLongRows([
        ["اسم الصنف", "الوحدة", "رصيد 1/5/2026", "صيدلية أ", null, "صيدلية ب"],
        [null, null, null, "منصرف", "رصيد", "منصرف", "رصيد"],
        ["Medicine 500mg", "قرص", 200, 30, 100, 60, 50],
      ], "sheet", structure, "2026-04-01", 2, new Set());
      expect(built.rows.find((r: any) => r.location_type === "main_store").closing).toBe(200);
    });
    it("does not add duplicate snapshot rows or mix different units", () => {
      const input = { _row: 2, _sheet: "sheet", month: "2026-04-01", item_code: "P500", item_name_ar: "Medicine", unit: "قرص", location: "صيدلية أ", location_type: "sub_pharmacy", closing: 100, issued: 30 };
      expect(parser.aggregateDuplicates([input, { ...input, _row: 3 }]).rows[0].closing).toBe(100);
      expect(parser.aggregateDuplicates([input, { ...input, _row: 3, closing: 200 }]).rows[0]._status).toBe("review");
      expect(parser.aggregateDuplicates([input, { ...input, unit: "شريط" }]).rows).toHaveLength(2);
      expect(parser.canonicalLocationName("صيدلية الرعاية 3")).not.toBe(parser.canonicalLocationName("صيدلية الرعاية 1"));
      expect(parser.canonicalLocationName("صيدلية خارجي الطوارئ")).not.toBe(parser.canonicalLocationName("صيدلية خارجي عيادات"));
    });
  });
}

it("sums grouped balances in the web batch analyzer", () => {
  const movement: Movement = { id: "a", upload_batch_id: "batch", month: "2026-04-01", item_code: "A", item_name: "Paracetamol 500 mg tab", scientific_name: "Paracetamol 500 mg", trade_name: "Brand A", unit: "tab", location_name: "branch", location_type: "sub_pharmacy", issued_quantity: 90, current_balance: 100 };
  const result = analyzeMovements([movement, { ...movement, id: "b", item_code: "B", trade_name: "Brand B", current_balance: 200, issued_quantity: 60 }]);
  expect(result).toHaveLength(1);
  expect(result[0].balance).toBe(300);
});

describe("transfer allocation", () => {
  const stock = (locationName: string, balance: number, adc: number, extra = {}) => ({
    itemKey: "sku-a", locationName, locationType: "sub_pharmacy", balance, adc, unit: "tablet", kind: "safe", ...extra,
  });
  it("preserves donor reserve and never allocates the same stock twice", () => {
    const input = [stock("donor", 100, 1, { kind: "over" }), stock("recipient-a", 0, 2), stock("recipient-b", 0, 2)];
    const before = JSON.stringify(input);
    const plans = planTransfers(input, 30);
    expect(plans.reduce((sum, row) => sum + row.qty, 0)).toBe(70);
    expect(plans[plans.length - 1].fromAfter).toBe(30);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("uses warehouse supply first and conserves hospital stock", () => {
    const input = [stock("branch-donor", 200, 1), stock("warehouse", 500, 0, { locationType: "main_warehouse" }), stock("recipient", 0, 2)];
    const plans = planTransfers(input, 30);
    expect(plans[0].from.locationName).toBe("warehouse");
    expect(plans[0].fromBefore + plans[0].toBefore).toBe(plans[0].fromAfter + plans[0].toAfter);
  });
  it("does not transfer unknown, mismatched-unit, or different-SKU quantities", () => {
    const recipient = stock("recipient", 0, 2);
    expect(planTransfers([recipient, stock("source", 100, 1, { unit: "strip" })], 30)).toEqual([]);
    expect(planTransfers([recipient, stock("source", 100, 1, { itemKey: "sku-b" })], 30)).toEqual([]);
    expect(planTransfers([recipient, stock("source", 100, 1, { kind: "no_data" })], 30)).toEqual([]);
    expect(planTransfers([recipient, stock("source", 100, 1), stock("unknown-pharmacy", 5, 0, { kind: "no_data" })], 30)).toEqual([]);
  });
});
