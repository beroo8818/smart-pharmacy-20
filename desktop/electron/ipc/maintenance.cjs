const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

// Wipes all operational data but keeps users, sessions and settings.
function wipeAllData({ token } = {}) {
  const c = getCurrentUser({ token });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  const rights=require('./rights.cjs');
  if (!rights.has(c.user,'data.delete')||!rights.profile(c.user).all_branches||!rights.has(c.user,'data.warehouse')||!rights.has(c.user,'data.branches')) return { ok: false, error: "تصفير البيانات يحتاج صلاحية الحذف ونطاق كل المواقع" };
  const db = getDb();
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM recommendation_actions').run();
    db.prepare('DELETE FROM branch_reports').run();
    db.prepare('DELETE FROM branch_requests').run();
    db.prepare("DELETE FROM inventory_movements").run();
    db.prepare("DELETE FROM stock_transactions").run();
    db.prepare("DELETE FROM upload_batches").run();
    db.prepare("DELETE FROM item_master").run();
    db.prepare('DELETE FROM active_ingredient_dictionary').run();
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
