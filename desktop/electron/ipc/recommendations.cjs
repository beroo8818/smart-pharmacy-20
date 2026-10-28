const crypto=require('crypto');
const {getDb}=require('../db/sqlite.cjs');
const rights=require('./rights.cjs');
const states=new Set(['new','approved','rejected','postponed','executed']);
function text(value,required=false,max=2000){
 if(value==null||value===''){if(required)throw new Error('بيان مطلوب في القرار');return null;}
 if(typeof value!=='string'||value.length>max)throw new Error('نص القرار غير صالح');
 const result=value.trim();if(required&&!result)throw new Error('بيان مطلوب في القرار');return result||null;
}
function full(user){return rights.has(user,'data.hospital')&&rights.has(user,'data.branches')&&rights.has(user,'data.warehouse')&&(user.role==='system_admin'||rights.profile(user).all_branches);}
function allowed(user,name){
 if(!name)return true;
 if(name==='المستشفى')return full(user);
 const loc=getDb().prepare('SELECT * FROM locations WHERE name=? AND active=1').all(name);
 return loc.length===1&&rights.allowed(user,name,loc[0].type);
}
function list(user,p={}){
 if(!rights.has(user,'screen.actions-log')&&!rights.has(user,'screen.daily'))throw new Error('سجل القرارات غير مسموح');
 const db=getDb(),names=db.prepare('SELECT name,type FROM locations WHERE active=1').all().filter(l=>rights.allowed(user,l.name,l.type)).map(l=>l.name);
 if(full(user))names.push('المستشفى');
 if(!names.length)return {ok:true,rows:[]};
 const offset=p.offset??0;
 if(!Number.isInteger(offset)||offset<0||offset>1000000)throw new Error('صفحة غير صالحة');
 const placeholders=names.map(()=>'?').join(',');
 const where=(full(user)?'1=1':'(r.from_location IN('+placeholders+') OR r.to_location IN('+placeholders+'))')+(p.batch_id?' AND r.upload_batch_id=?':'');
 const args=full(user)?[]:[...names,...names];if(p.batch_id)args.push(String(p.batch_id));
 const rows=db.prepare("SELECT r.*,coalesce(nullif(u.full_name,''),u.username) actor_name FROM recommendation_actions r LEFT JOIN users u ON u.id=r.acted_by WHERE "+where+' ORDER BY r.acted_at DESC,r.id DESC LIMIT 1000 OFFSET ?').all(...args,offset).map(r=>({...r,match_review_required:!!r.match_review_required,override_unreviewed:!!r.override_unreviewed}));
 return {ok:true,rows};
}
function save(user,p,legacy=false){
 rights.demand(user,'screen.daily');rights.demand(user,'decisions.write');
 if(legacy)rights.demand(user,'users.manage');
 const db=getDb(),batchId=text(p.upload_batch_id,true),batch=db.prepare('SELECT id,status FROM upload_batches WHERE id=?').get(batchId);
 if(!batch||(!legacy&&batch.status!=='saved'))throw new Error('ملف مصدر غير صالح للقرار');
 const from=text(p.from_location,false,200),to=text(p.to_location,true,200);
 if(!allowed(user,from)||!allowed(user,to))throw new Error('موقع القرار خارج الصيدليات المسموحة');
 const status=text(p.status,true,32);
 if(!states.has(status))throw new Error('حالة غير صالحة');
 const quantity=value=>{if(value==null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('كمية قرار غير صالحة');return value;};
 const executed=quantity(p.executed_qty),suggested=quantity(p.suggested_qty);
 if(!legacy&&status==='executed'&&(executed==null||executed<=0))throw new Error('اكتب كمية منفذة موجبة؛ الحالة لا تسجل حركة مخزون');
 const match=!!p.match_review_required,override=!!p.override_unreviewed,reason=text(p.override_reason);
 if(match&&['approved','executed'].includes(status)&&!legacy&&(!override||!reason||!rights.has(user,'dictionary.write')))throw new Error('راجع المطابقة أو اطلب مسؤول القاموس وسجل سبب التجاوز');
 const originalAt=legacy?text(p.original_at,true,50):null;
 if(originalAt&&(!/^\d{4}-\d{2}-\d{2}T/.test(originalAt)||!Number.isFinite(Date.parse(originalAt))||Date.parse(originalAt)>Date.now()+60000))throw new Error('تاريخ السجل القديم غير صالح');
 const row={upload_batch_id:batchId,recommendation_key:text(p.recommendation_key,true),recommendation_type:text(p.recommendation_type,true,100),item_key:text(p.item_key),item_name:text(p.item_name),item_code:text(p.item_code,false,200),unit:text(p.unit,false,100),from_location:from,to_location:to,suggested_qty:suggested,executed_qty:executed,status,note:text(p.note,false,4000),match_review_required:match?1:0,override_unreviewed:override?1:0,override_reason:reason,therapeutic_group_key:text(p.therapeutic_group_key),source:legacy?'legacy_local':'current',original_at:originalAt?new Date(originalAt).toISOString():null};
 const legacyHash=legacy?crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex'):null;
 const clientId=legacy?legacyHash:text(p.client_id,true,100);
 const duplicate=legacy?db.prepare('SELECT id FROM recommendation_actions WHERE legacy_hash=?').get(legacyHash):db.prepare('SELECT * FROM recommendation_actions WHERE acted_by=? AND client_id=?').get(user.id,clientId);
 if(duplicate){
  if(!legacy&&Object.entries(row).some(([k,v])=>(duplicate[k]??null)!==v))throw new Error('معرف القرار مستخدم ببيانات مختلفة');
  return {ok:true,duplicate:true,id:duplicate.id};
 }
 const id=crypto.randomUUID(),at=new Date().toISOString(),keys=Object.keys(row);
 db.transaction(()=>{
  db.prepare('INSERT INTO recommendation_actions(id,acted_by,acted_at,client_id,legacy_hash,'+keys.join(',')+') VALUES('+Array(5+keys.length).fill('?').join(',')+')').run(id,user.id,at,clientId,legacyHash,...keys.map(k=>row[k]));
  db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES(?,'recommendation_decision','recommendation_action',?,?)").run(user.id,id,JSON.stringify({...row,originalActorKnown:!legacy}));
 })();
 return {ok:true,id};
}
function importLegacy(user,p){
 rights.demand(user,'users.manage');rights.demand(user,'decisions.write');rights.demand(user,'screen.daily');
 if(!Array.isArray(p.rows)||p.rows.length>500)throw new Error('استورد حتى 500 قرار في الدفعة');
 let imported=0,duplicate=0;const errors=[];
 for(let index=0;index<p.rows.length;index++)try{const result=save(user,p.rows[index],true);if(result.duplicate)duplicate++;else imported++;}catch(e){errors.push({index,error:e.message});}
 return {ok:true,imported,duplicate,errors};
}
module.exports={list,save,importLegacy};
