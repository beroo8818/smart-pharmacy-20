const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const Database=require('better-sqlite3');
const marker='pending-restore.json';
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function validate(database){
 if(database.pragma('quick_check',{simple:true})!=='ok')throw new Error('ملف قاعدة البيانات تالف');
 const required={users:['id','username','password_hash','role','active'],user_sessions:['token','user_id'],locations:['id','name','type'],item_master:['id'],upload_batches:['id','month','status'],inventory_movements:['id','upload_batch_id','item_master_id','location_id'],stock_transactions:['id','qty'],settings:['key','value'],audit_log:['user_id','action']};
 for(const [table,columns] of Object.entries(required)){
  const existing=new Set(database.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name));
  if(columns.some(c=>!existing.has(c)))throw new Error('الملف ليس نسخة قاعدة دواء كاملة ومتوافقة: '+table);
 }
 if(database.pragma('foreign_key_check').length)throw new Error('النسخة بها مراجع بيانات غير سليمة');
 if(!database.prepare("SELECT id FROM users WHERE role='system_admin' AND active=1 AND length(password_hash)>30 AND instr(password_hash,':')>0 LIMIT 1").get())throw new Error('النسخة لا تحتوي حساب مدير نظام نشطًا');
}
function checkedPath(dir,name,prefix){
 if(typeof name!=='string'||path.basename(name)!==name||!name.startsWith(prefix)||!name.endsWith('.db'))throw new Error('مرجع الاسترجاع غير صالح');
 return path.join(dir,name);
}
async function prepareRestore(source,dir){
 fs.mkdirSync(dir,{recursive:true});
 const current=path.join(dir,'dawa.db');
 if(fs.existsSync(path.join(dir,marker)))throw new Error('يوجد استرجاع معلق؛ أعد تشغيل البرنامج أولًا');
 if(path.resolve(source).toLowerCase()===path.resolve(current).toLowerCase())throw new Error('لا تختار قاعدة العمل الحالية للاسترجاع');
 if(!fs.statSync(source).isFile()||fs.statSync(source).size>1024*1024*1024)throw new Error('اختر ملف قاعدة صالحًا بحجم لا يزيد على 1 جيجابايت');
 const stagedName='restore-staged-'+crypto.randomUUID()+'.db',staged=path.join(dir,stagedName);
 let sourceDb,candidate;
 try{
  sourceDb=new Database(source,{readonly:true,fileMustExist:true});validate(sourceDb);
  await sourceDb.backup(staged);sourceDb.close();sourceDb=null;
  candidate=new Database(staged);candidate.pragma('foreign_keys=ON');
  require('./sqlite.cjs').applyMigrations(candidate);validate(candidate);
  candidate.transaction(()=>{
   candidate.prepare('DELETE FROM user_sessions').run();
   candidate.prepare("INSERT INTO audit_log(user_id,action,entity,details) VALUES(NULL,'database_restored','database',?)").run(JSON.stringify({sourceFile:path.basename(source),preparedAt:new Date().toISOString()}));
  })();
  candidate.pragma('wal_checkpoint(TRUNCATE)');candidate.close();candidate=null;
  const manifest={version:1,staged:stagedName,sha256:hash(staged),createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(dir,marker),JSON.stringify(manifest),{encoding:'utf8',flag:'wx'});
  return {ok:true,restartRequired:true};
 }catch(e){
  if(sourceDb?.open)sourceDb.close();if(candidate?.open)candidate.close();
  if(fs.existsSync(staged))fs.unlinkSync(staged);
  throw e;
 }
}
async function applyPendingRestore(dir){
 const pending=path.join(dir,marker);
 if(!fs.existsSync(pending))return {applied:false};
 const manifest=JSON.parse(fs.readFileSync(pending,'utf8'));
 if(manifest.version!==1)throw new Error('إصدار طلب الاسترجاع غير مدعوم');
 const staged=checkedPath(dir,manifest.staged,'restore-staged-'),current=path.join(dir,'dawa.db');
 if(!fs.existsSync(staged)&&fs.existsSync(current)&&hash(current)===manifest.sha256){fs.unlinkSync(pending);return {applied:true,recovered:true};}
 if(hash(staged)!==manifest.sha256)throw new Error('تغير ملف الاسترجاع بعد فحصه؛ لم تستبدل قاعدة العمل');
 const check=new Database(staged,{readonly:true,fileMustExist:true});
 try{validate(check);}finally{check.close();}
 const safety=path.join(dir,'backups','before-restore-'+stamp()+'.db');
 fs.mkdirSync(path.dirname(safety),{recursive:true});
 if(fs.existsSync(current)){
  const live=new Database(current,{fileMustExist:true});
  try{await live.backup(safety);live.pragma('wal_checkpoint(TRUNCATE)');}finally{live.close();}
 }
 const hadCurrent=fs.existsSync(current);
 // Both files are on the same volume; keep the old database until atomic replacement.
 fs.renameSync(staged,current);
 fs.unlinkSync(pending);
 return {applied:true,safety:hadCurrent?safety:null};
}
module.exports={validate,prepareRestore,applyPendingRestore};
