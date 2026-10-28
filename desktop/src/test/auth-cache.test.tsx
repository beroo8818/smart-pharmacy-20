import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const f=vi.hoisted(()=>({token:'session-a',user:{} as any,refresh:null as null|(()=>void),me:vi.fn()}));
vi.mock('@/integrations/desktop/client',()=>({api:{auth:{me:(...args:any[])=>f.me(...args),logout:vi.fn(),login:vi.fn()}},tokenStore:{get:()=>f.token,set:(v:string)=>{f.token=v;},clear:()=>{f.token='';}}}));
vi.mock('../../../shared/inventoryRefresh',()=>({subscribeInventoryRefresh:(cb:()=>void)=>{f.refresh=cb;return ()=>{f.refresh=null;};}}));
import {AuthProvider,useAuth} from '@/hooks/useAuth';
function Probe(){const a=useAuth();return <p>{a.user?.id||'signed-out'}</p>;}
beforeEach(()=>{f.token='session-a';f.user={id:'user-a',role:'sub_pharmacist',access:{configured:true,permissions:['data.branches'],location_ids:['a','b'],all_branches:false}};f.me.mockReset().mockImplementation(async()=>({ok:true,user:f.user}));});
afterEach(cleanup);
it('clears cached branch data when the same user loses a branch permission',async()=>{
 const client=new QueryClient();render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>);
 await screen.findByText('user-a');client.setQueryData(['branch-b'],{balance:20});
 f.user={...f.user,access:{...f.user.access,location_ids:['a']}};
 await act(async()=>{f.refresh?.();});await waitFor(()=>expect(client.getQueryData(['branch-b'])).toBeUndefined());
});
it('clears cached data when a stored session is revoked',async()=>{
 const client=new QueryClient();render(<QueryClientProvider client={client}><AuthProvider><Probe/></AuthProvider></QueryClientProvider>);
 await screen.findByText('user-a');client.setQueryData(['private'],{balance:20});f.me.mockResolvedValue({ok:false});
 await act(async()=>{f.refresh?.();});await screen.findByText('signed-out');expect(client.getQueryData(['private'])).toBeUndefined();
});
