import type {ReportStock} from './operationalReports';
const normalized=(s:string)=>s.toLowerCase().normalize('NFKC').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\u064b-\u065f]/g,'').trim();
const quantity=(n:number)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n);
export function answerStockQuestion(question:string,rows:ReportStock[]){
 if(!rows.length)return 'لا توجد بيانات مخزون متاحة لحسابك. ارفع بيانات أو راجع تعيين الصيدلية.';
 const q=normalized(question),locations=[...new Set(rows.map(r=>r.locationName))].sort((a,b)=>b.length-a.length);
 const location=locations.find(name=>q.includes(normalized(name)));
 const scoped=location?rows.filter(r=>r.locationName===location):rows;
 const safe=(r:ReportStock)=>r.hasBalance&&r.hasConsumption&&!!r.unit&&!r.mixedSnapshots&&!r.ledgerWarnings?.length&&r.days!=null&&Number.isFinite(r.days);
 const matches=(words:string[])=>words.some(w=>q.includes(normalized(w)));
 const unknown=scoped.filter(r=>!safe(r)).length;
 let selected:ReportStock[],title:string;
 if(matches(['ناقص','نقص','حرج','shortage'])){selected=scoped.filter(r=>safe(r)&&r.days!<30);title='تغطية مسجلة أقل من 30 يومًا';}
 else if(matches(['زائد','زيادة','فائض','overstock'])){selected=scoped.filter(r=>safe(r)&&['over','very_over'].includes(r.kind));title='فائض حسب التصنيف الحالي';}
 else if(matches(['راكد','بدون صرف','deadstock'])){selected=scoped.filter(r=>r.hasBalance&&r.hasConsumption&&r.kind==='deadstock');title='أصناف بلا منصرف مسجل في الفترة المتاحة، وليست إثباتًا لعدم الحاجة';}
 else if(matches(['ملخص','عدد','summary']))return 'في النطاق المتاح لحسابك: '+scoped.length+' سجل صنف وموقع. منها '+unknown+' تحتاج مراجعة جودة أو اكتمال. إجمالي المستشفى المعتمد تراجعه من مركز التقارير ومتابعة تحديث الصيدليات.';
 else {selected=scoped.filter(r=>normalized(r.itemName+' '+(r.itemCode||'')).includes(q));title='نتائج البحث في البيانات الحالية';}
 const details=selected.slice(0,25).map(r=>r.itemName+' | '+r.locationName+' | '+(r.unit||'وحدة غير مؤكدة')+' | الرصيد: '+(r.hasBalance?quantity(r.balance):'غير معلوم')+' | التغطية: '+(safe(r)?quantity(r.days!)+' يوم':'غير مؤكدة')).join('\n');
 return title+':\n'+(details||'لم تظهر نتائج مطابقة في البيانات المتاحة، وليس ذلك إثباتًا لاكتمال بيانات المستشفى.')+'\n'+(selected.length>25?'عرض أول 25 من '+selected.length+' نتيجة.\n':'')+'سجلات تحتاج مراجعة بالنطاق: '+unknown+'. راجع مركز التقارير قبل قرار تحويل أو توريد.';
}
