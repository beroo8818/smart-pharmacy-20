export type OpsRow = { item_code: string; item_name: string; unit: string; balance: number | null; issued: number | null };
export type OpsReport = { id: string; location_id: string; month: string; snapshot_date: string; snapshot_boundary?: string | null; kind: string; rows: OpsRow[]; status: string; note?: string; created_at: string; reviewed_by?: string; issued_from?: string | null; issued_to?: string | null; consumption_only?: boolean };
export type OpsTransfer = { id: string; location_id: string; item_code: string; item_name: string; unit: string; qty: number; status: string; note: string; created_at: string };
export type OpsOverview = { manager: boolean; location_id: string | null; locations: { id: string; name: string; type: string }[]; users: { id: string; name: string; email?: string; assigned_location_id: string | null; roles: string[] }[]; reports: OpsReport[]; transfers: OpsTransfer[] };
export type OpsCall = (action: string, payload?: Record<string, unknown>) => Promise<any>;
export const OPS_STATUS: Record<string, string> = { pending: "قديم غير محفوظ في الأرصدة", approved: "محفوظ", rejected: "ملغى أو مرفوض سابقًا", requested: "طلب جديد", preparing: "جارٍ التجهيز", received: "تم الاستلام" };

export function validateReport(rows: OpsRow[], kind: string) {
  if (!["monthly", "partial_update","period_consumption"].includes(kind)) throw new Error("اختر رصيدًا ومنصرفًا أو تحديث رصيد أو منصرف فترة فقط");
  if (!rows.length || rows.length > 5000) throw new Error("أضف أصنافًا للتقرير (بحد أقصى 5000)");
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.item_code.trim() || !row.item_name.trim() || !row.unit.trim()) throw new Error("الكود والاسم والوحدة مطلوبة");
    const key = row.item_code.trim();
    if (seen.has(key)) throw new Error("كود الصنف مكرر داخل التقرير");
    seen.add(key);
    for (const value of [row.balance, row.issued]) if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error("الكميات لا تكون سالبة أو غير صالحة");
    if (kind !== 'period_consumption' && row.balance == null) throw new Error("الرصيد مطلوب؛ اكتب صفرًا فقط لو الرصيد فعلًا صفر");
    if (kind === 'period_consumption' && row.balance != null) throw new Error("منصرف الفترة فقط لا يسجل رصيدًا جديدًا");
    if (kind !== 'partial_update' && row.issued == null) throw new Error("المنصرف مطلوب في تقرير الاستهلاك");
    if (kind === "partial_update" && row.issued != null) throw new Error("تحديث الرصيد لا يضيف منصرفًا شهريًا");
  }
}

