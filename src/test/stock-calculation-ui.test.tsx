import {cleanup,render,screen,within,fireEvent} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import StockCalculationReview from '../../shared/components/StockCalculationReview';
import ReportPeriodFields from '../../shared/components/ReportPeriodFields';
import {validateReportDates} from '../../shared/inventoryHistory';
afterEach(cleanup);
const known={key:'a',locationName:'Test branch',unit:'tab',hasBalance:true,recordedBalance:100,projectedBalance:70,recordedDays:10,projectedDays:7,ledgerNet:0,ledgerWarnings:[],projectionSuppressed:false,snapshotDate:'2026-05-01',snapshotBoundary:'end_of_day'};
it('labels recorded and estimated stock and coverage separately',()=>{
  render(<StockCalculationReview rows={[known]}/>);
  expect(screen.getByRole('columnheader',{name:'تغطية مسجلة (يوم)'})).toBeTruthy();
  expect(screen.getByRole('columnheader',{name:'تغطية متوقعة (يوم)'})).toBeTruthy();
  expect(screen.getByText('التوقع للمراجعة؛ لا يغير الرصيد المسجل')).toBeTruthy();
});
it('does not present net movements as a confirmed opening balance',()=>{
  render(<StockCalculationReview rows={[{...known,key:'u',locationName:'Missing branch',hasBalance:false,snapshotDate:'',recordedDays:null,projectedDays:null,ledgerNet:30,ledgerWarnings:['رصيد أساسي غير مسجل']}]}/>);
  const row=screen.getByRole('row',{name:/Missing branch/});
  expect(within(row).getByText('غير مؤكد')).toBeTruthy();
  expect(within(row).getByText(/صافي الحركات المقروءة فقط/)).toBeTruthy();
  expect(within(row).getAllByText('بيانات غير كافية')).toHaveLength(2);
});
it('exposes an explicit beginning/end of day selection for balance uploads',()=>{
  let selected:any;
  render(<ReportPeriodFields month="2026-05-01" kind="partial_update" value={{}} onChange={value=>selected=value}/>);
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'start_of_day'}});
  expect(selected.snapshot_boundary).toBe('start_of_day');
  expect(validateReportDates('2026-05-01','2026-05-01','partial_update',{},'2026-05-02',true).snapshot_boundary).toBe('end_of_day');
  expect(()=>validateReportDates('2026-05-01','2026-05-01','partial_update',{snapshot_boundary:'invalid'},'2026-05-02')).toThrow();
});
