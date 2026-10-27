import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../../shared/inventoryHistory";
import { planTransfers } from "../../shared/transferPlan";
import * as ingredients from "@/lib/activeIngredient";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from(table: string) {
  let data = fixture.tables[table] || [];
  const query: any = { then(resolve: any) { return Promise.resolve({ data, error: null }).then(resolve); } };
  for (const name of ["select", "order", "not", "gte"]) query[name] = () => query;
  query.eq = (key: string, value: unknown) => { data = data.filter((row) => row[key] === value); return query; };
  query.in = (key: string, values: unknown[]) => { data = data.filter((row) => values.includes(row[key])); return query; };
  query.range = (from: number, to: number) => { data = data.slice(from, to + 1); return query; };
  return query;
} } }));
import { loadContinuousAnalysis } from "@/lib/continuousAnalysis";
import { fetchPagedRows } from "@/lib/pagedQuery";

function pureModule(file: string, injection: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(source.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(source)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {} as any, console, ...injection };
  vm.runInNewContext(code, context);
  return context.exports;
}
const desktopRules = pureModule("desktop/src/lib/statusRules.ts");
const desktopAnalytics = pureModule("desktop/src/lib/desktopAnalytics.ts", { ...ingredients, ...history, ...desktopRules, isMainLoc: desktopRules.isMainLocation, planTransfers });
const desktop = pureModule("desktop/src/lib/continuousAnalysis.ts", {
  ...history, ...desktopAnalytics, tokenStore: { get: () => "test-only" },
  api: { queries: {
    listBatchesContinuous: async () => ({ ok: true, batches: fixture.tables.upload_batches }),
    movementsByBatchIds: async ({ batchIds }: any) => ({ ok: true, movements: fixture.tables.inventory_movements.filter((m) => batchIds.includes(m.upload_batch_id))
      .map((m) => ({ ...m, issued_qty: m.issued_quantity, closing_balance: m.current_balance, item_name_ar: m.item_name, item_name_en: m.trade_name, active_ingredient_ar: m.scientific_name })) }),
  }, stockTxn: { list: async () => ({ ok: true, rows: fixture.tables.stock_transactions || [] }) } },
});
const batch = (id: string, extra = {}) => ({ id, file_name: id, month: "2026-04-01", status: "saved", rows_saved: 1, created_at: "2026-05-01T10:00:00Z", snapshot_date: "2026-05-01", batch_kind: "monthly", ...extra });
const movement = (id: string, upload_batch_id: string, extra = {}) => ({ id, upload_batch_id, month: "2026-04-01", item_code: "P500", item_name: "Paracetamol 500 mg tab", scientific_name: "Paracetamol 500 mg", trade_name: "Brand A", unit: "tab", location_name: "branch", location_type: "sub_pharmacy", issued_quantity: 300, current_balance: 100, ...extra });

