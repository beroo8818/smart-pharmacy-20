export const NAVIGATION_GROUPS = [
 {id:'work',label:'الشغل اليومي',administrative:false,items:[
  ['/home','مركز التشغيل','Compass'],['/my-pharmacy','صيدليتي والتحديثات','Pill'],['/daily','مركز العمل اليومي','Target'],['/upload','رفع البيانات','Upload'],['/stock-transactions','سجل الحركات اليومية','Activity'],['/transfers','التحويلات المقترحة','ArrowLeftRight'],['/alerts','التنبيهات','Bell'],['/what-to-do','ماذا أفعل الآن؟','Compass'],
 ]},
 {id:'reports',label:'المتابعة والتقارير',administrative:false,items:[
  ['/dashboard','اللوحة الرئيسية','LayoutDashboard'],['/report-center','مركز التقارير','FileBarChart'],['/consumption','منصرف المستشفى','Pill'],['/items','تحليل الأصناف','Pill'],['/data-freshness','متابعة تحديث الصيدليات','History'],['/actions-log','سجل الإجراءات','History'],['/reports','التقارير المتقدمة','FileBarChart'],['/reports/compare','مقارنة شهر بشهر','GitCompare'],['/assistant','مساعد المخزون','Sparkles'],
 ]},
 {id:'data',label:'إدارة البيانات',administrative:true,items:[
  ['/data-sources','مصادر البيانات والتحديثات','Database'],['/google-sync','استيراد Google Sheet / CSV','Cloud'],['/data-review','مراجعة البيانات','ShieldAlert'],['/dictionary','قاموس الأصناف','BookOpen'],['/active-ingredients','قاموس المواد الفعالة','FlaskConical'],
 ]},
 {id:'admin',label:'الإدارة والحساب',administrative:true,items:[
  ['/branch-access','إدارة الفروع والمستخدمين','Settings'],['/permissions','صلاحيات المستخدمين','Settings'],['/backup','النسخ الاحتياطي والاسترجاع','HardDriveDownload'],['/settings','الإعدادات','Settings'],['/account','كلمة مرور حسابي','KeyRound'],['/workflows','دليل التشغيل خطوة بخطوة','HelpCircle'],['/help','مساعدة','HelpCircle'],
 ]},
] as const;
