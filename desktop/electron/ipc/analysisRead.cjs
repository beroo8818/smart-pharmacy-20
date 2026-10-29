const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {getDb,getDbPath}=require('../db/sqlite.cjs');
const {getCurrentUser}=require('./auth.cjs');
const {visible}=require('./access.cjs');
let queue=Promise.resolve();

function scope(token){
  const result=getCurrentUser({token});
  if(!result.ok)throw new Error('غير مسجل الدخول');
  return getDb().prepare('SELECT id,name,type FROM locations ORDER BY id').all()
    .filter(row=>visible(result.user,row.name,row.type)).map(row=>row.id);
}
function read({token,batchIds}){
  const task=queue.then(async()=>{
    const locationIds=scope(token);
    if(!Array.isArray(batchIds)||!batchIds.length)return {ok:true,movements:[]};
    if(batchIds.length>10000||batchIds.some(id=>typeof id!=='string'))throw new Error('قائمة الملفات غير صالحة');
    if(!locationIds.length)return {ok:true,movements:[]};
    const movements=await new Promise((resolve,reject)=>{
      let done=false;
      const worker=new Worker(path.join(__dirname,'analysisRead.worker.cjs'),{workerData:{path:getDbPath(),batchIds,locationIds}});
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('استغرقت قراءة البيانات وقتًا طويلًا'));},120000);
      worker.once('message',message=>{done=true;clearTimeout(timer);message.error?reject(new Error(message.error)):resolve(message.rows);});
      worker.once('error',error=>{done=true;clearTimeout(timer);reject(error);});
      worker.once('exit',()=>{if(!done){clearTimeout(timer);reject(new Error('تعذر إكمال قراءة بيانات المخزون'));}});
    });
    if(JSON.stringify(scope(token))!==JSON.stringify(locationIds))throw new Error('تغيرت صلاحيات المواقع أثناء القراءة؛ أعد المحاولة');
    return {ok:true,movements};
  });
  queue=task.then(()=>{},()=>{});
  return task;
}
module.exports={read};
