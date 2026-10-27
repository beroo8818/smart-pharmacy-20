import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Items from "@/pages/Items";
import { fmtNum } from "@/lib/desktopAnalytics";

const fixture = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
}));
vi.mock("@/integrations/desktop/client", () => ({
  tokenStore: { get: () => "test-only" },
  api: { queries: { listBatches: async () => ({ ok: true, batches: [] }) } },
}));
vi.mock("@/lib/continuousAnalysis", () => ({
  loadContinuousAnalysis: async () => ({ rows: fixture.rows, latestBatch: null }),
}));
vi.mock("@/components/ItemIdentity", () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));

const row = (locationName: string, balance: number, adc: number, main = false) => ({
  key: locationName, itemKey: "P500|tablet", itemName: "Test medicine 500mg", tradeNames: ["Brand A"],
  itemCode: "P500", unit: "tablet", locationName, locationType: main ? "main_warehouse" : "sub_pharmacy",
  balance, adc, issued: adc * 30, days: balance / adc, kind: "safe", severity: "low", why: "", action: "",
  hasBalance: true, hasConsumption: true, mixedSnapshots: false, snapshotDate: "2026-10-28",
});

describe("desktop item totals", () => {
  beforeEach(() => {
    cleanup();
    fixture.rows = [row("pharmacy A", 60, 2), row("pharmacy B", 40, 1), row("warehouse", 200, 3, true)];
  });
  it("shows branches, warehouse, and hospital totals independently", async () => {
    render(<Items />);
    await screen.findByRole("cell", { name: fmtNum(100) });
    const scope = screen.getByRole("combobox", { name: "نطاق العرض" });
    fireEvent.change(scope, { target: { value: "main" } });
    expect(screen.getByRole("cell", { name: fmtNum(200) })).toBeTruthy();
    fireEvent.change(scope, { target: { value: "hospital" } });
    expect(screen.getByRole("cell", { name: fmtNum(300) })).toBeTruthy();
    fireEvent.change(scope, { target: { value: "branch:pharmacy A" } });
    expect(screen.getByRole("cell", { name: fmtNum(60) })).toBeTruthy();
  });
  it("accepts additional pharmacies without a fixed 15-site list", async () => {
    fixture.rows = Array.from({ length: 25 }, (_, n) => row(`pharmacy ${n + 1}`, 10, 1));
    render(<Items />);
    await screen.findByRole("cell", { name: fmtNum(250) });
    expect(screen.getByRole("option", { name: "pharmacy 25" })).toBeTruthy();
  });
});
