import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
const fixture=vi.hoisted(()=>({balance:300,unknown:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'training'},roles:['system_admin'],access:null})}));
vi.mock('@/components/ItemIdentity',()=>({default:({name}:any)=><span>{name}</span>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[],error:null})};return q;}}}));
vi.mock('@/lib/batchAnalysis',()=>({fetchLatestBatch:async()=>({id:'batch',month:'2026-09-01',file_name:'Training fixture',rows_saved:2}),isMainLocation:(type:string)=>type==='main_warehouse',normalize:(s:string)=>s?.toLowerCase()||''}));
vi.mock('@/lib/continuousAnalysis',()=>({CONFIDENCE_LABEL:{medium:'متوسط'},CONFIDENCE_CLASS:{medium:''},loadContinuousAnalysis:async()=>({preliminary:false,monthsCount:3,rows:[{itemKey:'T1',itemName:'Training medicine',itemCode:'T1',tradeNames:[],unit:'tablet',locationName:'Branch A',locationType:'sub_pharmacy',balance:0,issued:300,adc:10,days:0,kind:fixture.unknown?'no_data':'critical',confidence:'medium'},{itemKey:'T1',itemName:'Training medicine',itemCode:'T1',tradeNames:[],unit:'tablet',locationName:'Warehouse',locationType:'main_warehouse',balance:fixture.balance,issued:300,adc:10,days:fixture.balance/10,kind:'safe',confidence:'medium'}]})}));
vi.mock('@/lib/priority',()=>({computePriority:()=> 'normal',PRIO_LABEL:{normal:'عادي',very_urgent:'عاجل'},PRIO_CLASS:{normal:'',very_urgent:''},PRIO_RANK:{normal:1,very_urgent:0},PRIO_FILTER_OPTIONS:[{value:'all',label:'الكل'}],useVitalSet:()=>({isVital:()=>false})}));
import DailyActionCenter from '@/pages/DailyActionCenter';
const clients:QueryClient[]=[];
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);render(<MemoryRouter><QueryClientProvider client={client}><DailyActionCenter/></QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{fixture.balance=300;fixture.unknown=false;});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());});
it('shows a distribution review, not a purchase, when combined hospital stock covers the goal',async()=>{
 show();await screen.findByText(/الرصيد الإجمالي يغطي الهدف، لكن بعض الفروع/);expect(screen.queryByText(/اطلب توريد حوالي/)).toBeNull();
});
it('recommends only the hospital gap, not the unallocated branch demand again',async()=>{
 fixture.balance=250;show();const recommendation=await screen.findByText(/اطلب توريد حوالي/);expect(recommendation.textContent).toContain(new Intl.NumberFormat('ar-EG').format(50));
 expect(recommendation.textContent).not.toContain(new Intl.NumberFormat('ar-EG').format(300));
});
it('does not produce supply recommendations from incomplete item data',async()=>{
 fixture.unknown=true;show();await screen.findByText('Training fixture');await waitFor(()=>expect(screen.queryByText('جارٍ التحميل...')).toBeNull());expect(screen.queryByText(/اطلب توريد حوالي/)).toBeNull();
});
