const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");
const { visible } = require("./access.cjs");
const rights=require('./rights.cjs');

function requireAuth(tk) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function canWrite(role) {
  return ["system_admin", "pharmacy_manager", "warehouse_keeper"].includes(role);
}

function list({ token, sinceISO, limit, all = false }) {
  const user = requireAuth(token);
  const db = getDb();
  const lim = Math.min(Number(limit) || 2000, 10000);
  const sql = 'SELECT * FROM stock_transactions' + (sinceISO ? ' WHERE txn_date >= ?' : '') + ' ORDER BY txn_date DESC, created_at DESC, id' + (all ? '' : ' LIMIT ?');
  const rows = db.prepare(sql).all(...(sinceISO ? [sinceISO] : []),...(all ? [] : [lim]));
  return { ok: true, rows: rows.filter((row) => visible(user, row.from_location_name, row.from_location_type) || visible(user, row.to_location_name, row.to_location_type)) };
}

function insert({ token, txn }) {
  const user = requireAuth(token);
  const permission={warehouse_receipt:'stock.receipt',warehouse_issue_to_pharmacy:'stock.transfer',pharmacy_transfer:'stock.transfer',pharmacy_issue:'stock.issue',warehouse_return:'stock.return',pharmacy_return_to_warehouse:'stock.return'}[txn?.txn_type];
  if (!permission||!rights.has(user,permission)) return { ok: false, error: "صلاحيات غير كافية" };
  if((txn.from_location_name&&!visible(user,txn.from_location_name,txn.from_location_type))||(txn.to_location_name&&!visible(user,txn.to_location_name,txn.to_location_type)))return {ok:false,error:'طرف حركة خارج نطاق صلاحياتك'};
  if (!txn || !txn.txn_type || !txn.txn_date || !txn.item_key) return { ok: false, error: "بيانات ناقصة" };
  const shapes={warehouse_receipt:[null,'main_warehouse'],warehouse_issue_to_pharmacy:['main_warehouse','sub_pharmacy'],pharmacy_issue:['sub_pharmacy',null],pharmacy_transfer:['sub_pharmacy','sub_pharmacy'],warehouse_return:['sub_pharmacy','main_warehouse'],pharmacy_return_to_warehouse:['sub_pharmacy','main_warehouse']}[txn.txn_type];
  if(!shapes||shapes.some((type,index)=>{const prefix=index?'to':'from',name=txn[prefix+'_location_name'];return type?txn[prefix+'_location_type']!==type||!getDb().prepare('SELECT id FROM locations WHERE name=? AND type=? AND active=1').get(name||'',type):!!name;})||(txn.txn_type==='pharmacy_transfer'&&txn.from_location_name===txn.to_location_name))return {ok:false,error:'نوع أو أطراف الحركة غير صحيحة؛ اختر مواقع مسجلة'};
  const q = Number(txn.qty);
  if (!Number.isFinite(q)||!(q > 0)) return { ok: false, error: "كمية غير صالحة" };
  if (!txn.note || String(txn.note).trim().length < 5) {
    return { ok: false, error: "سبب الحركة أو رقم المستند مطلوب" };
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const cleanNote = String(txn.note).trim();
  const from=txn.issued_from||null,to=txn.issued_to||null;
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
  if(!validDate(txn.txn_date)||txn.txn_date>today)return {ok:false,error:'تاريخ الحركة غير صالح أو في المستقبل'};
  if((from||to)&&(txn.txn_type!=='pharmacy_issue'||!validDate(from)||!validDate(to)||from>to||to>txn.txn_date))return {ok:false,error:'حدد فترة منصرف صحيحة تنتهي قبل تاريخ الحركة أو فيه'};
  const write = db.transaction(() => {
    if(from&&db.prepare("SELECT id FROM stock_transactions WHERE txn_type='pharmacy_issue' AND COALESCE(item_code,item_key)=? AND COALESCE(unit,'')=? AND from_location_name=? AND issued_from<=? AND issued_to>=?").get(txn.item_code||txn.item_key,txn.unit||'',txn.from_location_name,to,from))throw new Error('فترة منصرف فعلي متداخلة؛ لا تسجل نفس الأيام مرتين');
    db.prepare(`INSERT INTO stock_transactions
      (id, txn_date, txn_type, item_key, item_name, item_code, unit,
       from_location_name, from_location_type, to_location_name, to_location_type,
       qty, note, source_batch_id, created_by,issued_from,issued_to)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, txn.txn_date, txn.txn_type, txn.item_key,
      txn.item_name || null, txn.item_code || null, txn.unit || null,
      txn.from_location_name || null, txn.from_location_type || null,
      txn.to_location_name || null, txn.to_location_type || null,
      q, cleanNote, txn.source_batch_id || null, user.id,from,to,
    );
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "stock_transaction_created", "stock_transactions", id, JSON.stringify({ ...txn, qty: q, note: cleanNote }));
  });
  try{write();return {ok:true,id};}catch(e){return {ok:false,error:e.message};}
}

function remove({ token, id }) {
  const user = requireAuth(token);
  if (!rights.has(user,'stock.delete')) return { ok: false, error: "صلاحيات غير كافية" };
  const db = getDb();
  const existing = db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(id);
  if(!existing||(existing.from_location_name&&!visible(user,existing.from_location_name,existing.from_location_type))||(existing.to_location_name&&!visible(user,existing.to_location_name,existing.to_location_type)))return {ok:false,error:'حركة غير مسموحة'};
  const write = db.transaction(() => {
    db.prepare("DELETE FROM stock_transactions WHERE id = ?").run(id);
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "stock_transaction_deleted", "stock_transactions", id, JSON.stringify(existing || {}));
  });
  write();
  return { ok: true };
}

module.exports = { list, insert, remove };
