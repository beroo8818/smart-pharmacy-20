import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
import {INVENTORY_CHANGE_KEY,INVENTORY_REFRESH_MS,notifyInventoryChanged,subscribeInventoryRefresh} from '../../shared/inventoryRefresh';
import {useLiveInventory} from '../../shared/useLiveInventory';
import InventoryRefreshBridge from '../../shared/components/InventoryRefreshBridge';
import ReportCenter from '../../shared/components/ReportCenter';
import StockAlerts from '../../shared/components/StockAlerts';

let unsubscribe:(()=>void)|undefined;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T20:59:30Z'));vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');});
afterEach(()=>{cleanup();unsubscribe?.();unsubscribe=undefined;vi.useRealTimers();vi.restoreAllMocks();});
async function tick(ms=1){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function settle(){await act(async()=>{await Promise.resolve();});}
function Probe({load}:{load:()=>Promise<string>}){const {data,error,loading}=useLiveInventory(load);return <div>{error?<p role="alert">{error}</p>:<p>{data}</p>}<span>{loading?'loading':'ready'}</span></div>;}

it('refreshes an open screen when the Cairo day changes without remounting',async()=>{
  const load=vi.fn(async()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date()));
  render(<Probe load={load}/>);await settle();
  const first=screen.getByText('ready').parentElement!.textContent;
  await tick(INVENTORY_REFRESH_MS+1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByText('ready').parentElement!.textContent).not.toBe(first);
});
it('coalesces a successful local save and refreshes while keeping the screen mounted',async()=>{
  let value='before';const load=vi.fn(async()=>value);
  render(<Probe load={load}/>);await settle();
  value='after';notifyInventoryChanged();notifyInventoryChanged();await tick();
  expect(screen.getByText('after')).toBeTruthy();expect(load).toHaveBeenCalledTimes(2);
});
it('refreshes on another tab write, online and focus, ignoring unrelated storage',async()=>{
  const listener=vi.fn();unsubscribe=subscribeInventoryRefresh(listener);
  window.dispatchEvent(new StorageEvent('storage',{key:'unrelated'}));await tick();expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage',{key:INVENTORY_CHANGE_KEY}));await tick();
  window.dispatchEvent(new Event('online'));await tick();window.dispatchEvent(new Event('focus'));await tick();
  expect(listener).toHaveBeenCalledTimes(3);
});
it('pauses background reads and catches up when the screen becomes visible',async()=>{
  const visible=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
  const listener=vi.fn();unsubscribe=subscribeInventoryRefresh(listener);
  notifyInventoryChanged();await tick(INVENTORY_REFRESH_MS*2);expect(listener).not.toHaveBeenCalled();
  visible.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await tick();expect(listener).toHaveBeenCalledTimes(1);
});
it('shares one timer and removes it when the last subscriber leaves',async()=>{
  const first=vi.fn(),second=vi.fn();const off1=subscribeInventoryRefresh(first);unsubscribe=subscribeInventoryRefresh(second);
  expect(vi.getTimerCount()).toBe(1);off1();await tick(INVENTORY_REFRESH_MS+1);expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledOnce();
  unsubscribe();unsubscribe=undefined;expect(vi.getTimerCount()).toBe(0);
});
it('still publishes locally when local storage is unavailable',async()=>{
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage blocked');});
  const listener=vi.fn();unsubscribe=subscribeInventoryRefresh(listener);
  expect(()=>notifyInventoryChanged()).not.toThrow();await tick();expect(listener).toHaveBeenCalledOnce();
});
it('queues a reload during an in-flight read and never commits the outdated response',async()=>{
  let finish:(value:string)=>void=()=>{};
  const load=vi.fn().mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;})).mockResolvedValue('fresh');
  render(<Probe load={load}/>);notifyInventoryChanged();await tick();
  await act(async()=>{finish('stale');});
  expect(load).toHaveBeenCalledTimes(2);expect(screen.queryByText('stale')).toBeNull();expect(screen.getByText('fresh')).toBeTruthy();
});
it('ignores an old filter response and stops work after unmount',async()=>{
  let finish:(value:string)=>void=()=>{};
  const old=()=>new Promise<string>(resolve=>{finish=resolve;});const next=vi.fn(async()=>'new filter');
  const {rerender,unmount}=render(<Probe load={old}/>);rerender(<Probe load={next}/>);await settle();
  await act(async()=>{finish('old filter');});expect(screen.queryByText('old filter')).toBeNull();
  expect(screen.getByText('new filter')).toBeTruthy();unmount();notifyInventoryChanged();await tick(INVENTORY_REFRESH_MS);expect(next).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('reports failed reloads and recovers on the next successful refresh',async()=>{
  const load=vi.fn().mockResolvedValueOnce('old').mockRejectedValueOnce(new Error('offline')).mockResolvedValue('new');
  render(<Probe load={load}/>);await settle();notifyInventoryChanged();await tick();expect(screen.getByRole('alert')).toHaveTextContent('offline');
  window.dispatchEvent(new Event('online'));await tick();expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('new')).toBeTruthy();
});
it('invalidates current inventory queries but not unrelated settings queries',async()=>{
  const inventory=vi.fn(async()=>'stock'),settings=vi.fn(async()=>'settings');
  function Queries(){useQuery({queryKey:['dashboard-continuous'],queryFn:inventory});useQuery({queryKey:['settings'],queryFn:settings});return null;}
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  const result=render(<QueryClientProvider client={client}><InventoryRefreshBridge/><Queries/></QueryClientProvider>);await settle();
  notifyInventoryChanged();await tick();expect(inventory).toHaveBeenCalledTimes(2);expect(settings).toHaveBeenCalledOnce();
  result.unmount();client.clear();
});
it('disables print/export and hides stale report rows after a reload fails',async()=>{
  const load=vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('connection failed'));
  render(<ReportCenter load={load}/>);await settle();notifyInventoryChanged();await tick();
  expect(screen.getByRole('alert')).toHaveTextContent('connection failed');expect(screen.getByRole('button',{name:'طباعة'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'تصدير CSV يفتح في Excel'})).toBeDisabled();expect(screen.queryByRole('table')).toBeNull();
});
it('refreshes the shared alert loader after a successful save',async()=>{
  const load=vi.fn(async()=>({rows:[]}));render(<StockAlerts load={load}/>);await settle();notifyInventoryChanged();await tick();expect(load).toHaveBeenCalledTimes(2);
});
