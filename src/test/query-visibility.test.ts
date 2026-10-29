import {expect,it,vi} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

it('checks visibility once per location per read, and rechecks after permissions change',()=>{
  let allowed='A';
  const visible=vi.fn((_user:unknown,name:string)=>name===allowed);
  const rows=Array.from({length:10000},(_,i)=>({id:i,location_name:i%2?'A':'B',location_type:'sub_pharmacy'}));
  const exported:{exports:Record<string,Function>}={exports:{}};
  const require=(name:string)=>{
    if(name==='../db/sqlite.cjs')return {getDb:()=>({prepare:()=>({all:()=>rows})})};
    if(name==='./auth.cjs')return {getCurrentUser:()=>({ok:true,user:{id:'test'}})};
    if(name==='./access.cjs')return {visible};
    throw new Error(`Unexpected import ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('desktop/electron/ipc/queries.cjs'),'utf8'),{require,module:exported});
  const query=exported.exports.getMovementsByBatchIds;
  expect(query({token:'test',batchIds:['test']}).movements).toHaveLength(5000);
  expect(visible).toHaveBeenCalledTimes(2);
  allowed='B';
  const second=query({token:'test',batchIds:['test']}).movements;
  expect(second.every((r:{location_name:string})=>r.location_name==='B')).toBe(true);
  expect(visible).toHaveBeenCalledTimes(4);
  visible.mockClear();
  exported.exports.getMovementsByBatch({token:'test',batchId:'test'});
  expect(visible).toHaveBeenCalledTimes(2);
});
