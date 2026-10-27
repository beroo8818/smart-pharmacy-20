const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

function requireAuth(tk) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function getLatestSavedBatch({ token: tk }) {
  requireAuth(tk);
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM upload_batches WHERE status = 'saved' ORDER BY datetime(uploaded_at) DESC, COALESCE(snapshot_date, month) DESC LIMIT 1")
    .get();
  return { ok: true, batch: row || null };
}

function listBatches({ token: tk }) {
  requireAuth(tk);
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM upload_batches WHERE status = 'saved' ORDER BY datetime(uploaded_at) DESC, COALESCE(snapshot_date, month) DESC LIMIT 50")
    .all();
  return { ok: true, batches: rows };
}

function getMovementsByBatch({ token: tk, batchId }) {
  requireAuth(tk);
  if (!batchId) return { ok: true, movements: [] };
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*, i.item_code, i.item_name_ar, i.item_name_en,
              i.active_ingredient_ar, i.strength, i.dosage_form, i.unit,
              l.name AS location_name, l.type AS location_type
       FROM inventory_movements m
       JOIN item_master i ON i.id = m.item_master_id
       JOIN locations  l ON l.id = m.location_id
       WHERE m.upload_batch_id = ?
       ORDER BY i.item_name_ar, l.name`
    )
    .all(batchId);
  return { ok: true, movements: rows };
}

function listBatchesContinuous({ token: tk, limit }) {
  requireAuth(tk);
  const db = getDb();
  const lim = Math.min(Number(limit) || 10000, 10000);
  const rows = db
    .prepare(
      `SELECT id, file_name, month, status, row_count, uploaded_by, uploaded_at, notes,
              snapshot_date, batch_kind
       FROM upload_batches WHERE status = 'saved'
       ORDER BY datetime(uploaded_at) DESC, COALESCE(snapshot_date, month) DESC LIMIT ?`
    ).all(lim);
  return { ok: true, batches: rows };
}

function getMovementsByBatchIds({ token: tk, batchIds }) {
  requireAuth(tk);
  if (!Array.isArray(batchIds) || !batchIds.length) return { ok: true, movements: [] };
  const db = getDb();
  const placeholders = batchIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT m.*, i.item_code, i.item_name_ar, i.item_name_en,
              i.active_ingredient_ar, i.strength, i.dosage_form, i.unit,
              l.name AS location_name, l.type AS location_type
       FROM inventory_movements m
       JOIN item_master i ON i.id = m.item_master_id
       JOIN locations  l ON l.id = m.location_id
       WHERE m.upload_batch_id IN (${placeholders})`
    ).all(...batchIds);
  return { ok: true, movements: rows };
}

function listLocations({ token: tk }) {
  requireAuth(tk);
  const db = getDb();
  return {
    ok: true,
    locations: db
      .prepare("SELECT * FROM locations WHERE active = 1 ORDER BY type, name")
      .all(),
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
  requireAuth(tk);
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
