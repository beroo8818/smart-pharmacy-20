import { useState } from 'react';
export default function AccountPassword({ save }: { save: (current: string, next: string) => Promise<void> }) {
  const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  return <div className="p-6 max-w-[700px] space-y-4" dir="rtl"><h1 className="text-2xl font-bold">كلمة مرور حسابي</h1><p>غيّر كلمة المرور الأولية ولا تشاركها مع أي شخص. اختر 8 أحرف على الأقل، ولا تستخدم كلمة مرور حساب آخر.</p>
    <form className="border rounded-lg p-5 space-y-3" onSubmit={async(e)=>{ e.preventDefault(); setError('');setMessage('');if(next.length<8||next!==repeat){setError('كلمة المرور لا تقل عن 8 أحرف والتأكيد يجب أن يطابقها');return;}setBusy(true);try{await save(current,next);setCurrent('');setNext('');setRepeat('');setMessage('تم تغيير كلمة المرور');}catch(e){setError((e as Error).message);}finally{setBusy(false);} }}>
      <label className="block">كلمة المرور الحالية<input className="border rounded p-2 block w-full bg-background" autoComplete="current-password" type="password" required value={current} onChange={(e)=>setCurrent(e.target.value)} /></label>
      <label className="block">كلمة المرور الجديدة<input className="border rounded p-2 block w-full bg-background" autoComplete="new-password" type="password" minLength={8} required value={next} onChange={(e)=>setNext(e.target.value)} /></label>
      <label className="block">تأكيد كلمة المرور الجديدة<input className="border rounded p-2 block w-full bg-background" autoComplete="new-password" type="password" minLength={8} required value={repeat} onChange={(e)=>setRepeat(e.target.value)} /></label>
      <button disabled={busy} className="border rounded p-2">حفظ كلمة المرور</button>
    </form>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </div>;
}
