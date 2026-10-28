import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {buildShortageReport,type ShortageStock} from '../../shared/shortageReports';
import ReportCenter from '../../shared/components/ReportCenter';
import WorkflowGuide from '../../shared/components/WorkflowGuide';
import StockAlerts from '../../shared/components/StockAlerts';
afterEach(cleanup);
const row=(name:string,balance:number,adc:number,main=false,extra={})=>({key:name,itemKey:'M1',itemName:'Test medicine',itemCode:'M1',unit:'tab',locationName:name,locationType:main?'main_warehouse':'sub_pharmacy',balance,adc,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-15',snapshotBoundary:'end_of_day',consumptionPeriods:[],kind:'below',days:balance/adc,...extra});
const fixture=()=>[row('A',40,2),row('B',20,1),row('Store',30,99,true)];
it('uses branch demand only and keeps hospital and warehouse thresholds independent',()=>{
  const rows=fixture();
  expect(buildShortageReport(rows,'warehouse14')[0].days).toBe(10);
  expect(buildShortageReport(rows,'hospital30')).toHaveLength(0);
  expect(buildShortageReport(rows,'warehouse30')[0].balance).toBe(30);
});
it('excludes exactly 14 and 30 days from strict less-than reports',()=>{
  expect(buildShortageReport([row('A',0,1),row('Store',14,0,true)],'warehouse14')).toHaveLength(0);
  expect(buildShortageReport([row('A',0,1),row('Store',30,0,true)],'warehouse30')).toHaveLength(0);
  expect(buildShortageReport([row('A',1,1),row('Store',28,0,true)],'hospital30')[0].days).toBe(29);
});
it('keeps forecast shortage calculations separate and rejects missing forecasts',()=>{
  const rows=[row('A',210,10,false,{projectedBalance:190}),row('Store',100,0,true,{projectedBalance:100})];
  expect(buildShortageReport(rows,'hospital30')).toHaveLength(0);
  expect(buildShortageReport(rows,'hospital30','','projected')[0].days).toBe(29);
  expect(rows[0].balance).toBe(210);
  const missing=buildShortageReport(fixture(),'hospital30','','projected')[0];
  expect(missing.days).toBeNull();expect(missing.state).toContain('توقع غير متاح');
});
it('lets the user explicitly switch report and alert basis without changing recorded rows',async()=>{
  const rows=[row('A',210,10,false,{projectedBalance:190,projectedKind:'below'}),row('Store',100,0,true,{projectedBalance:100,projectedKind:'safe'})];
  const view=render(<ReportCenter load={async()=>rows}/>);
  fireEvent.click(await screen.findByRole('button',{name:'المستشفى: أقل من 30 يومًا'}));
  fireEvent.change(screen.getByLabelText('أساس حساب التغطية'),{target:{value:'projected'}});
  expect(await screen.findByRole('columnheader',{name:'الرصيد المتوقع - تقديري'})).toBeTruthy();
  expect(await screen.findByText('٢٩')).toBeTruthy();view.unmount();
  render(<StockAlerts load={async()=>({rows})}/>);
  await screen.findByRole('columnheader',{name:'تغطية مسجلة (يوم)'});
  fireEvent.change(screen.getByLabelText('أساس حالة التنبيه'),{target:{value:'projected'}});
  expect(await screen.findByRole('row',{name:/Test medicine.*A/})).toHaveTextContent('أقل من الهدف');
  expect(rows[0].balance).toBe(210);
});
it('shows real zero stock with positive demand and never treats a missing balance as zero',()=>{
  const rows=[row('A',0,2),row('Store',0,0,true)];
  expect(buildShortageReport(rows,'zero_demand')).toHaveLength(2);
  const missing=[row('A',0,2,false,{hasBalance:false}),row('Store',0,0,true)];
  const record=buildShortageReport(missing,'zero_demand')[0];
  expect(record.days).toBeNull();expect(record.state).toContain('رصيد ناقص');
});
it('marks missing warehouse, unknown demand and mixed snapshot dates for review',()=>{
  expect(buildShortageReport([row('A',10,1)],'hospital30')[0].state).toContain('المخزن غير مسجلة');
  const rows=fixture();rows[0].hasConsumption=false;
  expect(buildShortageReport(rows,'warehouse14')[0].adc).toBeNull();
  rows[0].hasConsumption=true;rows[0].snapshotDate='2026-10-14';
  expect(buildShortageReport(rows,'hospital30')[0].days).toBeNull();
});
it('does not aggregate incompatible units even when an item key matches',()=>{
  const rows=[...fixture(),row('C',100,5,false,{unit:'box'})];
  const records=buildShortageReport(rows,'warehouse14');
  expect(records.find(r=>r.unit==='tab')?.days).toBe(10);
  expect(records.find(r=>r.unit==='box')?.state).toContain('المخزن غير مسجلة');
});
it('displays dedicated shortage shortcuts and metrics in the shared report center',async()=>{
  render(<ReportCenter load={async()=>fixture()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'المخزن: أقل من 14 يومًا'}));
  expect(await screen.findByRole('columnheader',{name:'تغطية مسجلة (يوم)'})).toBeTruthy();
  const record=await screen.findByRole('row',{name:/Test medicine.*المخزن الرئيسي/});
  expect(within(record).getByText('١٠')).toBeTruthy();
});
it('filters administrative instructions out of employee and viewer help',()=>{
  const {rerender}=render(<WorkflowGuide roles={['sub_pharmacist','viewer']}/>);
  expect(screen.queryByRole('heading',{name:'أول تشغيل: المدير'})).toBeNull();
  expect(screen.getByRole('heading',{name:'يوم 15: الأصناف الحرجة'})).toBeTruthy();
  rerender(<WorkflowGuide roles={['viewer']}/>);
  expect(screen.queryByRole('heading',{name:'يوم 15: الأصناف الحرجة'})).toBeNull();
  rerender(<WorkflowGuide roles={['pharmacy_manager']}/>);
  expect(screen.getByRole('heading',{name:'أول تشغيل: المدير'})).toBeTruthy();
});
it('shows the same recorded/estimated alert columns and correct desktop links',async()=>{
  render(<StockAlerts local load={async()=>({rows:fixture()})}/>);
  expect(await screen.findByRole('columnheader',{name:'تغطية متوقعة (يوم)'})).toBeTruthy();
  expect(screen.getByRole('link',{name:'العرض المتقدم السابق'}).getAttribute('href')).toBe('#/alerts/advanced');
});
