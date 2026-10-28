import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc}}));
import {operationsCall} from '../lib/operationsClient';
afterEach(()=>{vi.restoreAllMocks();fixture.rpc.mockReset();});
it('notifies after a committed branch update, not a confirmation, duplicate or read',async()=>{
  const listener=vi.fn();window.addEventListener('dawa-inventory-changed',listener);
  try{
    fixture.rpc.mockResolvedValue({data:{ok:true,requiresRevision:true}});await operationsCall('submit');expect(listener).not.toHaveBeenCalled();
    fixture.rpc.mockResolvedValue({data:{ok:true,duplicate:true}});await operationsCall('submit');expect(listener).not.toHaveBeenCalled();
    fixture.rpc.mockResolvedValue({data:{ok:true}});await operationsCall('overview');expect(listener).not.toHaveBeenCalled();
    await operationsCall('submit');expect(listener).toHaveBeenCalledOnce();
    fixture.rpc.mockResolvedValue({error:{message:'denied'}});await expect(operationsCall('submit')).rejects.toThrow('denied');expect(listener).toHaveBeenCalledOnce();
  }finally{window.removeEventListener('dawa-inventory-changed',listener);}
});
it('desktop IPC publishes only successful committed writes',async()=>{
  const save=vi.fn(async()=>({ok:true}));
  const native={upload:{saveBatch:save},stockTxn:{insert:save,delete:save},operations:{call:save}};
  Object.defineProperty(window,'api',{value:native,writable:true,configurable:true});
  const listener=vi.fn();window.addEventListener('dawa-inventory-changed',listener);
  try{
    const {api}=await import('../../desktop/src/integrations/desktop/client');
    await api.upload.saveBatch({});expect(listener).toHaveBeenCalledTimes(1);
    save.mockResolvedValueOnce({ok:true,requiresRevision:true} as any);await api.upload.saveBatch({});expect(listener).toHaveBeenCalledTimes(1);
    save.mockResolvedValueOnce({ok:false});await api.stockTxn.insert({token:'test',txn:{} as any});expect(listener).toHaveBeenCalledTimes(1);
    await api.stockTxn.insert({token:'test',txn:{} as any});expect(listener).toHaveBeenCalledTimes(2);
    await api.operations.call({token:'test',action:'overview'});expect(listener).toHaveBeenCalledTimes(2);
    await api.operations.call({token:'test',action:'submit'});expect(listener).toHaveBeenCalledTimes(3);
  }finally{window.removeEventListener('dawa-inventory-changed',listener);delete window.api;}
});
