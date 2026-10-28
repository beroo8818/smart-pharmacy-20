import { workflowsForRoles } from "../operations";
import {hasPermission,type AccessProfile} from '../accessPolicy';
export default function WorkflowGuide({roles=[],access}:{roles?:string[];access?:AccessProfile|null}) {
  const manager=hasPermission(roles,access,'users.manage');
  return <div className="p-6 space-y-5 max-w-[1200px]" dir="rtl"><h1 className="text-2xl font-bold">دليل التشغيل خطوة بخطوة</h1>
    {hasPermission(roles,access,'report.print')&&<button className="border rounded px-4 py-2 print:hidden" onClick={() => window.print()}>طباعة دليل التشغيل</button>}
    {manager?<p className="border rounded p-4">تعليمات المدير فقط: تشغيل الشبكة يحتاج قاعدة مركزية وموافقة المستشفى. الديسكتوب المحلي لا يتزامن تلقائيًا، ولا تشارك ملف SQLite بين الأجهزة. راجع الصلاحيات والنطاق قبل تسليم حساب الموظف.</p>:<p className="border rounded p-4">الدليل يعرض الوظائف المسموحة لحسابك. تأكد من الصيدليات المتاحة ولا تشارك حسابك أو كلمة مروره.</p>}
    {workflowsForRoles(roles,access).map((flow) => <section key={flow.title} className="border rounded-lg p-5 space-y-3 break-inside-avoid"><h2 className="text-xl font-bold">{flow.title}</h2><ol className="list-decimal list-inside space-y-3">{flow.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>)}
    <style>{'@media print { aside, nav { display:none !important; } main { overflow:visible !important; } section { break-inside:avoid; } }'}</style>
  </div>;
}
