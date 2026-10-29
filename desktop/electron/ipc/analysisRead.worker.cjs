const {parentPort,workerData}=require('node:worker_threads');
const Database=require('better-sqlite3');
let db;
try{
  db=new Database(workerData.path,{readonly:true,fileMustExist:true});
  const {batchIds,locationIds}=workerData;
  const placeholders=values=>values.map(()=>'?').join(',');
  const rows=db.prepare(`SELECT m.id,m.upload_batch_id,m.month,m.closing_balance,m.issued_qty,
    i.item_code,i.item_name_ar,i.item_name_en,i.active_ingredient_ar,i.strength,i.dosage_form,i.unit,
    l.name AS location_name,l.type AS location_type,b.issued_from,b.issued_to
    FROM inventory_movements m JOIN item_master i ON i.id=m.item_master_id
    JOIN locations l ON l.id=m.location_id JOIN upload_batches b ON b.id=m.upload_batch_id
    WHERE m.upload_batch_id IN (${placeholders(batchIds)}) AND m.location_id IN (${placeholders(locationIds)})`)
    .all(...batchIds,...locationIds);
  parentPort.postMessage({rows});
}catch(error){parentPort.postMessage({error:error.message});}
finally{db?.close();}
