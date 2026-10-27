const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

function requireAuth(tk) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function canWrite(role) {
  return ["system_admin", "pharmacy_manager", "warehouse_keeper"].includes(role);
}

function list({ token, sinceISO, limit }) {
  requireAuth(token);
  const db = getDb();
  const lim = Math.min(Number(limit) || 2000, 10000);
  const rows = sinceISO
    ? db.prepare("SELECT * FROM stock_transactions WHERE txn_date >= ? ORDER BY txn_date DESC, created_at DESC LIMIT ?").all(sinceISO, lim)
    : db.prepare("SELECT * FROM stock_transactions ORDER BY txn_date DESC, created_at DESC LIMIT ?").all(lim);
  return { ok: true, rows };
}

function insert({ token, txn }) {
  const user = requireAuth(token);
  if (!canWrite(user.role)) return { ok: false, error: "صلاحيات غير كافية" };
  if (!txn || !txn.txn_type || !txn.txn_date || !txn.item_key) return { ok: false, error: "بيانات ناقصة" };
  const q = Number(txn.qty);
  if (!(q > 0)) return { ok: false, error: "كمية غير صالحة" };
  if (!txn.note || String(txn.note).trim().length < 5) {
    return { ok: false, error: "سبب الحركة أو رقم المستند مطلوب" };
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const cleanNote = String(txn.note).trim();
  const write = db.transaction(() => {
    db.prepare(`INSERT INTO stock_transactions
      (id, txn_date, txn_type, item_key, item_name, item_code, unit,
       from_location_name, from_location_type, to_location_name, to_location_type,
       qty, note, source_batch_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, txn.txn_date, txn.txn_type, txn.item_key,
      txn.item_name || null, txn.item_code || null, txn.unit || null,
      txn.from_location_name || null, txn.from_location_type || null,
      txn.to_location_name || null, txn.to_location_type || null,
      q, cleanNote, txn.source_batch_id || null, user.id,
    );
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "stock_transaction_created", "stock_transactions", id, JSON.stringify({ ...txn, qty: q, note: cleanNote }));
  });
  write();
  return { ok: true, id };
}

function remove({ token, id }) {
  const user = requireAuth(token);
  if (!["system_admin", "pharmacy_manager"].includes(user.role)) return { ok: false, error: "صلاحيات غير كافية" };
  const db = getDb();
  const existing = db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(id);
  const write = db.transaction(() => {
    db.prepare("DELETE FROM stock_transactions WHERE id = ?").run(id);
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "stock_transaction_deleted", "stock_transactions", id, JSON.stringify(existing || {}));
  });
  write();
  return { ok: true };
}

module.exports = { list, insert, remove };
