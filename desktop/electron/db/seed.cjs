const { getDb } = require("./sqlite.cjs");
const { hashPassword, verifyPassword, uid } = require("../ipc/auth.cjs");

// Creates a default system admin on first run so the app is usable.
function ensureSeed() {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  const adminPassword = "admin123";
  const markRepaired = () => db.prepare(
    "INSERT OR REPLACE INTO settings(key, value) VALUES ('default_admin_repair_v1', ?)"
  ).run(new Date().toISOString());
  if (count.n === 0) {
    db.prepare(
      "INSERT INTO users(id, username, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)"
    ).run(
      uid(),
      "admin",
      "مدير النظام",
      hashPassword(adminPassword),
      "system_admin"
    );
    console.log("Seed: created default admin user (admin / admin123)");
    markRepaired();
    return;
  }

  const repairDone = db
    .prepare("SELECT value FROM settings WHERE key = 'default_admin_repair_v1'")
    .get();
  if (repairDone) return;

  const admin = db.prepare("SELECT * FROM users WHERE username = ?").get("admin");
  if (!admin) {
    db.prepare(
      "INSERT INTO users(id, username, full_name, password_hash, role, active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(uid(), "admin", "مدير النظام", hashPassword(adminPassword), "system_admin");
    console.log("Seed: recreated missing default admin user (admin / admin123)");
    markRepaired();
    return;
  }

  const needsRepair =
    admin.active !== 1 ||
    admin.role !== "system_admin" ||
    !verifyPassword(adminPassword, admin.password_hash);

  if (needsRepair) {
    db.prepare(
      "UPDATE users SET password_hash = ?, role = ?, active = 1 WHERE username = ?"
    ).run(hashPassword(adminPassword), "system_admin", "admin");
    db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(admin.id);
    markRepaired();
    console.log("Seed: repaired default admin login (admin / admin123)");
  }
}

module.exports = { ensureSeed };