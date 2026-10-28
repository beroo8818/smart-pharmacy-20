type Row = { key:string;locationName:string;unit?:string|null;hasBalance:boolean;recordedBalance:number;projectedBalance:number;
  recordedDays:number|null;projectedDays:number|null;ledgerNet:number;ledgerWarnings:string[];projectionSuppressed:boolean;snapshotDate:string;snapshotBoundary:string|null };
const number=(value:number)=>value.toLocaleString('ar-EG',{maximumFractionDigits:1});
export default function StockCalculationReview({rows}:{rows:Row[]}){
  return <section className="border rounded p-4 my-4 space-y-3" dir="rtl"><h2 className="font-bold">الرصيد المسجل والتوقع: حسابان منفصلان</h2>
    <p className="text-sm">المسجل = آخر رصيد فعلي + الحركات اللاحقة. المتوقع تقدير للاستهلاك وليس جردًا مؤكدًا. لا تخصم كميات المنصرف الموجودة في ملف الرصيد مرة أخرى.</p>
    <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['الموقع','مرجع الرصيد','الرصيد المسجل','الرصيد المتوقع','تغطية مسجلة (يوم)','تغطية متوقعة (يوم)','مراجعة الحساب'].map(t=><th className="p-2 text-right border-b" key={t}>{t}</th>)}</tr></thead>
      <tbody>{rows.map(r=><tr key={r.key}>
        <td className="p-2 border-b">{r.locationName} ({r.unit||'وحدة غير مؤكدة'})</td>
        <td className="p-2 border-b">{r.snapshotDate||'لا يوجد رصيد أساسي'} {r.snapshotDate&&(r.snapshotBoundary==='start_of_day'?'بداية اليوم':r.snapshotBoundary==='end_of_day'?'نهاية اليوم':'حد اليوم غير محدد')}</td>
        <td className="p-2 border-b">{r.hasBalance?number(r.recordedBalance):'غير مؤكد'}</td>
        <td className="p-2 border-b">{r.hasBalance?number(r.projectedBalance):'غير متاح'}</td>
        <td className="p-2 border-b">{r.recordedDays==null?'بيانات غير كافية':number(r.recordedDays)}</td>
        <td className="p-2 border-b">{r.projectedDays==null?'بيانات غير كافية':number(r.projectedDays)}</td>
        <td className="p-2 border-b">{r.ledgerWarnings?.length?r.ledgerWarnings.join('؛ '):r.projectionSuppressed?'تقدير الاستهلاك متوقف لوجود منصرف فعلي؛ لا يمكن افتراض أيام تغطيته':'التوقع للمراجعة؛ لا يغير الرصيد المسجل'}{!r.hasBalance&&<div>صافي الحركات المقروءة فقط: {number(r.ledgerNet||0)}</div>}</td>
      </tr>)}</tbody></table></div>
  </section>;
}
