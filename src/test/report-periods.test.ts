import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {buildInventoryHistory,dateRangeDays,validateReportDates,consumptionPeriodLabel} from '../../shared/inventoryHistory';
import {summarizeConsumption} from '../../shared/consumptionReport';
const native=createRequire(import.meta.url)('../../desktop/electron/ipc/reportDates.cjs');
const batch=(id:string,from:string,to:string,extra={})=>({id,month:'2026-10-01',snapshot_date:'2026-10-27',batch_kind:'monthly',issued_from:from,issued_to:to,created_at:'2026-10-27T10:00:00Z',...extra});
const row=(id:string,issued:number,balance=50,extra={})=>({sample:id,batchId:id,item:'M1|tab',sku:'M1|tab',locationName:'A',locationType:'sub_pharmacy',issued,balance,...extra});
function history(batches:any[],rows:any[]){return buildInventoryHistory(batches,rows,3,'2026-10-28')[0];}
it('counts inclusive days and rejects impossible dates',()=>{
  expect(dateRangeDays('2026-10-01','2026-10-15')).toBe(15);
  expect(dateRangeDays('2024-02-01','2024-02-29')).toBe(29);
  expect(dateRangeDays('2026-02-31','2026-03-01')).toBe(0);
});
it('uses the actual current-month period, independent of the later balance date',()=>{
  const result=history([batch('a','2026-10-01','2026-10-25')],[row('a',250)]);
  expect(result.adc).toBe(10);expect(result.activeDays).toBe(25);expect(result.latestSnapshot).toBe('2026-10-27');
  expect(result.consumptionPeriods[0].issued).toBe(250);expect(result.consumptionPeriods[0].partial).toBe(true);
});
it('replaces 1-15 with cumulative 1-25 without adding the covered consumption',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','2026-10-01','2026-10-25')],[row('a',150),row('b',250)]);
  expect(result.adc).toBe(10);expect(result.activeDays).toBe(25);expect(result.consumptionPeriods[0].issued).toBe(250);
});
it('adds 16-25 to 1-15 and divides by the combined 25 days',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','2026-10-16','2026-10-25')],[row('a',150),row('b',100)]);
  expect(result.activeDays).toBe(25);expect(result.adc).toBe(10);expect(result.consumptionPeriods[0].reportedSkus).toBe(1);
  expect(result.consumptionPeriods[0].issued).toBe(250);
});
it('does not silently calculate ambiguous crossing intervals',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','2026-10-10','2026-10-25')],[row('a',150),row('b',160)]);
  expect(result.hasConsumption).toBe(false);expect(result.adc).toBe(0);
});
it('a later comprehensive report resolves historic crossing subperiods',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','2026-10-10','2026-10-25'),batch('c','2026-10-01','2026-10-25')],[row('a',150),row('b',160),row('c',250)]);
  expect(result.hasConsumption).toBe(true);expect(result.adc).toBe(10);
});
it('does not let an old narrow period uploaded later replace a larger cumulative period',()=>{
  const result=history([batch('a','2026-10-01','2026-10-25'),batch('b','2026-10-01','2026-10-15',{created_at:'2026-10-28T10:00:00Z',snapshot_date:'2026-10-15'})],[row('a',250,50),row('b',150,999)]);
  expect(result.consumptionPeriods[0].issued).toBe(250);expect(result.latestBalance).toBe(50);
});
it('uses the newest correction for the exact same days and preserves zero',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','2026-10-01','2026-10-15',{created_at:'2026-10-28T10:00:00Z'})],[row('a',150),row('b',0)]);
  expect(result.hasConsumption).toBe(true);expect(result.adc).toBe(0);expect(result.consumptionPeriods[0].issued).toBe(0);
});
it('keeps the consumption when a balance-only report updates a different day',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15'),batch('b','','',{batch_kind:'partial_update',snapshot_date:'2026-10-28'})],[row('a',150),row('b',null as any,42)]);
  expect(result.latestBalance).toBe(42);expect(result.adc).toBe(10);expect(result.activeDays).toBe(15);
});
it('does not assume unreported gap days have zero consumption',()=>{
  const result=history([batch('a','2026-10-01','2026-10-05'),batch('b','2026-10-11','2026-10-15')],[row('a',50),row('b',100)]);
  expect(result.activeDays).toBe(10);expect(result.adc).toBe(15);expect(result.consumptionPeriods[0].partial).toBe(true);
});
it('retains legacy completed months without rewriting their data',()=>{
  const result=history([batch('a','','',{month:'2026-09-01',issued_from:null,issued_to:null})],[row('a',300)]);
  expect(result.adc).toBe(10);expect(result.activeDays).toBe(30);
});
it('includes exact day ranges in reports and marks an incomplete month',()=>{
  const result=history([batch('a','2026-10-01','2026-10-15')],[row('a',150)]);
  expect(consumptionPeriodLabel(result.consumptionPeriods[0])).toContain('2026-10-15');
  expect(summarizeConsumption([{itemKey:'M1',locationName:'A',locationType:'sub_pharmacy',unit:'tab',consumptionPeriods:result.consumptionPeriods}],'M1','2026-10-01').complete).toBe(false);
});
for(const [name,validate] of [
  ['ui',(m:string,s:string,k:string,p:any)=>validateReportDates(m,s,k,p,'2026-10-28',false)],
  ['native',(m:string,s:string,k:string,p:any)=>native.normalizeDates(m,s,k,p,'2026-10-28')],
]as const){
  it(name+' validates actual dates, optional inbound dates and legacy completed months',()=>{
    const dates={issued_from:'2026-10-01',issued_to:'2026-10-15',received_from:'2026-10-01',received_to:'2026-10-27'};
    expect(validate('2026-10-01','2026-10-27','monthly',dates)).toEqual(dates);
    expect(validate('2026-09-01','2026-10-01','monthly',{}).issued_from).toBeNull();
    for(const p of [{},{issued_from:'2026-10-01'},{issued_from:'2026-10-16',issued_to:'2026-10-15'},{issued_from:'2026-09-01',issued_to:'2026-10-15'},{issued_from:'2026-10-01',issued_to:'2026-10-29'}])expect(()=>validate('2026-10-01','2026-10-27','monthly',p)).toThrow();
    expect(()=>validate('2026-10-01','2026-10-27','partial_update',{received_from:'2026-10-01'})).toThrow();
  });
}
