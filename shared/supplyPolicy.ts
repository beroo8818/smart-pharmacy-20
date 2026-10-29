// Distribution constraints must not be counted again as a hospital-wide supply shortage.
export function hospitalPurchaseQuantity(balance:number,branchDailyDemand:number,targetDays:number):number|null{
 if(![balance,branchDailyDemand,targetDays].every(Number.isFinite)||balance<0||branchDailyDemand<0||targetDays<=0)return null;
 return Math.max(0,Math.ceil(branchDailyDemand*targetDays-balance));
}
