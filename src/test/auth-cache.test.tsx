import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const f=vi.hoisted(()=>({event:null as any,refresh:null as any,scope:['a','b'],roles:['sub_pharmacist'],rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 auth:{onAuthStateChange:(cb:any)=>{f.event=cb;return {data:{subscription:{unsubscribe:vi.fn()}}};},getSession:async()=>({data:{session:null}}),signOut:vi.fn()},
 from:(name:string)=>({select:()=>({eq:()=>name==='user_roles'?Promise.resolve({data:f.roles.map(role=>({role}))}):{maybeSingle:async()=>({data:{assigned_location_id:'a',must_change_password:false}})}})}),
 rpc:(...args:any[])=>f.rpc(...args),
}}));
vi.mock('../../shared/inventoryRefresh',()=>({subscribeInventoryRefresh:(cb:any)=>{f.refresh=cb;return ()=>{f.refresh=null;};}}));
import {AuthProvider,useAuth} from '@/hooks/useAuth';
function Probe(){const a=useAuth();return <p>{a.user?.id||'signed-out'}:{a.access?.location_ids.join(',')||'no-scope'}</p>;}
beforeEach(()=>{f.scope=['a','b'];f.roles=['sub_pharmacist'];f.rpc.mockReset().mockImplementation(async()=>({data:{ok:true,access:{configured:true,permissions:['data.branches'],location_ids:f.scope,all_branches:false}}}));});
afterEach(cleanup);
async function login(id:string){await act(async()=>{f.event('SIGNED_IN',{user:{id}});await new Promise(resolve=>setTimeout(resolve,5));});}
it('clears cached stock when identity changes before the new profile resolves',async()=>{
 const client=new QueryClient();render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>);
 await login('a');await screen.findByText('a:a,b');client.setQueryData(['private'],{balance:40});
 f.rpc.mockImplementation(()=>new Promise(()=>{}));await login('b');
 expect(screen.getByText('b:no-scope')).toBeTruthy();expect(client.getQueryData(['private'])).toBeUndefined();
});
it('clears cached stock after the same user loses access to a branch',async()=>{
 const client=new QueryClient();render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>);
 await login('a');await screen.findByText('a:a,b');client.setQueryData(['branch-b'],{balance:40});f.scope=['a'];
 await login('a');await screen.findByText('a:a');expect(client.getQueryData(['branch-b'])).toBeUndefined();
});
