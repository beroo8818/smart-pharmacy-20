const crypto=require('node:crypto');
const rights=require('./rights.cjs');
const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\s+/g,' ').trim();
const fields={item_code:120,item_name:500,unit:80,strength:120,dosage_form:120,active_ingredient:500};
function items(db){return db.prepare("SELECT id,item_code,item_name_ar item_name,unit,strength,dosage_form,active_ingredient_ar active_ingredient FROM item_master WHERE NULLIF(trim(item_code),'') IS NOT NULL AND NULLIF(trim(unit),'') IS NOT NULL ORDER BY item_name_ar,item_code").all();}
function call(db,user,action,p){
 if(action==='dictionary_list'){
  if(!['screen.dictionary','dictionary.write','data.upload'].some(key=>rights.has(user,key)))throw new Error('قراءة القاموس غير مسموحة');
  return {ok:true,can_create:rights.has(user,'dictionary.write'),items:items(db)};
 }
 rights.demand(user,'dictionary.write');
 if(!p||Array.isArray(p)||Object.keys(p).some(key=>!Object.hasOwn(fields,key)))throw new Error('حقول تعريف الصنف غير صالحة');
 const value={};
 for(const [key,max] of Object.entries(fields)){
  if(p[key]!=null&&typeof p[key]!=='string')throw new Error('تعريف الصنف يجب أن يكون نصًا');
  value[key]=String(p[key]??'').trim();
  if(value[key].length>max||/[\x00-\x1f\x7f]/.test(value[key]))throw new Error('حقل تعريف الصنف غير صالح أو طويل');
 }
 if(!value.item_name||!value.unit)throw new Error('اسم الصنف والوحدة مطلوبان؛ اكتب الاسم كاملًا بالتركيز والشكل');
 return db.transaction(()=>{
  const catalog=db.prepare('SELECT id,item_code,item_name_ar item_name,unit,strength,dosage_form,active_ingredient_ar active_ingredient FROM item_master').all(),sameCode=value.item_code?catalog.find(row=>normalize(row.item_code||'')===normalize(value.item_code)):null;
  const compatible=row=>normalize(row.item_name||'')===normalize(value.item_name)&&normalize(row.unit||'')===normalize(value.unit)&&['strength','dosage_form','active_ingredient'].every(key=>!value[key]||normalize(row[key]||'')===normalize(value[key]));
  if(sameCode){if(!compatible(sameCode))throw new Error('الكود مستخدم بتعريف أو وحدة مختلفة؛ لا يمكن تغيير صنف موجود من شاشة الإضافة');return {ok:true,duplicate:true,item:sameCode};}
  const sameName=catalog.find(row=>normalize(row.item_name||'')===normalize(value.item_name)&&normalize(row.unit||'')===normalize(value.unit));
  if(sameName){if(!sameName.item_code||value.item_code||!compatible(sameName))throw new Error('صنف بنفس الاسم والوحدة موجود؛ راجع كوده أو وضّح التركيز والشكل في الاسم');return {ok:true,duplicate:true,item:sameName};}
  const id=crypto.randomUUID(),code=value.item_code||'USR-'+crypto.randomUUID();
  db.prepare('INSERT INTO item_master(id,item_code,item_name_ar,unit,strength,dosage_form,active_ingredient_ar) VALUES(?,?,?,?,?,?,?)').run(id,code,value.item_name,value.unit,value.strength||null,value.dosage_form||null,value.active_ingredient||null);
  db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES(?,'dictionary_item_created','item_master',?,?)").run(user.id,id,JSON.stringify({...value,item_code:code}));
  return {ok:true,item:items(db).find(row=>row.id===id)};
 })();
}
module.exports={call};
