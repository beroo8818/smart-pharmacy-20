import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import ActionLog from '../../shared/components/ActionLog';
import {latestDecisions,loadNativeActions,type RecommendationAction} from '../../shared/recommendationActions';
const row=(extra:Partial<RecommendationAction>={}):RecommendationAction=>({id:'event',upload_batch_id:'batch',recommendation_key:'key',recommendation_type:'review_data',item_key:'T1',item_name:'Training medicine',from_location:null,to_location:'Branch A',suggested_qty:10,executed_qty:null,status:'postponed',note:null,acted_by:'user',acted_at:'2026-10-28T12:00:00Z',...extra});
afterEach(cleanup);
it('does not let an imported old decision overwrite a newer current decision',()=>{
 const current=row({status:'executed',executed_qty:2}),old=row({id:'legacy',source:'legacy_local',acted_at:'2026-10-28T13:00:00Z',original_at:'2026-09-01T00:00:00Z',status:'rejected'});
 expect(latestDecisions([old,current]).key.status).toBe('executed');
});
it('orders effective timestamps by time rather than offset strings',()=>{
 const older=row({id:'older',acted_at:'2026-10-28T13:00:00+03:00',status:'rejected'});
 const newer=row({id:'newer',acted_at:'2026-10-28T11:00:00Z',status:'executed'});
 expect(latestDecisions([older,newer]).key.id).toBe('newer');
});
it('reads every native page instead of silently truncating a long log',async()=>{
 const call=vi.fn().mockResolvedValueOnce({rows:Array.from({length:1000},(_,i)=>row({id:String(i)}))}).mockResolvedValueOnce({rows:[row({id:'last'})]});
 expect(await loadNativeActions(call)).toHaveLength(1001);expect(call.mock.calls[1][1].offset).toBe(1000);
});
it('shows unknown quantities and historical origin without claiming a stock movement',async()=>{
 render(<ActionLog load={async()=>[row({source:'legacy_local',original_at:'2026-09-01T00:00:00Z'})]}/>);
 await screen.findByText('Training medicine');expect(screen.getByText(/المؤلف الأصلي غير مثبت/)).toBeTruthy();
 expect(screen.getByText(/لا يخصم رصيدًا/)).toBeTruthy();expect(screen.queryByRole('button',{name:'تصدير السجل CSV'})).toBeNull();
});
it('shows a read error instead of a successful empty log',async()=>{
 render(<ActionLog load={async()=>{throw new Error('database denied');}}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('database denied');expect(screen.queryByText('لا توجد قرارات محفوظة ضمن نطاقك.')).toBeNull();
});
