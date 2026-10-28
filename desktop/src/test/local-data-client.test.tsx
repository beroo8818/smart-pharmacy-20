import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('@/integrations/desktop/client',()=>({api:{operations:{call:(...args:any[])=>fixture.call(...args)}},tokenStore:{get:()=> 'isolated-local-session'}}));
import {supabase} from '@/integrations/supabase/client';
import {itemKeyFromParts} from '@/lib/desktopAnalytics';
beforeEach(()=>fixture.call.mockReset());
it('loads legacy metadata pages through local IPC with the current session and filters',async()=>{
 fixture.call.mockResolvedValue({ok:true,rows:[{id:'a',needs_review:false,original_item_name:'A'},{id:'b',needs_review:true,original_item_name:'B'}]});
 const result=await supabase.from('active_ingredient_dictionary').select('*').eq('approved',false).order('needs_review',{ascending:false}).range(0,0);
 expect(result.error).toBeNull();expect(result.data[0].id).toBe('b');
 expect(fixture.call).toHaveBeenCalledWith(expect.objectContaining({token:'isolated-local-session',action:'local_table',payload:expect.objectContaining({operation:'select',table:'active_ingredient_dictionary',filters:[{op:'eq',key:'approved',value:false}]})}));
});
it('preserves a native denial as an error instead of claiming a cloud write succeeded',async()=>{
 fixture.call.mockResolvedValue({ok:false,error:'permission denied'});
 const result=await supabase.from('active_ingredient_dictionary').update({approved:true}).eq('id','a');
 expect(result.data).toBeNull();expect(result.error.message).toBe('permission denied');
});
it('does not merge different strengths or forms even when a dictionary group key matches',()=>{
 const base={item_name_ar:'Test',active_ingredient_ar:'Test',strength:'500 mg',dosage_form:'tablet',unit:'tab',therapeutic_group_key:'manual-group'};
 expect(itemKeyFromParts(base)).not.toBe(itemKeyFromParts({...base,strength:'1 g'}));
 expect(itemKeyFromParts(base)).not.toBe(itemKeyFromParts({...base,dosage_form:'capsule'}));
});
