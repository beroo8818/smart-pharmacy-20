const path=require('path'),fs=require('fs');
const packagedCatalog=path.join(__dirname,'..','permissionCatalog.json');
const catalog=require(fs.existsSync(packagedCatalog)?packagedCatalog:'../../../shared/permissionCatalog.json');
const {getDb}=require('../db/sqlite.cjs');
function defaults(role){
 const groups=role==='system_admin'?['read','branch','staff','manager','admin']:role==='pharmacy_manager'?['read','branch','staff','manager']:role==='warehouse_keeper'?['read','branch','staff']:role==='sub_pharmacist'?['branch']:role==='viewer'?['read']:[];
 return catalog.filter(x=>x.groups.some(g=>groups.includes(g))).map(x=>x.key);
}
function profile(user){
 const row=getDb().prepare('SELECT * FROM user_access_profiles WHERE user_id=?').get(user.id);
 if(row)return {configured:true,permissions:JSON.parse(row.permissions),location_ids:JSON.parse(row.location_ids),all_branches:!!row.all_branches};
 const role=user.assigned_location_id?'sub_pharmacist':user.role;
 return {configured:false,permissions:defaults(role),location_ids:user.assigned_location_id?[user.assigned_location_id]:[],all_branches:role!=='sub_pharmacist'};
}
const has=(user,key)=>user.role==='system_admin'||profile(user).permissions.includes(key);
function allowed(user,name,type){
 const p=profile(user);if(user.role==='system_admin')return true;
 if(['main_store','main_warehouse'].includes(type))return p.permissions.includes('data.warehouse');
 if(!p.permissions.includes('data.branches'))return false;
 const loc=getDb().prepare("SELECT id FROM locations WHERE name=? AND type='sub_pharmacy' AND active=1").get(name||'');
 return !!loc&&(p.all_branches||p.location_ids.includes(loc.id));
}
function demand(user,key){if(!has(user,key))throw new Error('صلاحية غير مسموحة: '+key);}
function save(actor,targetId,input){
 demand(actor,'permissions.manage');
 const db=getDb(),target=db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(targetId||'');
 if(!target||target.id===actor.id||target.role==='system_admin'||(target.role==='pharmacy_manager'&&actor.role!=='system_admin'))throw new Error('لا تعدل حسابك أو حساب مدير محمي من هذه الشاشة');
 if(!Array.isArray(input.permissions)||!Array.isArray(input.location_ids)||typeof input.all_branches!=='boolean')throw new Error('بيانات الصلاحيات غير صالحة');
 const permissions=[...new Set(input.permissions)],ids=[...new Set(input.location_ids)];
 if(permissions.some(key=>!catalog.some(x=>x.key===key)||!has(actor,key)||(actor.role!=='system_admin'&&catalog.find(x=>x.key===key).sensitive)))throw new Error('لا تمنح صلاحية غير معروفة أو أعلى من صلاحيتك؛ البنود الحساسة لمدير النظام');
 const actorScope=profile(actor);
 if(input.all_branches&&!actorScope.all_branches&&actor.role!=='system_admin')throw new Error('لا تمنح نطاق مواقع أوسع من نطاقك');
 for(const id of ids){const l=db.prepare("SELECT * FROM locations WHERE id=? AND active=1 AND type='sub_pharmacy'").get(id);if(!l||!allowed(actor,l.name,l.type))throw new Error('صيدلية خارج النطاق المسموح');}
 db.transaction(()=>{
  db.prepare("INSERT INTO user_access_profiles(user_id,permissions,location_ids,all_branches,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET permissions=excluded.permissions,location_ids=excluded.location_ids,all_branches=excluded.all_branches,updated_by=excluded.updated_by,updated_at=datetime('now')").run(target.id,JSON.stringify(permissions),JSON.stringify(ids),input.all_branches?1:0,actor.id);
  db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES(?,'permissions_changed','users',?,?)").run(actor.id,target.id,JSON.stringify({permissions,location_ids:ids,all_branches:input.all_branches}));
 })();
 return {ok:true};
}
module.exports={defaults,profile,has,allowed,demand,save,catalog};
