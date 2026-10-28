import { describe, expect, it } from 'vitest';
import { canAccessPage, canViewLocation } from '@/lib/permissions';
import { validateReport, WORKFLOWS } from '../../shared/operations';
import { buildOperationalReport, csvCell, type ReportStock } from '../../shared/operationalReports';

describe('branch permissions and reports', () => {
  it('does not let an added viewer role bypass a branch restriction', () => {
    expect(canViewLocation(['sub_pharmacist','viewer'],'a','b')).toBe(false);
    expect(canAccessPage(['sub_pharmacist','viewer'],'/settings')).toBe(false);
    expect(canAccessPage(['sub_pharmacist'],'/report-center')).toBe(true);
    expect(canAccessPage(['pharmacy_manager'],'/branch-access')).toBe(true);
  });
  it('keeps missing monthly quantities distinct from zero', () => {
    const row = { item_code:'M1',item_name:'Medicine',unit:'tablet',balance:0,issued:0 };
    expect(() => validateReport([row],'monthly')).not.toThrow();
    expect(() => validateReport([{...row,issued:null}],'monthly')).toThrow();
    expect(() => validateReport([row],'partial_update')).toThrow();
    expect(() => validateReport([{...row,issued:null}],'partial_update')).not.toThrow();
    expect(() => validateReport([row,row],'monthly')).toThrow();
  });
  const stock = (locationName:string, quantity:number|null, extra = {}): ReportStock => ({
    key:locationName,itemKey:'M1-tablet',itemName:'Medicine',itemCode:'M1',unit:'tablet',locationName,locationType:'sub_pharmacy',balance:10,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-01',kind:'safe',
    consumptionPeriods:quantity == null ? [] : [{month:'2026-09-01',issued:quantity,reportedSkus:1,totalSkus:1}], ...extra,
  });
  const spec = {kind:'consumption',scope:'hospital',query:'',from:'2026-09',to:'2026-09',aggregate:true};
  it('excludes warehouse issues and identifies a partial hospital total', () => {
    const report = buildOperationalReport([stock('a',300),stock('b',null),stock('warehouse',999,{locationType:'main_warehouse'})],spec);
    expect(report).toHaveLength(1);
    expect(report[0].quantity).toBe(300);
    expect(report[0].state).toContain('جزئي');
  });
  it('does not sum units or scientific groups into a single number', () => {
    const report = buildOperationalReport([stock('a',300),stock('b',20,{unit:'strip'}),stock('c',9,{itemKey:'other'})],spec);
    expect(report).toHaveLength(3);
  });
  it('does not call different snapshot dates a unified hospital count', () => {
    const report = buildOperationalReport([stock('a',300),stock('b',20,{snapshotDate:'2026-10-15'})],{...spec,kind:'balance'});
    expect(report[0].period).toContain('مختلفة');
    expect(report[0].state).toContain('ليست جردًا');
  });
  it('escapes spreadsheet formulas in exported text', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe('"\'=SUM(A1:A2)"');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toContain('غير مسجل');
  });
  it('provides role-specific workflows including manager setup and midmonth updates', () => {
    expect(WORKFLOWS).toHaveLength(11);
    expect(WORKFLOWS[3].title).toContain('15');
  });
});
