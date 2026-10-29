const formats=new Map<number,Intl.NumberFormat>();
export function formatNumber(value:number,digits=0){
  let format=formats.get(digits);
  if(!format){format=new Intl.NumberFormat('ar-EG',{maximumFractionDigits:digits,minimumFractionDigits:digits});formats.set(digits,format);}
  return format.format(value);
}