for (const [name, load] of [["web", loadContinuousAnalysis], ["desktop", desktop.loadContinuousAnalysis]] as const) {
  describe(`continuous regression ${name}`, () => {
    beforeEach(() => { fixture.tables = { upload_batches: [batch("monthly")], inventory_movements: [movement("a", "monthly")], stock_transactions: [] }; });
    it("does not dilute monthly consumption after balance-only updates", async () => {
      fixture.tables.upload_batches.push(batch("partial1", { batch_kind: "partial_update", snapshot_date: "2026-05-02" }), batch("partial2", { batch_kind: "partial_update", snapshot_date: "2026-05-03" }));
      fixture.tables.inventory_movements.push(movement("b", "partial1", { issued_quantity: null, current_balance: 90 }), movement("c", "partial2", { issued_quantity: null, current_balance: 80 }));
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows[0].adc).toBe(10);
      expect(result.rows[0].snapshotBalance).toBe(80);
      expect(result.rows[0].monthsOfData).toBe(1);
    });
    it("separates actual dispensing from forecast deductions", async () => {
      fixture.tables.stock_transactions.push({ id: "txn", txn_date: "2026-05-02", txn_type: "pharmacy_issue", item_key: "P500", item_code: "P500", unit: "tab", from_location_name: "branch", from_location_type: "sub_pharmacy", qty: 20, created_at: "2026-05-02T10:00:00Z" });
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows[0].balance).toBe(80);
      expect(result.rows[0].projectedBalance).toBe(80);
      expect(result.rows[0].projectionSuppressed).toBe(true);
    });
    it("ignores future inventory and future transactions", async () => {
      fixture.tables.upload_batches.push(batch("future", { snapshot_date: "2026-12-31" }));
      fixture.tables.inventory_movements.push(movement("future", "future", { current_balance: 900 }));
      fixture.tables.stock_transactions.push({ txn_date: "2026-12-31", txn_type: "pharmacy_issue", item_key: "P500", from_location_name: "branch", from_location_type: "sub_pharmacy", qty: 100 });
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows[0].balance).toBe(100);
    });
    it("keeps unknown consumption distinct from zero dispensing", async () => {
      fixture.tables.inventory_movements = [movement("a", "monthly", { issued_quantity: null })];
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows[0].kind).toBe("no_data");
    });
    it("applies a transaction for any brand in a scientific group, not just the last brand", async () => {
      fixture.tables.inventory_movements.push(movement("b", "monthly", { item_code: "OTHER", trade_name: "Brand B", current_balance: 200 }));
      fixture.tables.stock_transactions.push({ id: "txn", txn_date: "2026-05-02", txn_type: "pharmacy_issue", item_key: "P500", item_code: "P500", unit: "tab", from_location_name: "branch", from_location_type: "sub_pharmacy", qty: 20, created_at: "2026-05-02T10:00:00Z" });
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].balance).toBe(280);
    });
    it("does not invent stock when a pharmacy returns stock to the warehouse", async () => {
      fixture.tables.inventory_movements.push(movement("w", "monthly", { location_type: "main_warehouse", location_name: "warehouse", current_balance: 200, issued_quantity: null }));
      fixture.tables.stock_transactions.push({ id: "return", txn_date: "2026-05-02", txn_type: "warehouse_return", item_key: "P500", item_code: "P500", unit: "tab", from_location_name: "branch", from_location_type: "sub_pharmacy", to_location_name: "warehouse", to_location_type: "main_warehouse", qty: 30, created_at: "2026-05-02T10:00:00Z" });
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows.reduce((sum: number, row: any) => sum + row.balance, 0)).toBe(300);
      expect(result.rows.find((row: any) => row.locationName === "warehouse").balance).toBe(230);
    });
    it("conserves hospital balance when stock moves from warehouse to pharmacy", async () => {
      fixture.tables.inventory_movements.push(movement("w", "monthly", { location_type: "main_warehouse", location_name: "warehouse", current_balance: 200, issued_quantity: null }));
      fixture.tables.stock_transactions.push({ id: "transfer", txn_date: "2026-05-02", txn_type: "warehouse_issue_to_pharmacy", item_key: "P500", unit: "tab", from_location_name: "warehouse", from_location_type: "main_warehouse", to_location_name: "branch", to_location_type: "sub_pharmacy", qty: 30, created_at: "2026-05-02T10:00:00Z" });
      const result = await load({ asOf: "2026-05-03" });
      expect(result.rows.reduce((sum: number, row: any) => sum + row.balance, 0)).toBe(300);
      expect(result.rows.find((row: any) => row.location_name === "warehouse")?.expectedConsumption ?? result.rows.find((row: any) => row.locationName === "warehouse").expectedConsumption).toBe(0);
    });
  });
}

it("reads every API page instead of silently truncating pharmacy rows", async () => {
  const data = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await fetchPagedRows(() => ({ range: (from: number, to: number) => Promise.resolve({ data: data.slice(from, to + 1), error: null }) }));
  expect(result).toHaveLength(1201);
});
