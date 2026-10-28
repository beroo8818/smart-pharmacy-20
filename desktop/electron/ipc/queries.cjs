const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");
const { visible, assigned, manager } = require("./access.cjs");
function scopedBatches(user, rows) {
  const rights=require('./rights.cjs'),p=rights.profile(user);
  if(user.role==='system_admin'||p.all_branches&&rights.has(user,'data.warehouse')&&rights.has(user,'data.branches'))return rows;
  const counts=new Map();
  for(const row of getDb().prepare('SELECT m.upload_batch_id,l.name,l.type,count(*) n FROM inventory_movements m JOIN locations l ON l.id=m.location_id GROUP BY m.upload_batch_id,l.id').all().filter(l=>visible(user,l.name,l.type)))counts.set(row.upload_batch_id,(counts.get(row.upload_batch_id)||0)+row.n);
  return rows.filter((row) => counts.has(row.id)).map((row) => ({ ...row, file_name: "تقرير صيدليتي", notes: null, row_count:counts.get(row.id) }));
}

function requireAuth(tk) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function getLatestSavedBatch({ token: tk }) {
  requireAuth(tk);
  return { ok: true, batch: listBatchesContinuous({ token: tk }).batches[0] || null };
}

function listBatches({ token: tk }) {
  const user = requireAuth(tk);
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM upload_batches WHERE status = 'saved' ORDER BY datetime(uploaded_at) DESC, COALESCE(snapshot_date, month) DESC LIMIT 50")
    .all();
  return { ok: true, batches: scopedBatches(user, rows) };
}

function getMovementsByBatch({ token: tk, batchId }) {
  const user = requireAuth(tk);
  if (!batchId) return { ok: true, movements: [] };
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*, b.issued_from,b.issued_to, i.item_code, i.item_name_ar, i.item_name_en,
              i.active_ingredient_ar, i.strength, i.dosage_form, i.unit,
              l.name AS location_name, l.type AS location_type
       FROM inventory_movements m
       JOIN upload_batches b ON b.id=m.upload_batch_id
       JOIN item_master i ON i.id = m.item_master_id
       JOIN locations  l ON l.id = m.location_id
       WHERE m.upload_batch_id = ?
       ORDER BY i.item_name_ar, l.name`
    )
    .all(batchId);
  return { ok: true, movements: rows.filter((row) => visible(user, row.location_name, row.location_type)) };
}

function listBatchesContinuous({ token: tk, limit }) {
  const user = requireAuth(tk);
  const db = getDb();
  const lim = Math.min(Number(limit) || 10000, 10000);
  const rows = db
    .prepare(
      `SELECT id, file_name, month, status, row_count, uploaded_by, uploaded_at, notes,
              snapshot_date, batch_kind, issued_from, issued_to, received_from, received_to, snapshot_boundary
       FROM upload_batches WHERE status = 'saved'
       ORDER BY datetime(uploaded_at) DESC, COALESCE(snapshot_date, month) DESC LIMIT ?`
    ).all(lim);
  return { ok: true, batches: scopedBatches(user, rows) };
}

function getMovementsByBatchIds({ token: tk, batchIds }) {
  const user = requireAuth(tk);
  if (!Array.isArray(batchIds) || !batchIds.length) return { ok: true, movements: [] };
  const db = getDb();
  const placeholders = batchIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT m.*, b.issued_from,b.issued_to, i.item_code, i.item_name_ar, i.item_name_en,
              i.active_ingredient_ar, i.strength, i.dosage_form, i.unit,
              l.name AS location_name, l.type AS location_type
       FROM inventory_movements m
       JOIN upload_batches b ON b.id=m.upload_batch_id
       JOIN item_master i ON i.id = m.item_master_id
       JOIN locations  l ON l.id = m.location_id
       WHERE m.upload_batch_id IN (${placeholders})`
    ).all(...batchIds);
  return { ok: true, movements: rows.filter((row) => visible(user, row.location_name, row.location_type)) };
}

function listLocations({ token: tk }) {
  const user = requireAuth(tk);
  const db = getDb();
  return {
    ok: true,
    locations: db
      .prepare("SELECT * FROM locations WHERE active = 1 ORDER BY type, name")
      .all().filter((row) => visible(user, row.name, row.type)),
  };
}

function getSettings() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return { ok: true, settings: obj };
}

function setSetting({ token: tk, key, value }) {
  const user = requireAuth(tk);
  if (!require('./rights.cjs').has(user,'settings.write')) return { ok: false, error: "صلاحيات غير كافية" };
  const db = getDb();
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, String(value));
  return { ok: true };
}

module.exports = {
  getLatestSavedBatch, listBatches, getMovementsByBatch,
  listBatchesContinuous, getMovementsByBatchIds,
  listLocations, getSettings, setSetting,
};