import {hasPermission,type AccessProfile} from './accessPolicy';
export const WORKFLOWS = [
  { audience:['manager'],title:'أول تشغيل: المدير',steps:['عرّف الفروع الموجودة فعلًا من إدارة الفروع؛ العدد غير ثابت على 15.','الحساب الجديد يبدأ بصلاحيات أساسية. من صلاحيات المستخدمين حدد البنود والصيدليات المسموحة، ويمكن اختيار أكثر من صيدلية.','الويب يحتاج حساب الموظف ثم تعيينه، والديسكتوب حساب محلي. قواعد الديسكتوب المستقلة لا تتزامن بين الأجهزة.','ابدأ بتجربة مخزن وصيدليتين، واختبر أن حساب الفرع لا يقرأ فرعًا آخر قبل التعميم.']},
  { audience:['manager','warehouse'],title:'ملف Excel مجمع',steps:['اجمع رصيدًا مؤرخًا ومنصرف فترة واضحة، ولا تعتمد تاريخ الرصيد من اسم الملف.','من رفع البيانات حدد شهر التقرير والمنصرف من يوم إلى يوم، وتاريخ الرصيد وحده: بداية اليوم أو نهايته.','راجع المعاينة والأصناف والوحدات والمواقع ثم احفظ مباشرة؛ لا يوجد انتظار اعتماد.','الملف المطابق لا يضاف مرة ثانية. التصحيح يحتاج تأكيدًا واضحًا ويحتفظ بالتاريخ السابق.']},
  { audience:['manager','branch'],title:'بداية الشهر: تحديث الصيدلية',steps:['افتح صيدليتي، وتأكد من اسم الفرع المعيّن لحسابك.','اختر رصيدًا ومنصرف فترة، مثل منصرف سبتمبر 1-30 ورصيد أول أكتوبر؛ التاريخان مستقلان.','ارفع Excel أو حمّل القالب ثم املأه. راجع مطابقة الكود والوحدة والأخطاء قبل استخدام بيانات الملف.','اضغط حفظ التحديث مباشرة؛ يظهر في التحليل بعد الحفظ، وليس بعد اعتماد شخص آخر.','الفراغ ليس صفرًا. لا تسجل رصيدًا صفرًا إلا لو تم عده فعلًا.']},
  { audience:['manager','branch'],title:'يوم 15: الأصناف الحرجة',steps:['لو معك جرد فقط، اختر تحديث رصيد فقط وارفع الأصناف التي تم عدّها. الغائب يحتفظ بآخر رصيد له.','لو معك منصرف نصف شهر فقط، اختر منصرف فترة فقط، وحدد 1-15؛ لن يغير آخر رصيد فعلي.','لو معك رصيد ومنصرف فترة اختر النوع الأول، وحدد تاريخ الرصيد وحد اليوم مستقلًا عن أيام المنصرف.','احفظ مباشرة بعد المعاينة. تحديث مرتين في الشهر ليس ضمانًا أن الصنف لن ينفد بين التحديثين.']},
  { audience:['manager','branch'],title:'يوم 25: تحديث تراكمي أم فترة جديدة؟',steps:['تقرير 1-25 تراكمي يشمل 1-15؛ لا تجمع الكميتين. أكد التصحيح بعد مراجعة المعاينة.','تقرير 16-25 مستقل يضاف إلى 1-15. المتوسط يحسب على مجموع الأيام الفعلية.','تداخل 10-25 مع 1-15 غير قابل للفصل من الإجماليين؛ الحفظ يتوقف. صحح النطاق أو ارفع تقريرًا تراكميًا يغطي السابق بالكامل.','لتصحيح جزء داخل تقرير تراكمي سابق، أعد الفترة التراكمية كاملة، لا ترفع جزءًا أضيق كأنه بديل لها.']},
  { audience:['manager','branch','warehouse'],title:'طلب صنف وتحويل',steps:['الصيدلية تسجل طلبًا بالكود والوحدة والكمية وسبب الاحتياج.','مسؤول المخزن أو المدير يبدأ التجهيز مباشرة بعد التحقق من المصدر والرصيد والصلاحية؛ لا توجد مرحلة اعتماد منفصلة.','بعد التسليم، مسؤول مخول يسجل حركة التحويل مرة واحدة برقم المستند. حالة الطلب وحدها لا تخصم أو تضيف مخزونًا.','المستلم يؤكد الاستلام الفعلي مع رقم المستند. لا تسجل نفس التسليم مرة أخرى كوارد يدوي.','لو رصيد أحد الطرفين غير مسجل، تظهر الحركة وصافيها لكن الرصيد غير مؤكد؛ يلزم تحديث رصيد فعلي.']},
  { audience:['manager','branch','warehouse','viewer'],title:'قراءة التقارير والتغطية',steps:['افتح مركز التقارير وحدد نوع التقرير والصنف والفترة أو النطاق المتاح لحسابك.','تقارير المستشفى أقل من 30 والمخزن أقل من 30 أو 14 لها اختيارات مستقلة. بيانات غير كافية ليست حالة آمنة.','منصرف المستشفى يجمع الفروع فقط؛ صرف المخزن للفروع لا يحسب استهلاكًا مرة أخرى.','المسجل غير المتوقع: افتح تفاصيل الصنف لمقارنة الرصيد والتغطية المسجلين بالتقدير.','صدر CSV لفتحه في Excel أو اطبع التقرير مع تواريخ الأرصدة والوحدات وجودة البيانات.']},
  { audience:['manager'],title:'آخر الشهر والنسخ الاحتياطي',steps:['راجع الصيدليات المتأخرة في التحديث والطلبات غير المستلمة؛ لا تنتظر قائمة اعتماد تقارير جديدة.','التقارير القديمة المعلقة تظل في السجل ولا تدخل الأرصدة تلقائيًا. تحقق من الفترة وأعد رفعها كتحديث جديد عند الحاجة.','طابق عينة بالجرد، وسجل تصحيحًا موثقًا بدل حذف التاريخ.','خذ نسخة قاعدة كاملة. في نسخة الديسكتوب المستقلة، اكتب استرجاع من النسخ الاحتياطي واختر الملف وراجع التأكيد؛ يستكمل الاستبدال بعد إعادة التشغيل وتبقى نسخة أمان. اختبر على بيانات منفصلة أولًا. تصدير الويب ليس نسخة قاعدة كاملة.','لا تشارك حساب المدير. لا تمنح كل البنود لموظف إلا بعد مراجعة الحاجة والنطاق.']},
  {audience:['manager'],title:'تعيين صلاحيات الموظف',steps:['افتح صلاحيات المستخدمين واختر الموظف، وليس حسابك الحالي أو مدير النظام المحمي.','اضغط صلاحيات أساسية لنقطة بداية محدودة، ثم علم على الشاشات وإجراءات الحفظ المسموحة.','حدد صيدلية أو أكثر. اختيار كل الصيدليات الحالية والجديدة مختلف عن اختيار أسماء محددة.','احفظ بعد مراجعة البنود. البنود الحساسة يمنحها مدير النظام فقط، ولا يمكن منح صلاحية أوسع من صلاحية المانح.']},
  {audience:['manager','warehouse','branch','viewer'],title:'كشف الصيدليات المتأخرة',steps:['افتح متابعة تحديث الصيدليات. كل موقع مسجل يظهر حتى لو لم يرفع ملفًا مطلقًا.','الافتراضي 35 يومًا لعمر التقرير الكامل، ويمكن تغيير الحد للعرض. التحديث الجزئي لا يثبت اكتمال بقية الأصناف.','راجع آخر تقرير كامل وآخر رصيد جزئي وآخر فترة منصرف لكل موقع.','في تقرير المستشفى يظهر تحذير عند التأخير أو غياب التقارير، ولا تعتبر أيام التغطية مؤكدة وقت نقص المصادر.']},
  {audience:['manager','warehouse'],title:'منصرف فعلي لفترة محددة',steps:['من سجل الحركات اختر منصرف من الصيدلية، وحدد الصنف والوحدة والصيدلية والكمية ورقم المستند.','حدد منصرف فعلي من يوم وإلى يوم شاملًا؛ هذه الكمية إجمالي هذه الأيام، وليست كمية كل يوم.','الفترة المتداخلة مع حركة منصرف أخرى تتوقف. الفترة التي تعبر رصيد جرد لا يمكن توزيع إجماليها تلقائيًا؛ يلزم تصحيح المصدر.','التوقع يخصم فقط الأيام غير المغطاة بالمنصرف الفعلي. الحركات القديمة التي لا تعرف أيامها تظل محافظة ولا يضاف لها خصم تقديري كامل.']},
];
export function workflowsForRoles(roles:string[],access?:AccessProfile|null){
  if(access?.configured){
    const has=(key:string)=>hasPermission(roles,access,key);
    const allowed=[has('users.manage'),has('data.upload')&&has('screen.upload'),has('data.upload')&&has('screen.my-pharmacy'),has('data.upload')&&has('screen.my-pharmacy'),has('data.upload')&&has('screen.my-pharmacy'),['requests.create','requests.prepare','requests.receive','stock.transfer'].some(has),has('screen.report-center'),has('backup.export'),has('permissions.manage'),has('screen.data-freshness'),has('stock.issue')&&has('screen.stock-transactions')];
    return WORKFLOWS.filter((_,i)=>allowed[i]).map(flow=>({...flow,steps:flow.title==='طلب صنف وتحويل'?flow.steps.filter((_,i)=>[has('requests.create'),has('requests.prepare'),has('stock.transfer'),has('requests.receive'),true][i]):flow.title==='قراءة التقارير والتغطية'?flow.steps.filter((_,i)=>i!==4||has('report.export')||has('report.print')):flow.steps}));
  }
  const audience=roles.some(r=>['system_admin','pharmacy_manager'].includes(r))?'manager':roles.includes('warehouse_keeper')?'warehouse':roles.includes('sub_pharmacist')?'branch':'viewer';
  return WORKFLOWS.filter(flow=>flow.audience.includes(audience));
}
