import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api,tokenStore } from '@/integrations/desktop/client';
import {hasPermission} from '../../../shared/accessPolicy';

export default function Backup(){
  const {roles,access}=useAuth();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[confirmation,setConfirmation]=useState(''),[restoring,setRestoring]=useState(false);
  if(!hasPermission(roles,access,'backup.export')&&!hasPermission(roles,access,'backup.restore'))return <div className="p-6" dir="rtl">النسخ الاحتياطي غير مسموح لهذا الحساب.</div>;
  return <div className="p-6 space-y-5" dir="rtl">
    <h1 className="text-2xl font-bold">النسخ الاحتياطي</h1>
    {hasPermission(roles,access,'backup.export')&&<section className="border rounded-lg p-5 space-y-3">
      <h2 className="font-bold">حفظ قاعدة بيانات هذا الجهاز</h2>
      <p>نسخة SQLite تشمل الحسابات المحلية والفروع والأرصدة والتقارير المقدمة والطلبات وسجل المراجعة. ليست مجرد تقرير Excel.</p>
      <button className="border rounded px-4 py-2 bg-primary text-primary-foreground" disabled={busy} onClick={async()=>{
        setBusy(true);setError('');setSaved('');
        try{const result=await api.backup.export({token:tokenStore.get()});if(!result.ok)throw new Error(result.error||'تعذر الحفظ');setSaved(result.path||'تم الحفظ');}
        catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>{busy?'جارٍ حفظ النسخة...':'حفظ نسخة قاعدة البيانات'}</button>
    </section>}
    <p>الملف يحتوي بيانات حساسة وحسابات؛ احفظه في مكان مؤمّن معتمد خارج الجهاز. لا ترفعه إلى GitHub أو خدمة شخصية.</p>
    {hasPermission(roles,access,'backup.restore')&&<section className="border rounded-lg p-5 space-y-3">
      <h2 className="font-bold">استرجاع نسخة كاملة وإعادة التشغيل</h2>
      <p>سيستبدل كل أرصدة وحسابات هذا الجهاز. يفحص الملف أولًا، ويحتفظ بنسخة أمان، ثم يستبدل القاعدة بعد غلقها عند إعادة التشغيل. ستحتاج حسابًا وكلمة مرور من النسخة المسترجعة.</p>
      <label className="block">اكتب «استرجاع» للتأكيد<input className="border rounded p-2 mx-2" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
      <button className="border rounded px-4 py-2" disabled={busy||restoring||confirmation!=='استرجاع'} onClick={async()=>{
        setRestoring(true);setError('');setSaved('');
        try{const result=await api.backup.restore({token:tokenStore.get(),confirm:true});if(!result.ok)throw new Error(result.error||'تعذر الاسترجاع');setSaved('تم تجهيز النسخة؛ سيغلق البرنامج ويعاد فتحه لاستكمال الاسترجاع.');}
        catch(e){setError((e as Error).message);setRestoring(false);}
      }}>{restoring?'جارٍ التحضير وإعادة التشغيل...':'اختيار نسخة واسترجاعها'}</button>
    </section>}
    {error&&<p role="alert">{error}</p>}
    {saved&&<div role="status"><bdi>{saved}</bdi></div>}
    <p>الملفات الأصلية خارج قاعدة البيانات لا تشملها هذه النسخة. جرب الاسترجاع أولًا على جهاز اختبار، وليس على قاعدة المستشفى الوحيدة.</p>
  </div>;
}
