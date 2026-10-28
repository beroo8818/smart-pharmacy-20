import { expect,it } from 'vitest';
import { branchNameKey,detectBranchSheet,readBranchRows } from '../../shared/branchExcel';

const catalog=[{item_code:'M1',item_name:'Training tablet 100 mg',unit:'قرص'},{item_code:'M2',item_name:'Training vial 1 g',unit:'فيال'}];
const headers=['كود الصنف','اسم الصنف','الوحدة','الرصيد','المنصرف'];
function parse(matrix:unknown[][],kind='monthly',items=catalog){
  return readBranchRows(matrix,detectBranchSheet(matrix,'داخلي ب',kind),items,'داخلي ب',kind);
}
it('imports all monthly rows and preserves Arabic digits and real zero',()=>{
  const result=parse([headers,['M1','اسم قديم','قرص','٠','١٢'],['M2','','فيال',50,0]]);
  expect(result.issues).toEqual([]);
  expect(result.rows).toEqual([{...catalog[0],balance:0,issued:12},{...catalog[1],balance:50,issued:0}]);
});
it('matches the assigned branch aliases without merging numbered branches',()=>{
  expect(branchNameKey('صيدلية الداخلي B')).toBe(branchNameKey('داخلي ب'));
  expect(branchNameKey('الرعاية 1')).not.toBe(branchNameKey('الرعاية 2'));
});
it('excludes other branches in a long table',()=>{
  const result=parse([[...headers,'الصيدلية'],['M1','','قرص',9,5,'داخلي ب'],['M1','','قرص',900,500,'داخلي أ']]);
  expect(result.issues).toEqual([]);expect(result.rows[0].balance).toBe(9);expect(result.excluded).toBe(1);
});
it('reads the correct repeated balance and consumption columns from two header rows',()=>{
  const matrix=[['كود الصنف','اسم الصنف','الوحدة','داخلي أ',null,'صيدليه الداخلى B',null],['','','','منصرف','رصيد','منصرف','رصيد'],['M1','','قرص',100,900,3,12]];
  const format=detectBranchSheet(matrix,'داخلي ب','monthly');
  expect(format.wide).toBe(true);
  expect(readBranchRows(matrix,format,catalog,'داخلي ب','monthly').rows[0]).toEqual({...catalog[0],balance:12,issued:3});
});
it('rejects unknown codes, units, negative numbers and missing monthly consumption',()=>{
  for(const row of [['NEW','','قرص',1,2],['M1','','علبة',1,2],['M1','','قرص',-1,2],['M1','','قرص',1,null]]){
    expect(parse([headers,row]).issues).toHaveLength(1);
  }
});
it('does not guess among identical names with different codes',()=>{
  const items=[...catalog,{...catalog[0],item_code:'M3'}];
  expect(parse([['اسم الصنف','الوحدة','الرصيد','المنصرف'],[catalog[0].item_name,'قرص',2,3]],'monthly',items).issues).toHaveLength(1);
});
it('skips blank template quantities but never turns them into zero',()=>{
  const result=parse([headers,['M1','','قرص',null,null],['M2','','فيال',0,0]]);
  expect(result.rows).toHaveLength(1);expect(result.rows[0].balance).toBe(0);expect(result.skipped).toBe(1);
});
it('deduplicates identical rows and blocks conflicting duplicate quantities',()=>{
  const row=['M1','','قرص',10,2];
  const same=parse([headers,row,row]);expect(same.rows).toHaveLength(1);expect(same.duplicates).toBe(1);
  const conflict=parse([headers,row,['M1','','قرص',11,2]]);
  expect(conflict.issues[0].message).toContain('متعارضة');
});
it('balance-only updates ignore old monthly issues and preserve other items',()=>{
  const result=parse([headers,['M1','','قرص',11,100],['M2','','فيال',null,900]],'partial_update');
  expect(result.issues).toEqual([]);expect(result.rows).toEqual([{...catalog[0],balance:11,issued:null}]);expect(result.ignoredIssues).toBe(1);
});
it('imports a consumption-only file without any balance column or invented balance',()=>{
  const result=parse([['كود الصنف','الوحدة','المنصرف'],['M1','قرص',150]],'period_consumption');
  expect(result.issues).toEqual([]);expect(result.rows).toEqual([{...catalog[0],balance:null,issued:150}]);
});
it('blocks an oversized spreadsheet',()=>{
  expect(()=>parse([headers,...Array.from({length:5001},()=>['M1','','قرص',1,2])])).toThrow('5000');
});
