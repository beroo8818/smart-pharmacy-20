import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Consumption from "@/pages/Consumption";

const fixture = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/lib/continuousAnalysis", () => ({ loadContinuousAnalysis: async () => ({ rows: fixture.rows }) }));
const row = (locationName: string, issued: number, main = false) => ({
  key: locationName, itemKey: "medicine", itemName: "Test medicine", unit: "tablet", locationName,
  locationType: main ? "main_warehouse" : "sub_pharmacy",
  consumptionPeriods: [
    { month: "2026-02-01", issued, reportedSkus: 1, totalSkus: 1 },
    { month: "2026-01-01", issued: issued * 2, reportedSkus: 1, totalSkus: 1 },
  ],
});
const formatted = (number: number) => number.toLocaleString("ar-EG");
beforeEach(() => { cleanup(); fixture.rows = [row("branch A", 100), row("branch B", 200), row("warehouse", 999, true)]; });
it("shows the actual selected month total without warehouse issues", async () => {
  render(<Consumption />);
  await screen.findByText("branch A");
  expect(screen.getByTestId("hospital-issued-total").textContent).toContain(formatted(300));
  expect(screen.queryByText("warehouse")).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "شهر المنصرف" }), { target: { value: "2026-01-01" } });
  expect(screen.getByTestId("hospital-issued-total").textContent).toContain(formatted(600));
});
it("shows a partial total warning when a known location has no report", async () => {
  fixture.rows[1].consumptionPeriods = [];
  render(<Consumption />);
  await screen.findByText("branch A");
  expect(screen.getByRole("status").textContent).toContain("الإجمالي جزئي");
  expect(screen.getByTestId("hospital-issued-total").textContent).toContain(formatted(100));
});
