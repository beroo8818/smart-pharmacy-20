import {hasPermission,type AccessProfile} from '../accessPolicy';
export default function SettingsOverview({roles,access,name,local=false}:{roles:string[];access?:AccessProfile|null;name:string;local?:boolean}){
 const link=(path:string)=>(local?'#':'')+path;
 const items=[['screen.branch-access','/branch-access','إدارة الفروع وحسابات الموظفين'],['screen.permissions','/permissions','بنود الصلاحيات والصيدليات المسموحة'],['screen.data-freshness','/data-freshness','متابعة الصيدليات المتأخرة'],['screen.backup','/backup','النسخ الاحتياطي والتصدير']];
 return <div className="p-6 space-y-5" dir="rtl"><h1 className="text-2xl font-bold">الإعدادات وإدارة الحساب</h1><p>الحساب: {name} | {local?'قاعدة محلية على هذا الجهاز، لا اتصال تلقائي بقاعدة الويب':'قاعدة الويب، تخضع لصلاحيات الخادم'}.</p><p>{access?.configured?'صلاحيات مخصصة لهذا الحساب':'حساب قديم بصلاحيات دوره الحالية؛ لا تتغير دون حفظ صريح من المدير'}.</p>
 <div className="grid md:grid-cols-2 gap-3">{items.filter(([key])=>hasPermission(roles,access,key)).map(([,path,label])=><a className="border rounded p-4 underline" href={link(path)} key={path}>{label}</a>)}<a className="border rounded p-4 underline" href={link('/account')}>تغيير كلمة مرور حسابي</a></div>
 <section className="border rounded p-4 space-y-2"><h2 className="font-bold">كيف تحسب التغطية؟</h2><p>المتوسط اليومي من منصرف الفترات المسجلة وعدد أيامها الفعلي. تغطية الرصيد = الرصيد المستخدم ÷ المتوسط اليومي. المسجل والمتوقع حسابان منفصلان، والتحويل الداخلي لا يعد استهلاكًا نهائيًا.</p><p>لا توجد مهلة توريد خارجي مؤكدة مفترضة. تصدير Excel ليس نسخة استرجاع كاملة لقاعدة الويب. لا تشارك SQLite على مجلد شبكي.</p></section>
 {!local&&roles.includes('system_admin')&&<a className="underline" href="/settings/legacy-roles">إدارة الأدوار القديمة، لمدير النظام فقط</a>}
 </div>;
}
