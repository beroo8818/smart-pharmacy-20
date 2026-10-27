export type TransferStock = {
  itemKey: string;
  locationName: string;
  locationType: string;
  balance: number;
  adc: number;
  kind: string;
  unit?: string | null;
};

const main = (row: TransferStock) => row.locationType === "main_store" || row.locationType === "main_warehouse";

export function planTransfers<T extends TransferStock>(rows: T[], targetDays: number) {
  const result: { from: T; to: T; qty: number; fromBefore: number; fromAfter: number; toBefore: number; toAfter: number }[] = [];
  if (!Number.isFinite(targetDays) || targetDays <= 0) return result;
  const groups = new Map<string, T[]>();
  const invalid = (row: T) => row.kind === "no_data" || !row.unit || !Number.isFinite(row.balance) || row.balance < 0 || !Number.isFinite(row.adc) || row.adc < 0;
  const blocked = new Set(rows.filter(invalid).map((row) => `${row.itemKey}|${(row.unit || "").trim().toLowerCase()}`));
  for (const row of rows) {
    if (invalid(row)) continue;
    const key = `${row.itemKey}|${row.unit.trim().toLowerCase()}`;
    if (blocked.has(key)) continue;
    const list = groups.get(key) || [];
    list.push(row); groups.set(key, list);
  }
  for (const list of groups.values()) {
    const balances = new Map(list.map((row) => [row, row.balance]));
    const branchAdc = list.filter((row) => !main(row)).reduce((sum, row) => sum + row.adc, 0);
    const keep = (row: T) => (main(row) ? branchAdc : row.adc) * targetDays;
    const needs = list.filter((row) => !main(row) && row.adc > 0 && row.balance < row.adc * targetDays)
      .sort((a, b) => a.balance / a.adc - b.balance / b.adc);
    const donors = list.filter((row) => main(row) || (row.adc > 0 && row.balance > row.adc * targetDays * 2))
      .sort((a, b) => Number(main(b)) - Number(main(a)) || b.balance - a.balance);
    for (const recipient of needs) {
      let required = Math.max(0, Math.ceil(recipient.adc * targetDays - balances.get(recipient)!));
      for (const donor of donors) {
        if (required <= 0 || donor.locationName === recipient.locationName) continue;
        const before = balances.get(donor)!;
        const qty = Math.min(required, Math.max(0, Math.floor(before - keep(donor))));
        if (!qty) continue;
        const toBefore = balances.get(recipient)!;
        balances.set(donor, before - qty); balances.set(recipient, toBefore + qty);
        result.push({ from: donor, to: recipient, qty, fromBefore: before, fromAfter: before - qty, toBefore, toAfter: toBefore + qty });
        required -= qty;
      }
    }
  }
  return result;
}
