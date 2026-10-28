function valid(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
}
function normalizeDates(month,snapshot,kind,dates={},today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date())){
  if(!valid(month)||!month.endsWith('-01')||month>today.slice(0,7)+'-01'||!valid(snapshot)||snapshot>today)throw new Error('شهر التقرير أو تاريخ الرصيد غير صالح أو مستقبلي');
  const out={issued_from:null,issued_to:null,received_from:null,received_to:null};
  if(kind!=='period_consumption'&&dates.snapshot_boundary!=null){
    if(!['start_of_day','end_of_day'].includes(dates.snapshot_boundary))throw new Error('اختر الرصيد في بداية اليوم أو نهايته');
    out.snapshot_boundary=dates.snapshot_boundary;
  }
  for(const prefix of ['issued','received']){
    if(prefix==='issued'&&!['monthly','period_consumption'].includes(kind))continue;
    const from=dates[prefix+'_from']||null,to=dates[prefix+'_to']||null;
    if(!from&&!to){
      if(prefix==='issued'&&month>=today.slice(0,7)+'-01')throw new Error('حدد المنصرف من يوم إلى يوم للشهر الحالي');
      continue;
    }
    if(!valid(from)||!valid(to)||from>to||to>today||from.slice(0,7)!==month.slice(0,7)||to.slice(0,7)!==month.slice(0,7))throw new Error('فترة '+(prefix==='issued'?'المنصرف':'الوارد')+' غير صالحة؛ داخل الشهر المختار وحتى اليوم');
    out[prefix+'_from']=from;out[prefix+'_to']=to;
  }
  return out;
}
function effectiveRange(batch){
  if(!['monthly','period_consumption'].includes(batch.batch_kind||'monthly'))return null;
  const from=batch.issued_from||batch.month;
  const to=batch.issued_to||new Date(Date.UTC(+batch.month.slice(0,4),+batch.month.slice(5,7),0)).toISOString().slice(0,10);
  return {from,to};
}
function crosses(a,b){return a.from<=b.to&&b.from<=a.to&&!(a.from<=b.from&&a.to>=b.to)&&!(b.from<=a.from&&b.to>=a.to);}
module.exports={normalizeDates,effectiveRange,crosses};
