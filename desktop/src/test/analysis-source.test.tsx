import {afterEach,expect,it,vi} from 'vitest';
import {loadContinuousAnalysis} from '@/lib/continuousAnalysis';
import {setAnalysisSource} from '../../../shared/analysisSource';

const fixture=vi.hoisted(()=>({requested:[] as string[]}));
vi.mock('@/integrations/desktop/client',()=>({
  tokenStore:{get:()=>null},
  api:{queries:{
    listBatchesContinuous:async()=>({ok:true,batches:[
      {id:'new',month:'2026-09-01',snapshot_date:'2026-10-01',snapshot_boundary:'start_of_day',batch_kind:'monthly',uploaded_at:'2026-10-29'},
      {id:'old',month:'2026-04-01',snapshot_date:'2026-05-01',snapshot_boundary:'start_of_day',batch_kind:'monthly',uploaded_at:'2026-10-20'},
    ]}),
    movementsByBatchIds:async({batchIds}:{batchIds:string[]})=>{
      fixture.requested=batchIds;
      return {ok:true,movements:batchIds.map(id=>({id,upload_batch_id:id,item_code:id,item_name_ar:id,item_name_en:id,unit:'tablet',location_name:'branch',location_type:'sub_pharmacy',closing_balance:300,issued_qty:300}))};
    },
  },operations:{call:async()=>({ok:true,rows:[]})},stockTxn:{list:async()=>({ok:true,rows:[]})}},
}));
afterEach(()=>localStorage.clear());

it('isolates new-file items before fetching movement history without deleting old stock',async()=>{
  setAnalysisSource('latest_file');
  const latest=await loadContinuousAnalysis({groupBy:'sku',asOf:'2026-10-29'});
  expect(fixture.requested).toEqual(['new']);expect(latest.rows.map(r=>r.itemCode)).toEqual(['new']);
  setAnalysisSource('history');
  const all=await loadContinuousAnalysis({groupBy:'sku',asOf:'2026-10-29'});
  expect(fixture.requested).toEqual(['new','old']);expect(all.rows.map(r=>r.itemCode).sort()).toEqual(['new','old']);
});
