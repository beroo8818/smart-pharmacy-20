const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

// Wipes all operational data but keeps users, sessions and settings.
function wipeAllData({ token } = {}) {
  const c = getCurrentUser({ token });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  if (c.user.role !== "system_admin") return { ok: false, error: "صلاحيات غير كافية" };
  const db = getDb();
  const wipe = db.transaction(() => {
    db.prepare("DELETE FROM inventory_movements").run();
    db.prepare("DELETE FROM stock_transactions").run();
    db.prepare("DELETE FROM upload_batches").run();
    db.prepare("DELETE FROM item_master").run();
    db.prepare("DELETE FROM locations").run();
    db.prepare(
      "INSERT INTO audit_log(user_id, action, entity, details) VALUES (?, ?, ?, ?)"
    ).run(c.user.id, "wipe_all_data", "system", JSON.stringify({ at: new Date().toISOString() }));
  });
  try {
    wipe();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { wipeAllData };