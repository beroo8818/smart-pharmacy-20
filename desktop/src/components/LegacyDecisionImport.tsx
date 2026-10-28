import {useState} from 'react';
import {api,tokenStore} from '@/integrations/desktop/client';
import {operationsCall} from '@/lib/operationsClient';
export default function LegacyDecisionImport(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function importOld(){
  if(!window.confirm('سيتم نسخ القرارات القديمة المتاحة لهذا الجهاز إلى قاعدة البيانات كسجلات تاريخية غير مثبت مؤلفها الأصلي. لن يتغير أي رصيد ولن تحذف النسخة القديمة. متابعة؟'))return;
  setBusy(true);setMessage('');
  try{
   const batches=await api.queries.listBatchesContinuous({token:tokenStore.get()});if(!batches.ok)throw new Error('تعذر قراءة الملفات');
   const records:Record<string,unknown>[]=[],errors:string[]=[];
   for(const batch of batches.batches){
    const raw=localStorage.getItem('desktop_decisions_'+batch.id);if(!raw)continue;
    try{
     const values=JSON.parse(raw);if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('تنسيق قديم غير صالح');
     for(const [key,value] of Object.entries(values)){
      const d=value as any,r=d?.rec;if(!r){errors.push('قرار بلا بيانات في '+batch.file_name);continue;}
      records.push({upload_batch_id:batch.id,recommendation_key:r.id||key,recommendation_type:r.kind||'review_data',item_key:r.itemKey||null,item_name:r.itemName||null,item_code:r.itemCode||null,unit:r.unit||null,from_location:r.from||null,to_location:r.to||null,suggested_qty:r.qty??null,executed_qty:d.qty??null,status:d.status,note:d.note||null,original_at:d.at});
     }
    }catch(e){errors.push(batch.file_name+': '+(e as Error).message);}
   }
   if(records.length>10000)throw new Error('الذاكرة القديمة كبيرة؛ راجع مسؤول التشغيل قبل استيرادها');
   let imported=0,duplicate=0,rejected=0;
   for(let offset=0;offset<records.length;offset+=500){
    const result=await operationsCall('recommendation_import_legacy',{rows:records.slice(offset,offset+500)});
    imported+=result.imported;duplicate+=result.duplicate;rejected+=result.errors.length;
    for(const error of result.errors)if(errors.length<10)errors.push(error.error);
   }
   setMessage('تم استيراد '+imported+'، موجود سابقًا '+duplicate+'، مرفوض '+rejected+'. '+(errors.length?'ملاحظات: '+errors.slice(0,10).join(' | '):'النسخة القديمة باقية دون حذف.'));
  }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="border rounded p-4 space-y-2"><h2 className="font-bold">قرارات الواجهة القديمة على هذا الجهاز</h2><p>القرارات الجديدة تحفظ في القاعدة وتدخل النسخ الاحتياطي. استيراد القديم اختياري للمدير، ولا يعتبر دليلًا على حركة مخزون أو هوية المؤلف القديم.</p><button className="border rounded p-2" disabled={busy} onClick={importOld}>{busy?'جارٍ الاستيراد...':'استيراد القرارات القديمة'}</button>{message&&<p role="status">{message}</p>}</section>;
}
