import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import HospitalOperations from '../../shared/components/HospitalOperations';
import WorkflowGuide from '../../shared/components/WorkflowGuide';
import AccountPassword from '../../shared/components/AccountPassword';
import * as XLSX from 'xlsx';

const branch = () => ({ ok:true,manager:false,location_id:'a',locations:[{id:'a',name:'داخلي ب',type:'sub_pharmacy'}],users:[],catalog:[{item_code:'M1',item_name:'Test medicine',unit:'tablet'}],reports:[],transfers:[] });
beforeEach(() => { vi.spyOn(window,'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('locks the branch selector and hides manager controls for a branch user', async () => {
  const call=vi.fn(async () => branch());
  render(<HospitalOperations call={call} />);
  await screen.findByRole('heading',{name:'صيدليتي'});
  expect(screen.getByRole('combobox',{name:'الصيدلية'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'إضافة صيدلية'})).toBeNull();
  expect(screen.queryByText('Branch B')).toBeNull();
});
it('saves a real zero directly in a monthly report for the assigned branch', async () => {
  const call=vi.fn(async (action:string) => action === 'overview' ? branch() : {ok:true});
  render(<HospitalOperations call={call} />);
  await screen.findByRole('heading',{name:'صيدليتي'});
  fireEvent.click(screen.getByText('إدخال يدوي اختياري'));
  fireEvent.change(screen.getByLabelText('الصنف والوحدة'),{target:{value:'M1|tablet'}});
  fireEvent.change(screen.getByLabelText('الرصيد الفعلي'),{target:{value:'0'}});
  fireEvent.change(screen.getByLabelText('منصرف الفترة المحددة'),{target:{value:'0'}});
  fireEvent.click(screen.getByRole('button',{name:'إضافة الصنف للتقرير'}));
  fireEvent.click(screen.getByRole('button',{name:'استخدام الشهر المختار حتى آخر يوم متاح'}));
  fireEvent.click(screen.getByRole('button',{name:'حفظ التحديث مباشرة'}));
  await waitFor(() => expect(call).toHaveBeenCalledWith('submit',expect.objectContaining({location_id:'a',kind:'monthly',rows:[{item_code:'M1',item_name:'Test medicine',unit:'tablet',balance:0,issued:0}]})));
  expect(await screen.findByRole('status')).toHaveTextContent('ظهر التحديث في التحليل');
});
it('allows this month with explicit days independently of the balance date',async()=>{
  const call=vi.fn(async(action:string)=>action==='overview'?branch():{ok:true});
  render(<HospitalOperations call={call}/>);
  await screen.findByRole('heading',{name:'صيدليتي'});
  fireEvent.change(screen.getByLabelText('شهر التقرير'),{target:{value:'2026-10'}});
  fireEvent.change(screen.getByLabelText('المنصرف من يوم'),{target:{value:'2026-10-01'}});
  fireEvent.change(screen.getByLabelText('المنصرف إلى يوم شاملًا'),{target:{value:'2026-10-15'}});
  fireEvent.change(screen.getByLabelText('تاريخ الرصيد'),{target:{value:'2026-10-16'}});
  fireEvent.click(screen.getByText('إدخال يدوي اختياري'));
  fireEvent.change(screen.getByLabelText('الصنف والوحدة'),{target:{value:'M1|tablet'}});
  fireEvent.change(screen.getByLabelText('الرصيد الفعلي'),{target:{value:'50'}});
  fireEvent.change(screen.getByLabelText('منصرف الفترة المحددة'),{target:{value:'150'}});
  fireEvent.click(screen.getByRole('button',{name:'إضافة الصنف للتقرير'}));
  fireEvent.click(screen.getByRole('button',{name:'حفظ التحديث مباشرة'}));
  await waitFor(()=>expect(call).toHaveBeenCalledWith('submit',expect.objectContaining({month:'2026-10-01',snapshot_date:'2026-10-16',snapshot_boundary:'end_of_day',issued_from:'2026-10-01',issued_to:'2026-10-15'})));
});
it.each([false,true])('preserves the draft unless a revision is confirmed (%s)',async(confirmed)=>{
  vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(confirmed);
  const call=vi.fn(async(action:string,payload?:Record<string,unknown>)=>action==='overview'?branch():payload?.confirm_revision?{ok:true}:{requiresRevision:true,error:'تصحيح أرقام الفترة السابقة'});
  render(<HospitalOperations call={call}/>);
  await screen.findByRole('heading',{name:'صيدليتي'});
  fireEvent.click(screen.getByText('إدخال يدوي اختياري'));
  fireEvent.change(screen.getByLabelText('الصنف والوحدة'),{target:{value:'M1|tablet'}});
  fireEvent.change(screen.getByLabelText('الرصيد الفعلي'),{target:{value:'5'}});
  fireEvent.change(screen.getByLabelText('منصرف الفترة المحددة'),{target:{value:'10'}});
  fireEvent.click(screen.getByRole('button',{name:'إضافة الصنف للتقرير'}));
  fireEvent.click(screen.getByRole('button',{name:'استخدام الشهر المختار حتى آخر يوم متاح'}));
  fireEvent.click(screen.getByRole('button',{name:'حفظ التحديث مباشرة'}));
  await waitFor(()=>expect(window.confirm).toHaveBeenCalledTimes(2));
  if(confirmed){
    await waitFor(()=>expect(call).toHaveBeenCalledWith('submit',expect.objectContaining({confirm_revision:true})));
    expect(await screen.findByRole('status')).toHaveTextContent('ظهر التحديث في التحليل');
    expect(screen.getByRole('button',{name:'حفظ التحديث مباشرة'})).toBeDisabled();
  }else{
    expect(call.mock.calls.filter(([action])=>action==='submit')).toHaveLength(1);
    await waitFor(()=>expect(screen.getByRole('button',{name:'حفظ التحديث مباشرة'})).toBeEnabled());
    expect(screen.getByRole('button',{name:'إزالة من المسودة'})).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  }
});
it('submits consumption only without asking the branch for a new stock count',async()=>{
  const call=vi.fn(async(action:string)=>action==='overview'?branch():{ok:true});
  render(<HospitalOperations call={call}/>);
  await screen.findByRole('heading',{name:'صيدليتي'});
  fireEvent.change(screen.getByLabelText(/نوع التقرير/),{target:{value:'period_consumption'}});
  fireEvent.change(screen.getByLabelText('شهر التقرير'),{target:{value:'2026-10'}});
  fireEvent.change(screen.getByLabelText('المنصرف من يوم'),{target:{value:'2026-10-01'}});
  fireEvent.change(screen.getByLabelText('المنصرف إلى يوم شاملًا'),{target:{value:'2026-10-15'}});
  expect(screen.queryByLabelText('تاريخ الرصيد')).toBeNull();
  fireEvent.click(screen.getByText('إدخال يدوي اختياري'));
  expect(screen.queryByLabelText('الرصيد الفعلي')).toBeNull();
  fireEvent.change(screen.getByLabelText('الصنف والوحدة'),{target:{value:'M1|tablet'}});
  fireEvent.change(screen.getByLabelText('منصرف الفترة المحددة'),{target:{value:'150'}});
  fireEvent.click(screen.getByRole('button',{name:'إضافة الصنف للتقرير'}));
  fireEvent.click(screen.getByRole('button',{name:'حفظ التحديث مباشرة'}));
  await waitFor(()=>expect(call).toHaveBeenCalledWith('submit',expect.objectContaining({kind:'period_consumption',snapshot_date:'2026-10-15',rows:[{item_code:'M1',item_name:'Test medicine',unit:'tablet',issued:150,balance:null}]})));
});
it('offers manager assignment without exposing privileged target accounts', async () => {
  const data = {...branch(),manager:true,location_id:null,users:[{id:'target',name:'Employee',roles:['viewer'],assigned_location_id:null},{id:'admin',name:'Administrator',roles:['system_admin'],assigned_location_id:null}]};
  const call=vi.fn(async (action:string) => action === 'overview' ? data : {ok:true});
  render(<HospitalOperations call={call} access />);
  await screen.findByRole('heading',{name:'إدارة الفروع والمستخدمين'});
  expect(screen.queryByRole('option',{name:'Administrator'})).toBeNull();
  fireEvent.change(screen.getByLabelText('الموظف'),{target:{value:'target'}});
  fireEvent.click(screen.getByRole('button',{name:'تعيين صيدلي فرعي للصيدلية المختارة'}));
  await waitFor(() => expect(call).toHaveBeenCalledWith('assign',{user_id:'target',location_id:'a'}));
});
it('fails closed when the server upgrade is absent', async () => {
  render(<HospitalOperations call={async () => { throw new Error('ترقية غير مفعلة'); }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('لا يتم استخدام وضع بلا صلاحيات');
});
it('previews a whole Excel file before adding it to the branch report draft', async()=>{
  const call=vi.fn(async()=>branch());
  render(<HospitalOperations call={call}/>);
  await screen.findByRole('heading',{name:'صيدليتي'});
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['كود الصنف','الوحدة','الرصيد','المنصرف'],['M1','tablet',42,90]]),'Sheet1');
  const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'});
  const file=new File([bytes],'test.xlsx');
  Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes});
  fireEvent.change(screen.getByLabelText('اختر ملف Excel أو CSV'),{target:{files:[file]}});
  await screen.findByText(/جاهز: 1/);
  expect(call).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'استخدام بيانات الملف في التقرير'}));
  expect(await screen.findByText(/تم تجهيز 1 صنف من الملف/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'حفظ التحديث مباشرة'})).toBeEnabled();
  expect(call).not.toHaveBeenCalledWith('submit',expect.anything());
});
it('shows printable workflows for employees and managers', () => {
  render(<WorkflowGuide roles={['sub_pharmacist']} />);
  expect(screen.getByRole('button',{name:'طباعة دليل التشغيل'})).toBeTruthy();
  expect(screen.getByRole('heading',{name:'يوم 15: الأصناف الحرجة'})).toBeTruthy();
});
it('does not submit a password confirmation mismatch', async () => {
  const save=vi.fn(async()=>{});
  render(<AccountPassword save={save} />);
  fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'),{target:{value:'test-old-only'}});
  fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'),{target:{value:'test-new-only'}});
  fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور الجديدة'),{target:{value:'test-different'}});
  fireEvent.submit(screen.getByRole('button',{name:'حفظ كلمة المرور'}).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('التأكيد يجب أن يطابقها');
  expect(save).not.toHaveBeenCalled();
});
