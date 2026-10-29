import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {loadContinuousAnalysis} from '@/lib/continuousAnalysis';
import {notifyInventoryChanged} from '../../../shared/inventoryRefresh';
const fixture=vi.hoisted(()=>({reads:0,balance:30,permission:1,revision:'revision-1',token:'synthetic-session',fail:false,wait:null as null|Promise<void>}));
vi.mock('@/integrations/desktop/client',()=>({
  tokenStore:{get:()=>fixture.token},
  api:{auth:{me:async()=>({ok:true,user:{id:'synthetic-user',role:'viewer',access:{permissions:['data.branches'],revision:fixture.permission}}})},queries:{
    inventoryRevision:async()=>({ok:true,revision:fixture.revision}),
    listBatchesContinuous:async()=>({ok:true,batches:[{id:'sample',month:'2026-09-01',snapshot_date:'2026-10-01',snapshot_boundary:'start_of_day',batch_kind:'monthly',uploaded_at:'2026-10-02'}]}),
    movementsByBatchIds:async()=>{
      fixture.reads++;if(fixture.wait)await fixture.wait;
      if(fixture.fail)return {ok:false};
      return {ok:true,movements:[{id:'m',upload_batch_id:'sample',item_code:'SYNTH',item_name_ar:'Synthetic 500 mg tablet',item_name_en:'Synthetic',unit:'tablet',location_name:'Synthetic branch',location_type:'sub_pharmacy',closing_balance:fixture.balance,issued_qty:30}]};
    },
  },operations:{call:async()=>({ok:true,rows:[]})},stockTxn:{list:async()=>({ok:true,rows:[]})}},
}));
const options={groupBy:'sku' as const,asOf:'2026-10-29'};
beforeEach(()=>{fixture.reads=0;fixture.balance=30;fixture.permission=1;fixture.revision='revision-1';fixture.token='synthetic-session';fixture.fail=false;fixture.wait=null;notifyInventoryChanged();});
afterEach(()=>{localStorage.clear();});
it('reuses history across screens and recalculates a new target without re-reading it',async()=>{
  const [a,b]=await Promise.all([loadContinuousAnalysis(options),loadContinuousAnalysis(options)]);
  expect(a).toEqual(b);expect(fixture.reads).toBe(1);
  await loadContinuousAnalysis({...options,targetDays:60});expect(fixture.reads).toBe(1);
  await loadContinuousAnalysis({...options,asOf:'2026-10-30'});expect(fixture.reads).toBe(2);
});
it('updates cached stock on save and never falls back to an old success after a failed new read',async()=>{
  expect((await loadContinuousAnalysis(options)).rows[0].balance).toBe(30);
  fixture.balance=70;notifyInventoryChanged();
  expect((await loadContinuousAnalysis(options)).rows[0].balance).toBe(70);
  fixture.fail=true;notifyInventoryChanged();await expect(loadContinuousAnalysis(options)).rejects.toThrow('الأرصدة');
});
it('does not reuse data across permission or account changes',async()=>{
  await loadContinuousAnalysis(options);fixture.permission=2;await loadContinuousAnalysis(options);expect(fixture.reads).toBe(2);
  fixture.token='different-synthetic-session';await loadContinuousAnalysis(options);expect(fixture.reads).toBe(3);
});
it('does not let a screen mutate the cached data used by another screen',async()=>{
  const first=await loadContinuousAnalysis(options);first.rows[0].balance=999;
  expect((await loadContinuousAnalysis(options)).rows[0].balance).toBe(30);expect(fixture.reads).toBe(1);
});
it('keeps an unchanged database warm across polling and discovers an external database revision',async()=>{
  vi.useFakeTimers();
  try{
    await loadContinuousAnalysis(options);
    vi.advanceTimersByTime(120_000);await loadContinuousAnalysis(options);expect(fixture.reads).toBe(1);
    fixture.revision='external-update';fixture.balance=90;
    expect((await loadContinuousAnalysis(options)).rows[0].balance).toBe(90);expect(fixture.reads).toBe(2);
  }finally{vi.useRealTimers();}
});
it('rejects an in-flight result after sign-out or a write instead of publishing stale stock',async()=>{
  let finish!:()=>void;fixture.wait=new Promise(resolve=>{finish=resolve;});
  const task=loadContinuousAnalysis(options);
  await vi.waitFor(()=>expect(fixture.reads).toBe(1));fixture.token='signed-out';finish();
  await expect(task).rejects.toThrow('تغيرت البيانات');
});
