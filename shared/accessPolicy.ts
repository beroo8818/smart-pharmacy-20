import catalog from './permissionCatalog.json';
export const PERMISSIONS=catalog;
export type AccessProfile={configured:boolean;permissions:string[];location_ids:string[];all_branches:boolean};
export function defaultPermissions(roles:string[]){
  if(roles.includes('system_admin'))return catalog.map(x=>x.key);
  const groups=roles.includes('pharmacy_manager')?['read','branch','staff','manager']:roles.includes('warehouse_keeper')?['read','branch','staff']:roles.includes('sub_pharmacist')?['branch']:roles.includes('viewer')?['read']:[];
  return catalog.filter(x=>x.groups.some(group=>groups.includes(group))).map(x=>x.key);
}
export const basicPermissions=()=>defaultPermissions(['sub_pharmacist']);
export const stockPermission:Record<string,string>={warehouse_receipt:'stock.receipt',pharmacy_issue:'stock.issue',warehouse_issue_to_pharmacy:'stock.transfer',pharmacy_transfer:'stock.transfer',warehouse_return:'stock.return',pharmacy_return_to_warehouse:'stock.return'};
export function hasPermission(roles:string[],access:AccessProfile|null|undefined,key:string){
  return roles.includes('system_admin')||(access?access.permissions:defaultPermissions(roles)).includes(key);
}
export function accessPage(roles:string[],path:string,access:AccessProfile){
  if(path==='/account')return roles.length>0;
  const entry=catalog.filter(x=>'path'in x&&(path===x.path||path.startsWith(x.path+'/'))).sort((a,b)=>(('path'in b?b.path:'')?.length||0)-(('path'in a?a.path:'')?.length||0))[0];
  return !!entry&&hasPermission(roles,access,entry.key);
}
