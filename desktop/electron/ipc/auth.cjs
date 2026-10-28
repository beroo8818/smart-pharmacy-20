const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");

const SESSION_DAYS = 30;

function uid() {
  return crypto.randomUUID();
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(String(password), useSalt, 64)
    .toString("hex");
  return `${useSalt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt] = stored.split(":");
  const candidate = hashPassword(password, salt);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function nowPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function login({ username, password }) {
  const db = getDb();
  const user = db
    .prepare("SELECT * FROM users WHERE username = ? AND active = 1")
    .get(String(username || "").trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO user_sessions(token, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(token, user.id, nowPlusDays(SESSION_DAYS));
  return {
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.assigned_location_id ? "sub_pharmacist" : user.role,
      assigned_location_id: user.assigned_location_id || null,
      access:require('./rights.cjs').profile(user),
    },
  };
}

function logout({ token }) {
  if (!token) return { ok: true };
  const db = getDb();
  db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
  return { ok: true };
}

function getCurrentUser({ token }) {
  if (!token) return { ok: false, error: "غير مسجل الدخول" };
  const db = getDb();
  const session = db
    .prepare("SELECT * FROM user_sessions WHERE token = ?")
    .get(token);
  if (!session) return { ok: false, error: "غير مسجل الدخول" };
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    return { ok: false, error: "انتهت الجلسة" };
  }
  const user = db
    .prepare("SELECT * FROM users WHERE id = ? AND active = 1")
    .get(session.user_id);
  if (!user) return { ok: false, error: "غير مسجل الدخول" };
  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.assigned_location_id ? "sub_pharmacist" : user.role,
      assigned_location_id: user.assigned_location_id || null,
      access:require('./rights.cjs').profile(user),
    },
  };
}

function requireAuth(token) {
  const c = getCurrentUser({ token });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function changePassword({ token, currentPassword, newPassword }) {
  let user;
  try { user = requireAuth(token); } catch (e) { return { ok: false, error: e.message }; }
  if (!newPassword || String(newPassword).length < 8) {
    return { ok: false, error: "كلمة المرور الجديدة قصيرة جدًا" };
  }
  const db = getDb();
  const full = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  if (!verifyPassword(currentPassword, full.password_hash)) {
    return { ok: false, error: "كلمة المرور الحالية غير صحيحة" };
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(newPassword),
    user.id
  );
  db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND token <> ?").run(user.id, token);
  return { ok: true };
}

function listUsers({ token }) {
  const user = requireAuth(token);
  if (user.role !== "system_admin") return { ok: false, error: "صلاحيات غير كافية" };
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, username, full_name, role, active, created_at FROM users ORDER BY created_at"
    )
    .all();
  return { ok: true, users: rows };
}

function createUser({ token, username, fullName, password, role }) {
  const admin = requireAuth(token);
  if (admin.role !== "system_admin") return { ok: false, error: "صلاحيات غير كافية" };
  const validRoles = ["system_admin", "pharmacy_manager", "warehouse_keeper", "viewer"];
  if (!validRoles.includes(role)) return { ok: false, error: "دور غير صالح" };
  if (!username || !password) return { ok: false, error: "بيانات ناقصة" };
  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(String(username).trim());
  if (exists) return { ok: false, error: "اسم المستخدم موجود بالفعل" };
  const id = uid();
  db.prepare(
    "INSERT INTO users(id, username, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)"
  ).run(id, String(username).trim(), fullName || null, hashPassword(password), role);
  if(role!=='system_admin')db.prepare('INSERT INTO user_access_profiles(user_id,permissions,location_ids,all_branches,updated_by) VALUES(?,?,?,0,?)').run(id,JSON.stringify(require('./rights.cjs').defaults('sub_pharmacist')),'[]',admin.id);
  return { ok: true, id };
}

function setUserActive({ token, userId, active }) {
  const admin = requireAuth(token);
  if (admin.role !== "system_admin") return { ok: false, error: "صلاحيات غير كافية" };
  if (userId === admin.id && !active) {
    return { ok: false, error: "لا يمكنك تعطيل حسابك الحالي" };
  }
  const db = getDb();
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, userId);
  if (!active) db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  return { ok: true };
}

module.exports = {
  login,
  logout,
  getCurrentUser,
  changePassword,
  listUsers,
  createUser,
  setUserActive,
  hashPassword,
  verifyPassword,
  uid,
};
