const { getDb } = require("./sqlite.cjs");
const { hashPassword, uid } = require("../ipc/auth.cjs");

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

  // Never reset an existing password or reactivate an existing account on startup.
}

module.exports = { ensureSeed };
