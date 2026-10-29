import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {analysisSource,setAnalysisSource,selectAnalysisBatches,ANALYSIS_SOURCE_KEY} from '../../shared/analysisSource';
import AnalysisSourceControl from '../../shared/components/AnalysisSourceControl';
import ReportCenter from '../../shared/components/ReportCenter';
import StockAlerts from '../../shared/components/StockAlerts';
import type {ReportStock} from '../../shared/operationalReports';

afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
const batches=[
  {id:'april',month:'2026-04-01',snapshot_date:'2026-05-01',uploaded_at:'2026-10-20T10:00:00Z'},
  {id:'test',month:'2026-09-01',snapshot_date:'2026-10-01',uploaded_at:'2026-10-29T10:00:00Z'},
  {id:'future',month:'2026-11-01',snapshot_date:'2026-12-01',uploaded_at:'2026-10-29T11:00:00Z'},
];
const row=(i:number):ReportStock=>({key:String(i),itemKey:String(i),itemName:`Test item ${String(i).padStart(5,'0')}`,itemCode:`T${i}`,unit:'tablet',locationName:'Test branch',locationType:'sub_pharmacy',balance:10,adc:10,days:1,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-01',kind:'critical',consumptionPeriods:[]});

it('keeps history by default and never removes old batches',()=>{
  expect(analysisSource()).toBe('history');
  const before=structuredClone(batches);
  expect(selectAnalysisBatches(batches,'2026-10-29').map(b=>b.id)).toEqual(['april','test']);
  expect(batches).toEqual(before);
});
it('isolates the latest saved file by upload time, not by snapshot date',()=>{
  expect(selectAnalysisBatches(batches,'2026-10-29',undefined,'latest_file').map(b=>b.id)).toEqual(['test']);
  const lateCorrection={...batches[0],uploaded_at:'2026-10-29T12:00:00Z'};
  expect(selectAnalysisBatches([...batches,lateCorrection],'2026-10-29',undefined,'latest_file').map(b=>b.id)).toEqual(['april']);
});
it('honors explicit batch filters, empty selections and scoped input',()=>{
  expect(selectAnalysisBatches(batches,'2026-10-29',['april'],'latest_file').map(b=>b.id)).toEqual(['april']);
  expect(selectAnalysisBatches(batches,'2026-10-29',[],'latest_file')).toEqual([]);
  expect(selectAnalysisBatches([batches[0]],'2026-10-29',undefined,'latest_file').map(b=>b.id)).toEqual(['april']);
  expect(selectAnalysisBatches([],'2026-10-29',undefined,'latest_file')).toEqual([]);
});
it('publishes a refresh and explains that a file-only view is not all hospital stock',async()=>{
  render(<AnalysisSourceControl/>);
  fireEvent.change(screen.getByRole('combobox',{name:'مصدر التحليل والتقارير'}),{target:{value:'latest_file'}});
  expect(localStorage.getItem(ANALYSIS_SOURCE_KEY)).toBe('latest_file');
  await screen.findByText(/لا يمثل كامل المستشفى/);
  setAnalysisSource('history');
  await screen.findByText(/رفع ملف جزئي لا يمسح الأصناف الغائبة/);
});
it('bounds a 7,424-row report to 100 visible rows and resets paging on search',async()=>{
  const rows=Array.from({length:7424},(_,i)=>row(i)),load=async()=>rows;
  render(<ReportCenter load={load}/>);
  await screen.findByRole('table');
  expect(screen.getAllByRole('row')).toHaveLength(101);
  expect(screen.queryByText('Test item 00100')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'الصفحة التالية'}));
  expect(screen.getByText('Test item 00100')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox',{name:'اسم الصنف أو الكود'}),{target:{value:'Test item 07423'}});
  expect(screen.getByText('Test item 07423')).toBeTruthy();
  expect(screen.getAllByRole('row')).toHaveLength(2);
});
it('exports all matching rows rather than the displayed page',async()=>{
  const rows=Array.from({length:205},(_,i)=>row(i)),load=async()=>rows;
  let content:Blob|undefined;
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn((blob:Blob)=>{content=blob;return 'blob:test';}),revokeObjectURL:vi.fn()}));
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<ReportCenter load={load}/>);await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button',{name:'تصدير CSV يفتح في Excel'}));
  const text=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsText(content!);});
  expect(text).toContain('Test item 00204');expect(text).toContain('كل الرفعات المحفوظة');
});
it('prints the complete report and restores pagination afterwards',async()=>{
  const rows=Array.from({length:205},(_,i)=>row(i)),load=async()=>rows;
  render(<ReportCenter load={load}/>);await screen.findByRole('table');
  act(()=>window.dispatchEvent(new Event('beforeprint')));
  expect(screen.getAllByRole('row')).toHaveLength(206);
  act(()=>window.dispatchEvent(new Event('afterprint')));
  expect(screen.getAllByRole('row')).toHaveLength(101);
});
it('also bounds alert tables while preserving the total count',async()=>{
  const load=async()=>({rows:Array.from({length:205},(_,i)=>row(i))});
  render(<StockAlerts load={load}/>);await screen.findByRole('table');
  expect(screen.getAllByRole('row')).toHaveLength(101);
  fireEvent.click(screen.getByRole('button',{name:'الصفحة التالية'}));
  await waitFor(()=>expect(screen.getByText('Test item 00100')).toBeTruthy());
});
