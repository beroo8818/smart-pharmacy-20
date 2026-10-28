import {dateRangeDays, todayISO, validISODate} from './inventoryHistory';
export type ReportingLocation={id:string;name:string;type:string;last_balance:string|null;last_full_balance:string|null;last_consumption:string|null;last_partial_balance?:string|null};
export function reportingFreshness(locations:ReportingLocation[],maxAge=35,asOf=todayISO()){
  return locations.map(location=>{
    const date=location.last_full_balance;
    const age=date&&validISODate(date)&&date<=asOf?dateRangeDays(date,asOf)-1:null;
    return {...location,age,state:age==null?'لم يقدم تقرير رصيد كامل':age>maxAge?'متأخر':'داخل المدة',late:age==null||age>maxAge};
  }).sort((a,b)=>Number(b.late)-Number(a.late)||(b.age??Infinity)-(a.age??Infinity)||a.name.localeCompare(b.name,'ar'));
}
