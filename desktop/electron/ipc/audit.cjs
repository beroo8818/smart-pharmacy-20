const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

function requireAuth(tk) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function insert({ token, action, entity, entity_id, details }) {
  const user = requireAuth(token);
  if (!action) return { ok: false, error: "action is required" };
  const db = getDb();
  const safeDetails = typeof details === "string" ? details : JSON.stringify(details || {});
  const res = db.prepare(
    "INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)"
  ).run(user.id, action, entity || null, entity_id || null, safeDetails);
  return { ok: true, id: res.lastInsertRowid };
}

function list({ token, limit }) {
  requireAuth(token);
  const db = getDb();
  const lim = Math.min(Number(limit) || 500, 2000);
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY at DESC LIMIT ?").all(lim);
  return { ok: true, rows };
}

module.exports = { insert, list };
