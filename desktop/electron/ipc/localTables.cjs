const crypto=require('crypto');
const {getDb}=require('../db/sqlite.cjs');
const rights=require('./rights.cjs');
function matches(row,filters){return filters.every(f=>f.op==='in'?Array.isArray(f.value)&&f.value.includes(row[f.key]):f.op==='gt'?row[f.key]>f.value:row[f.key]===f.value);}
function call(user,p,token){
 const db=getDb(),queries=require('./queries.cjs'),filters=Array.isArray(p.filters)?p.filters:[];
 if(p.operation==='select'){
  let rows;
  if(p.table==='upload_batches')rows=queries.listBatchesContinuous({token}).batches.map(r=>({...r,rows_saved:r.row_count,created_at:r.uploaded_at}));
  else if(p.table==='inventory_movements'){
   const ids=queries.listBatchesContinuous({token}).batches.map(b=>b.id);
   rows=queries.getMovementsByBatchIds({token,batchIds:ids}).movements.map(r=>({...r,item_name:r.item_name_ar,scientific_name:r.active_ingredient_ar,trade_name:r.item_name_en,issued_quantity:r.issued_qty,current_balance:r.closing_balance,source_sheet:null}));
  }else if(p.table==='locations')rows=queries.listLocations({token}).locations;
  else if(p.table==='profiles')rows=db.prepare('SELECT id,username email,full_name name,assigned_location_id FROM users WHERE active=1').all().filter(r=>r.id===user.id||rights.has(user,'users.manage'));
  else if(p.table==='user_roles')rows=db.prepare('SELECT id user_id,role,assigned_location_id FROM users WHERE active=1').all().filter(r=>r.user_id===user.id||rights.has(user,'users.manage')).map(r=>({user_id:r.user_id,role:r.assigned_location_id?'sub_pharmacist':r.role}));
  else if(p.table==='audit_log')rows=db.prepare('SELECT * FROM audit_log ORDER BY id DESC').all().filter(r=>r.user_id===user.id||rights.has(user,'users.manage')).map(r=>({...r,entity_type:r.entity,new_value:r.details?JSON.parse(r.details):null}));
  else if(p.table==='active_ingredient_dictionary')rows=db.prepare('SELECT * FROM active_ingredient_dictionary').all().map(r=>({...r,needs_review:!!r.needs_review,approved:!!r.approved}));
  else if(p.table==='item_master')rows=db.prepare('SELECT id,item_code,item_name_ar,item_name_en,active_ingredient_ar,strength,dosage_form,unit,first_active_date,ven_class FROM item_master').all();
  else throw new Error('جدول غير مدعوم محليًا');
  return {ok:true,rows:rows.filter(r=>matches(r,filters))};
 }
 if(p.table==='item_master'&&p.operation==='update'){
  rights.demand(user,'dictionary.write');
  if(!p.values||!filters.length||Object.keys(p.values).some(key=>!['first_active_date','ven_class'].includes(key)))throw new Error('تعديل تعريف غير مسموح');
  if(p.values.first_active_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.values.first_active_date)||!Number.isFinite(Date.parse(p.values.first_active_date))))throw new Error('تاريخ غير صالح');
  const keys=Object.keys(p.values),selected=db.prepare('SELECT * FROM item_master').all().filter(r=>matches(r,filters));
  db.transaction(()=>{for(const row of selected)db.prepare('UPDATE item_master SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>p.values[k]),row.id);db.prepare("INSERT INTO audit_log(user_id,action,entity,details) VALUES(?,'item_metadata_changed','item_master',?)").run(user.id,JSON.stringify({filters,values:p.values}));})();
  return {ok:true,rows:[]};
 }
 if(p.table!=='active_ingredient_dictionary')throw new Error('استخدم شاشة إدارة الفروع والصلاحيات للحسابات المحلية');
 rights.demand(user,'dictionary.write');
 const fields=['original_item_name','scientific_name','trade_name','active_ingredient','strength','dosage_form','unit','standard_name','therapeutic_group_key','confidence_score','needs_review','approved'];
 const values=Array.isArray(p.values)?p.values:[p.values];
 if(values.length>500||values.some(v=>!v||Object.keys(v).some(k=>!fields.includes(k))))throw new Error('حقول القاموس غير صالحة');
 const clean=value=>{const copy={...value};for(const [key,v] of Object.entries(copy)){if(['needs_review','approved'].includes(key)){if(typeof v!=='boolean')throw new Error('علامة القاموس غير صالحة');copy[key]=v?1:0;}else if(key==='confidence_score'){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw new Error('درجة الثقة غير صالحة');}else if(v!==null&&(typeof v!=='string'||v.length>2000))throw new Error('نص القاموس غير صالح');}return copy;};
 return db.transaction(()=>{
  if(p.operation==='insert')for(const value of values){const row=clean(value);if(!row.original_item_name?.trim())throw new Error('اسم الصنف مطلوب');const keys=Object.keys(row);db.prepare('INSERT INTO active_ingredient_dictionary(id,'+keys.join(',')+') VALUES(?,'+keys.map(()=>'?').join(',')+')').run(crypto.randomUUID(),...keys.map(k=>row[k]));}
  else if(p.operation==='update'){
   if(values.length!==1||!filters.length)throw new Error('حدد السجلات المطلوبة للتعديل');
   const row=clean(values[0]),keys=Object.keys(row);if(!keys.length)throw new Error('لا يوجد تعديل');
   const selected=db.prepare('SELECT * FROM active_ingredient_dictionary').all().filter(r=>matches(r,filters));
   for(const record of selected)db.prepare('UPDATE active_ingredient_dictionary SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>row[k]),record.id);
  }else throw new Error('إجراء قاموس غير مدعوم');
  db.prepare("INSERT INTO audit_log(user_id,action,entity,details) VALUES(?,'dictionary_changed','active_ingredient_dictionary',?)").run(user.id,JSON.stringify({operation:p.operation,count:values.length,filters}));
  return {ok:true,rows:[]};
 })();
}
module.exports={call};
