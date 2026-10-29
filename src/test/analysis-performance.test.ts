import {afterEach,expect,it,vi} from 'vitest';
import {createAnalysisCache} from '../../shared/analysisCache';
import {createAnalysisWorker,type AnalysisWorker} from '../../shared/analysisWorker';
import {inventoryDataVersion,notifyInventoryChanged,INVENTORY_CHANGE_KEY} from '../../shared/inventoryRefresh';
import {formatNumber} from '../../shared/numberFormat';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();});
it('coalesces in-flight reads and expires results instead of rereading on every screen',async()=>{
  vi.useFakeTimers();const cache=createAnalysisCache<number>(2,1000),load=vi.fn(async()=>17);
  expect(await Promise.all([cache.get('stock','A',load),cache.get('stock','A',load)])).toEqual([17,17]);
  expect(load).toHaveBeenCalledOnce();
  expect(await cache.get('stock','A',load)).toBe(17);expect(load).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1001);await cache.get('stock','A',load);expect(load).toHaveBeenCalledTimes(2);
});
it('isolates users and permission revisions, rejects failed reads, and bounds memory',async()=>{
  const cache=createAnalysisCache<number>(1),read=vi.fn(async()=>1);
  await cache.get('stock','user-A',read);await cache.get('stock','user-B',read);
  await cache.get('stock','user-B-permissions-revoked',read);expect(read).toHaveBeenCalledTimes(3);
  const fail=vi.fn(async()=>{throw new Error('unavailable');});
  await expect(cache.get('failure','user-B-permissions-revoked',fail)).rejects.toThrow('unavailable');
  await expect(cache.get('failure','user-B-permissions-revoked',fail)).rejects.toThrow('unavailable');
  expect(fail).toHaveBeenCalledTimes(2);
  await cache.get('one','current',read);await cache.get('two','current',read);await cache.get('one','current',read);
  expect(read).toHaveBeenCalledTimes(6);
});
it('versions local writes immediately and discovers other-tab writes without sharing stock',()=>{
  const before=inventoryDataVersion();notifyInventoryChanged();expect(inventoryDataVersion()).not.toBe(before);
  const local=inventoryDataVersion();localStorage.setItem(INVENTORY_CHANGE_KEY,'remote-write');expect(inventoryDataVersion()).not.toBe(local);
});
it('formats numbers identically while reusing formatters',()=>{
  for(const digits of [0,1,2,4])for(const n of [0,-0,-12.345,120000.897,Infinity])expect(formatNumber(n,digits)).toBe(n.toLocaleString('ar-EG',{maximumFractionDigits:digits,minimumFractionDigits:digits}));
});
it('routes calculations to a worker, associates replies, and terminates after idle',async()=>{
  vi.useFakeTimers();vi.stubGlobal('Worker',class{});
  const worker:AnalysisWorker={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null,onerror:null,onmessageerror:null};
  const fallback=vi.fn(async()=>-1),client=createAnalysisWorker<number,number>(()=>worker,fallback);
  const a=client.run(3),b=client.run(4);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);expect(fallback).not.toHaveBeenCalled();
  worker.onmessage!({data:{id:2,result:16}} as MessageEvent);
  worker.onmessage!({data:{id:1,result:9}} as MessageEvent);
  expect(await a).toBe(9);expect(await b).toBe(16);
  vi.advanceTimersByTime(60_001);expect(worker.terminate).toHaveBeenCalledOnce();
});
it('fails visibly on worker errors rather than silently blocking the UI with a large fallback',async()=>{
  vi.stubGlobal('Worker',class{});
  const worker:AnalysisWorker={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null,onerror:null,onmessageerror:null};
  const fallback=vi.fn(async()=>0),client=createAnalysisWorker<number,number>(()=>worker,fallback);
  const task=client.run(1);worker.onerror!({} as ErrorEvent);
  await expect(task).rejects.toThrow('الخلفية');expect(fallback).not.toHaveBeenCalled();
});
