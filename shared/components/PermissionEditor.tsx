import {useEffect,useState} from 'react';
import {PERMISSIONS,basicPermissions,type AccessProfile} from '../accessPolicy';
import type {OpsCall} from '../operations';
type Overview={actor_id:string;actor_role:string;access:AccessProfile;users:{id:string;name:string;role:string;access:AccessProfile}[];locations:{id:string;name:string}[]};
export default function PermissionEditor({call}:{call:OpsCall}){
 const [data,setData]=useState<Overview|null>(null),[target,setTarget]=useState(''),[permissions,setPermissions]=useState<string[]>([]),[ids,setIds]=useState<string[]>([]),[all,setAll]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const reload=async()=>{const result=await call('access_overview');setData(result);return result;};
 useEffect(()=>{reload().catch(e=>setError(e.message));},[call]);
 useEffect(()=>{const value=data?.users.find(u=>u.id===target)?.access;setPermissions(value?.permissions||[]);setIds(value?.location_ids||[]);setAll(value?.all_branches||false);setMessage('');},[data,target]);
 const editable=(key:string)=>!!data&&(data.actor_role==='system_admin'||data.access.permissions.includes(key)&&!PERMISSIONS.find(p=>p.key===key)?.sensitive);
 const user=data?.users.find(u=>u.id===target),protectedUser=!user||user.id===data?.actor_id||user.role==='system_admin'||user.role==='pharmacy_manager'&&data?.actor_role!=='system_admin';
 const toggle=(key:string)=>setPermissions(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key]);
 return <div className="p-6 space-y-5" dir="rtl"><h1 className="text-2xl font-bold">صلاحيات المستخدمين</h1><p>الصلاحيات الأساسية نقطة بداية، ويمكن إضافة أو إلغاء البنود لكل موظف. الشاشات منفصلة عن إجراءات الحفظ وعن نطاق الصيدليات. حساب مدير النظام محمي من الإغلاق العرضي.</p>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {!data?<p>جارٍ تحميل الصلاحيات؛ يلزم تطبيق ترقية الخادم في نسخة الويب.</p>:<>
 <label>المستخدم<select className="border rounded p-2 w-full" value={target} onChange={e=>setTarget(e.target.value)}><option value="">اختر المستخدم</option>{data.users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></label>
 {user&&<><p>{user.access.configured?'صلاحيات مخصصة محفوظة':'حساب قديم يعمل بصلاحيات دوره الحالية؛ لن تتغير إلا عند الحفظ الصريح'}.</p>
 {protectedUser&&<p>هذا الحساب محمي أو هو حسابك الحالي؛ اختر موظفًا آخر.</p>}
 <fieldset disabled={busy||protectedUser} className="space-y-4">
 <div className="flex gap-3 flex-wrap"><button className="border p-2" onClick={()=>setPermissions(PERMISSIONS.filter(p=>editable(p.key)).map(p=>p.key))}>تحديد كل البنود المسموح لي بمنحها</button><button className="border p-2" onClick={()=>setPermissions([])}>إلغاء الكل</button><button className="border p-2" onClick={()=>{setPermissions(basicPermissions().filter(editable));setAll(false);}}>صلاحيات أساسية</button></div>
 <p>البنود الحساسة مثل إدارة الصلاحيات والنسخ والاسترجاع يمنحها مدير النظام فقط. النسخة الكاملة تحتاج نطاق كل المواقع وليست نسخة فرع واحد. لا يمكنك منح صلاحية أو صيدلية خارج نطاقك.</p>
 {['الشاشات','الإجراءات والبيانات'].map((group,index)=><section className="border rounded p-4 space-y-2" key={group}><h2 className="font-bold">{group}</h2><div className="grid md:grid-cols-2 gap-3">{PERMISSIONS.filter(p=>p.key.startsWith('screen.')===(index===0)).map(p=><label key={p.key}><input type="checkbox" checked={permissions.includes(p.key)} disabled={!editable(p.key)} onChange={()=>toggle(p.key)}/> {p.label}</label>)}</div></section>)}
 <section className="border rounded p-4 space-y-3"><h2 className="font-bold">الصيدليات المسموحة</h2><label><input type="checkbox" checked={all} disabled={!data.access.all_branches&&data.actor_role!=='system_admin'} onChange={e=>setAll(e.target.checked)}/> كل الصيدليات الحالية والجديدة</label><p>لو اخترت صيدليات محددة، الصيدليات الجديدة لا تضاف لهذا المستخدم تلقائيًا.</p><div className="grid md:grid-cols-2 gap-2">{data.locations.map(l=><label key={l.id}><input type="checkbox" checked={ids.includes(l.id)} disabled={all} onChange={()=>setIds(old=>old.includes(l.id)?old.filter(id=>id!==l.id):[...old,l.id])}/> {l.name}</label>)}</div></section>
 <button className="border rounded p-3" onClick={async()=>{if(!confirm('حفظ صلاحيات '+user.name+' ونطاق صيدلياته؟'))return;setBusy(true);setError('');try{await call('access_save',{user_id:target,permissions,location_ids:ids,all_branches:all});await reload();setMessage('تم حفظ الصلاحيات. قيود الخادم تطبق فورًا، وتحدث الواجهة عند العودة للنافذة أو خلال دقيقة.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>حفظ الصلاحيات</button>
 </fieldset></>}
 </>}
 </div>;
}
