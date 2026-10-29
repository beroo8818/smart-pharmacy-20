import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import * as XLSX from 'xlsx';
import ItemDictionary from '../../shared/components/ItemDictionary';
import HospitalOperations from '../../shared/components/HospitalOperations';
import {detectBranchSheet,readBranchRows} from '../../shared/branchExcel';
import {buildInventoryHistory} from '../../shared/inventoryHistory';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
beforeEach(()=>{vi.spyOn(window,'confirm').mockReturnValue(true);});
const existing={item_code:'OLD',item_name:'Training 100 mg tablet',unit:'قرص'};
const fresh={item_code:'NEW',item_name:'Training 200 mg tablet',unit:'قرص'};
it('uses the newly registered Excel item in balance and daily consumption analysis',()=>{
 const matrix=[['اسم الصنف','الوحدة','الرصيد','المنصرف'],[fresh.item_name,'قرص',25,75]];
 const parsed=readBranchRows(matrix,detectBranchSheet(matrix,'داخلي ب','monthly'),[fresh],'داخلي ب','monthly');
 expect(parsed.issues).toEqual([]);const row=parsed.rows[0];
 const history=buildInventoryHistory([{id:'saved-new',month:'2026-10-01',snapshot_date:'2026-10-16',batch_kind:'monthly',issued_from:'2026-10-01',issued_to:'2026-10-15'}],[{batchId:'saved-new',item:'NEW',sku:'NEW',locationName:'داخلي ب',locationType:'sub_pharmacy',balance:row.balance,issued:row.issued,sample:row}],3,'2026-10-16');
 expect(history).toHaveLength(1);expect(history[0].latestBalance).toBe(25);expect(history[0].adc).toBe(5);
});
it('lists registered definitions without requiring an inventory upload and saves metadata only',async()=>{
 const items=[existing];const call=vi.fn(async(action:string,payload?:any)=>{if(action==='dictionary_list')return{ok:true,can_create:true,items:[...items]};items.push({...fresh});return{ok:true,item:fresh};});
 render(<ItemDictionary call={call}/>);await screen.findByRole('form',{name:'إضافة صنف للقاموس'});
 fireEvent.change(screen.getByLabelText('اسم الصنف الكامل'),{target:{value:fresh.item_name}});fireEvent.change(screen.getByLabelText('الوحدة'),{target:{value:fresh.unit}});
 fireEvent.click(screen.getByRole('button',{name:'حفظ الصنف بالقاموس'}));
 await waitFor(()=>expect(call).toHaveBeenCalledWith('dictionary_create',expect.objectContaining({item_name:fresh.item_name,unit:'قرص',item_code:''})));
 expect((call.mock.calls.find(([action])=>action==='dictionary_create')?.[1]as any).balance).toBeUndefined();
 expect(await screen.findByText(fresh.item_name)).toBeTruthy();
});
it('does not show creation controls to readers',async()=>{
 render(<ItemDictionary call={async()=>({ok:true,can_create:false,items:[existing]})}/>);
 await screen.findByText(existing.item_name);expect(screen.queryByRole('form')).toBeNull();expect(screen.queryByRole('button',{name:'حفظ الصنف بالقاموس'})).toBeNull();
});
it('retains entered metadata and shows a server denial without pretending to save',async()=>{
 const call=vi.fn(async(action:string)=>{if(action==='dictionary_list')return{ok:true,can_create:true,items:[]};throw Error('صلاحية غير كافية');});
 render(<ItemDictionary call={call}/>);await screen.findByLabelText('اسم الصنف الكامل');
 fireEvent.change(screen.getByLabelText('اسم الصنف الكامل'),{target:{value:fresh.item_name}});fireEvent.change(screen.getByLabelText('الوحدة'),{target:{value:'قرص'}});
 fireEvent.click(screen.getByRole('button',{name:'حفظ الصنف بالقاموس'}));expect(await screen.findByRole('alert')).toHaveTextContent('صلاحية غير كافية');expect(screen.getByLabelText('اسم الصنف الكامل')).toHaveValue(fresh.item_name);
});
function file(){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['اسم الصنف','الوحدة','الرصيد','المنصرف','اسم الصيدلية'],[fresh.item_name,'قرص',25,75,'داخلي ب']]),'Sheet1');
 const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'}),value=new File([bytes],'new-item.xlsx');Object.defineProperty(value,'arrayBuffer',{value:async()=>bytes});return value;
}
it('registers an unknown Excel item and reparses the same workbook before saving real quantities',async()=>{
 const catalog=[existing];const call=vi.fn(async(action:string,payload?:any)=>{
  if(action==='overview')return{ok:true,manager:true,location_id:'a',locations:[{id:'a',name:'داخلي ب',type:'sub_pharmacy'}],users:[],catalog:[...catalog],reports:[],transfers:[],access:{permissions:['dictionary.write']}};
  if(action==='dictionary_create'){catalog.push(fresh);return{ok:true,item:fresh};}return{ok:true};
 });
 render(<HospitalOperations call={call}/>);await screen.findByRole('heading',{name:'متابعة الصيدليات والتحديثات'});
 fireEvent.change(screen.getByLabelText('اختر ملف Excel أو CSV'),{target:{files:[file()]}});
 await screen.findByRole('button',{name:'تعريف '+fresh.item_name+' (قرص)'});expect(screen.getByRole('button',{name:'استخدام بيانات الملف في التقرير'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'تعريف '+fresh.item_name+' (قرص)'}));expect(screen.getByLabelText('اسم الصنف الكامل')).toHaveValue(fresh.item_name);
 fireEvent.click(screen.getByRole('button',{name:'حفظ الصنف بالقاموس'}));
 await screen.findByText(/جاهز: 1/);expect(screen.getByRole('button',{name:'استخدام بيانات الملف في التقرير'})).toBeEnabled();
 expect(call).not.toHaveBeenCalledWith('submit',expect.anything());
 fireEvent.click(screen.getByRole('button',{name:'استخدام بيانات الملف في التقرير'}));fireEvent.click(screen.getByRole('button',{name:'استخدام الشهر المختار حتى آخر يوم متاح'}));fireEvent.click(screen.getByRole('button',{name:'حفظ التحديث مباشرة'}));
 await waitFor(()=>expect(call).toHaveBeenCalledWith('submit',expect.objectContaining({rows:[{...fresh,balance:25,issued:75}]})));
});
it('does not offer a new definition for a known code with the wrong unit or an ambiguous name',()=>{
 const matrix=[['كود الصنف','اسم الصنف','الوحدة','الرصيد','المنصرف'],['OLD',existing.item_name,'علبة',1,2]];
 const parsed=readBranchRows(matrix,detectBranchSheet(matrix,'داخلي ب','monthly'),[existing],'داخلي ب','monthly');
 expect(parsed.issues).toHaveLength(1);expect(parsed.unknownItems).toEqual([]);expect(parsed.rows).toEqual([]);
 const named=[['اسم الصنف','الوحدة','الرصيد','المنصرف'],[existing.item_name,'قرص',1,2]];
 const ambiguous=readBranchRows(named,detectBranchSheet(named,'داخلي ب','monthly'),[existing,{...existing,item_code:'OTHER'}],'داخلي ب','monthly');
 expect(ambiguous.unknownItems).toEqual([]);expect(ambiguous.issues).toHaveLength(1);
});
it('allows a creator to inspect the first workbook even when the catalog is empty',async()=>{
 const call=async()=>({ok:true,manager:true,location_id:'a',locations:[{id:'a',name:'داخلي ب',type:'sub_pharmacy'}],users:[],catalog:[],reports:[],transfers:[],access:{permissions:['dictionary.write']}});
 render(<HospitalOperations call={call}/>);await screen.findByRole('heading',{name:'متابعة الصيدليات والتحديثات'});
 expect(screen.getByLabelText('اختر ملف Excel أو CSV')).toBeEnabled();
 fireEvent.change(screen.getByLabelText('اختر ملف Excel أو CSV'),{target:{files:[file()]}});
 await screen.findByRole('button',{name:'تعريف '+fresh.item_name+' (قرص)'});
});
