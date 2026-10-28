import { dateRangeDays,monthDays,todayISO,type ReportDates } from '../inventoryHistory';

export default function ReportPeriodFields({month,kind,value,onChange,allowReceived=false}:{month:string;kind:string;value:ReportDates;onChange:(value:ReportDates)=>void;allowReceived?:boolean}){
  const consumption=kind==='monthly'||kind==='period_consumption';
  const patch=(key:keyof ReportDates,next:string)=>onChange({...value,[key]:next||null});
  return <div className="border rounded-lg p-3 space-y-3" dir="rtl">
    {kind!=='period_consumption'&&<label className="block">الرصيد في أي وقت من اليوم؟<select className="border rounded p-2 w-full bg-background" value={value.snapshot_boundary||'end_of_day'} onChange={e=>patch('snapshot_boundary',e.target.value)}>
      <option value="end_of_day">نهاية اليوم: يشمل كل حركات يوم الرصيد</option>
      <option value="start_of_day">بداية اليوم: قبل حركات يوم الرصيد</option>
    </select><span className="text-xs text-muted-foreground">الاختيار يحدد الحركات التي يشملها الرصيد، وليس وقت رفع الملف.</span></label>}
    {consumption&&<>
      <div className="grid md:grid-cols-2 gap-3">
        <label>المنصرف من يوم<input className="border rounded p-2 w-full bg-background" type="date" max={todayISO()} value={value.issued_from||''} onChange={e=>patch('issued_from',e.target.value)}/></label>
        <label>المنصرف إلى يوم شاملًا<input className="border rounded p-2 w-full bg-background" type="date" max={todayISO()} value={value.issued_to||''} onChange={e=>patch('issued_to',e.target.value)}/></label>
      </div>
      <div className="flex gap-3 flex-wrap text-sm"><button type="button" className="underline" disabled={!monthDays(month)} onClick={()=>{
        const end=month.slice(0,7)+'-'+String(monthDays(month)).padStart(2,'0');
        onChange({...value,issued_from:month,issued_to:end>todayISO()?todayISO():end});
      }}>استخدام الشهر المختار حتى آخر يوم متاح</button><span>عدد أيام المنصرف: {dateRangeDays(value.issued_from||'',value.issued_to||'')||'غير محدد'}</span></div>
    </>}
    {allowReceived&&<details><summary>الملف يحتوي على وارد: تحديد فترته</summary><div className="grid md:grid-cols-2 gap-3 mt-2">
      <label>الوارد من يوم<input className="border rounded p-2 w-full bg-background" type="date" max={todayISO()} value={value.received_from||''} onChange={e=>patch('received_from',e.target.value)}/></label>
      <label>الوارد إلى يوم شاملًا<input className="border rounded p-2 w-full bg-background" type="date" max={todayISO()} value={value.received_to||''} onChange={e=>patch('received_to',e.target.value)}/></label>
    </div></details>}
    <p className="text-xs text-muted-foreground">{consumption?'المنصرف يمكن أن يخص جزءًا من الشهر الحالي. تاريخ الرصيد مستقل، والتحديث التراكمي الأوسع لا يُجمع مع الفترة التي يغطيها.':'تحديث رصيد فقط؛ لا يضيف منصرفًا جديدًا.'}</p>
  </div>;
}
