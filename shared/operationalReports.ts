import {consumptionPeriodLabel,type ConsumptionPeriod} from './inventoryHistory';
export type ReportStock = { key: string; itemKey: string; itemName: string; itemCode?: string; unit?: string | null; locationName: string; locationType: string; balance: number; projectedBalance?:number;projectedKind?:string;adc?:number; days?:number|null;projectedDays?:number|null; hasBalance: boolean; hasConsumption: boolean; mixedSnapshots: boolean; snapshotDate: string;snapshotBoundary?:string|null;ledgerWarnings?:string[]; kind: string; consumptionPeriods: ConsumptionPeriod[] };
export type ReportSpec = { kind: string; scope: string; query: string; from: string; to: string; aggregate: boolean };
export type ReportRecord = { item: string; code: string; location: string; unit: string; period: string; quantity: number | null; state: string };
export function buildOperationalReport(rows: ReportStock[], spec: ReportSpec): ReportRecord[] {
  const selected = rows.filter((r) => (spec.scope === 'hospital' || (spec.scope === 'branches' ? !['main_store','main_warehouse'].includes(r.locationType) : spec.scope === 'warehouse' ? ['main_store','main_warehouse'].includes(r.locationType) : r.locationName === spec.scope))
    && `${r.itemName} ${r.itemCode || ''}`.toLowerCase().includes(spec.query.toLowerCase()));
  const result: (ReportRecord & { group: string })[] = [];
  const monthsByItem = new Map<string, Set<string>>();
  if (spec.kind === 'consumption') for (const row of selected) {
    if (['main_store','main_warehouse'].includes(row.locationType)) continue;
    const months = monthsByItem.get(row.itemKey) || new Set<string>();
    row.consumptionPeriods.forEach((period) => months.add(period.month.slice(0,7)));
    monthsByItem.set(row.itemKey, months);
  }
  for (const r of selected) {
    if (spec.kind === 'shortages' && !['critical','danger','below'].includes(r.kind)) continue;
    if (spec.kind === 'quality' && r.hasBalance && r.hasConsumption && !r.mixedSnapshots && !!r.unit) continue;
    const base = { group: r.itemKey, item: r.itemName, code: r.itemCode || '', location: r.locationName, unit: r.unit || 'غير مؤكدة' };
    if (spec.kind === 'consumption') {
      if (['main_store','main_warehouse'].includes(r.locationType)) continue;
      const months = monthsByItem.get(r.itemKey) || new Set<string>();
      for (const month of [...months].sort()) {
        if (month < spec.from || month > spec.to) continue;
        const period = r.consumptionPeriods.find((p) => p.month.startsWith(month));
        result.push({ ...base, period: period ? consumptionPeriodLabel(period) : month, quantity: r.unit && period ? period.issued : null, state: !period ? 'غير مسجل' : period.reportedSkus < period.totalSkus ? 'جزئي' : !r.unit ? 'وحدة غير مؤكدة' : period.partial ? 'فترة جزئية من الشهر' : 'مسجل' });
      }
    } else result.push({ ...base, period: r.snapshotDate, quantity: r.hasBalance && r.unit ? r.balance : null, state: !r.hasBalance ? 'رصيد ناقص' : r.mixedSnapshots ? 'تواريخ رصيد مختلفة' : !r.unit ? 'وحدة غير مؤكدة' : spec.kind === 'quality' ? 'راجع سجل الاستهلاك' : 'مسجل' });
  }
  if (!spec.aggregate) return result;
  const groups = new Map<string, (ReportRecord & { dates: Set<string>; incomplete: boolean })>();
  for (const r of result) {
    const key = JSON.stringify([r.group, r.unit, spec.kind === 'consumption' ? r.period.slice(0,7) : 'balance']);
    const old = groups.get(key);
    if (!old) groups.set(key, { ...r, location: spec.scope === 'warehouse' ? 'المخزن' : spec.scope === 'hospital' && spec.kind !== 'consumption' ? 'إجمالي المستشفى' : 'إجمالي الفروع المختارة', dates: new Set([r.period]), incomplete: r.state !== 'مسجل' });
    else {
      old.quantity = old.quantity == null && r.quantity == null ? null : (old.quantity ?? 0) + (r.quantity ?? 0);
      old.dates.add(r.period); old.incomplete ||= r.state !== 'مسجل';
    }
  }
  return [...groups.values()].map((r) => ({ ...r, period: r.dates.size > 1 ? spec.kind==='consumption'?'فترات منصرف مختلفة داخل الشهر':'تواريخ رصيد مختلفة' : r.period, state: r.incomplete ? 'إجمالي جزئي أو يحتاج مراجعة' : r.dates.size > 1 ? spec.kind==='consumption'?'فترات مختلفة؛ راجع نطاق البيانات':'أرصدة بتواريخ مختلفة؛ ليست جردًا موحدًا' : 'مسجل' }));
}
export function csvCell(value: string | number | null) {
  let text = value == null ? 'غير مسجل' : String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
