import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
const f=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('@/integrations/desktop/client',()=>({api:{operations:{call:(...args:any[])=>f.call(...args)}},tokenStore:{get:()=> 'test-token'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({roles:['sub_pharmacist'],access:null})}));
vi.mock('@/components/ItemIdentity',()=>({default:({name}:any)=><span>{name}</span>}));
import ActionsLog from '@/pages/ActionsLog';
beforeEach(()=>{
 f.call.mockReset().mockResolvedValue({ok:true,rows:[{id:'allowed',recommendation_key:'a',upload_batch_id:'batch',recommendation_type:'review_data',item_name:'Allowed item',to_location:'Branch A',status:'new',acted_by:'actor',acted_at:'2026-10-28T00:00:00Z',suggested_qty:1,executed_qty:null}]});
 const decision=(name:string,branch:string)=>({status:'new',at:'2026-10-28T00:00:00Z',note:'isolated test',rec:{id:name,section:'test',itemName:name,itemCode:name,to:branch,qty:1,kind:'review_data'}});
 localStorage.setItem('desktop_decisions_batch',JSON.stringify({a:decision('Allowed item','Branch A'),b:decision('Private item','Branch B')}));
});
afterEach(()=>{cleanup();localStorage.clear();});
it('shows server-scoped decisions and never automatically reads old browser records',async()=>{render(<ActionsLog/>);await screen.findByText('Allowed item');expect(screen.queryByText('Private item')).toBeNull();expect(f.call).toHaveBeenCalledWith(expect.objectContaining({action:'recommendation_list'}));});
it('fails closed when the database log cannot be read',async()=>{f.call.mockResolvedValue({ok:false,error:'تعذر التحقق من النطاق'});render(<ActionsLog/>);expect((await screen.findByRole('alert')).textContent).toContain('تعذر');expect(screen.queryByText('Private item')).toBeNull();});
