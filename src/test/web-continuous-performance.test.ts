import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {loadContinuousAnalysis} from '@/lib/continuousAnalysis';
import {notifyInventoryChanged} from '../../shared/inventoryRefresh';
const state=vi.hoisted(()=>({reads:0,balance:30,permissions:1,token:'synthetic-web-session',revokeDuringRead:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-web-user'},access_token:state.token}}})},
  rpc:async()=>({error:null,data:{ok:true,access:{permissions:['data.branches'],revision:state.permissions}}}),
  from(table:string){
    let data:any[]=table==='upload_batches'?[{id:'month',status:'saved',month:'2026-09-01',snapshot_date:'2026-10-01',snapshot_boundary:'start_of_day',batch_kind:'monthly',created_at:'2026-10-02'}]:table==='inventory_movements'?[{id:'row',upload_batch_id:'month',month:'2026-09-01',item_code:'SYNTH',item_name:'Synthetic 500 mg tablet',trade_name:'Synthetic',unit:'tablet',location_name:'Synthetic branch',location_type:'sub_pharmacy',current_balance:state.balance,issued_quantity:30}]:[];
    if(table==='inventory_movements'){state.reads++;if(state.revokeDuringRead)state.permissions++;}
    const query:any={then(resolve:Function){return Promise.resolve({data,error:null}).then(resolve as any);}};
    for(const method of ['select','order','not','gte'])query[method]=()=>query;
    query.eq=(key:string,value:unknown)=>{data=data.filter(r=>r[key]===value);return query;};
    query.in=(key:string,values:unknown[])=>{data=data.filter(r=>values.includes(r[key]));return query;};
    query.range=(a:number,b:number)=>{data=data.slice(a,b+1);return query;};
    return query;
  },
}}));
const opts={asOf:'2026-10-29',groupBy:'sku' as const};
beforeEach(()=>{state.reads=0;state.balance=30;state.permissions=1;state.token='synthetic-web-session';state.revokeDuringRead=false;notifyInventoryChanged();});
afterEach(()=>{localStorage.clear();vi.useRealTimers();});
it('shares verified raw history across web screens and refreshes after a save',async()=>{
  await Promise.all([loadContinuousAnalysis(opts),loadContinuousAnalysis(opts)]);expect(state.reads).toBe(1);
  await loadContinuousAnalysis({...opts,targetDays:60});expect(state.reads).toBe(1);
  state.balance=70;notifyInventoryChanged();expect((await loadContinuousAnalysis(opts)).rows[0].balance).toBe(70);
});
it('does not retain data across web accounts or a permission change',async()=>{
  await loadContinuousAnalysis(opts);state.permissions++;await loadContinuousAnalysis(opts);expect(state.reads).toBe(2);
  state.token='another-synthetic-session';await loadContinuousAnalysis(opts);expect(state.reads).toBe(3);
});
it('expires web cached history so another client writes are discovered by polling',async()=>{
  vi.useFakeTimers();await loadContinuousAnalysis(opts);
  vi.advanceTimersByTime(45_001);state.balance=90;
  expect((await loadContinuousAnalysis(opts)).rows[0].balance).toBe(90);expect(state.reads).toBe(2);
});
it('rejects a result when web permissions change while it is being computed',async()=>{
  state.revokeDuringRead=true;await expect(loadContinuousAnalysis(opts)).rejects.toThrow('الصلاحيات');
});
