const fs = require("fs");
const path = require("path");
const { app, dialog } = require("electron");
const { getDb, getDbPath } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

function backupsDir() {
  const dir = path.join(app.getPath("userData"), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function exportBackup({ token } = {}) {
  const c = getCurrentUser({ token });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  try {
    // Checkpoint WAL so the .db file is complete before copying.
    const db = getDb();
    db.pragma("wal_checkpoint(TRUNCATE)");
    const src = getDbPath();
    const def = path.join(backupsDir(), `dawa-backup-${stamp()}.db`);
    let dest = def;
    if (dialog && dialog.showSaveDialogSync) {
      const chosen = dialog.showSaveDialogSync({
        title: "حفظ نسخة احتياطية",
        defaultPath: def,
        filters: [{ name: "Dawa Backup", extensions: ["db"] }],
      });
      if (!chosen) return { ok: false, error: "تم الإلغاء" };
      dest = chosen;
    }
    fs.copyFileSync(src, dest);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function restoreBackup({ token } = {}) {
  const c = getCurrentUser({ token });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  if (c.user.role !== "system_admin") return { ok: false, error: "صلاحيات غير كافية" };
  try {
    let src;
    if (dialog && dialog.showOpenDialogSync) {
      const chosen = dialog.showOpenDialogSync({
        title: "استعادة نسخة احتياطية",
        properties: ["openFile"],
        filters: [{ name: "Dawa Backup", extensions: ["db"] }],
      });
      if (!chosen || !chosen.length) return { ok: false, error: "تم الإلغاء" };
      src = chosen[0];
    }
    if (!src || !fs.existsSync(src)) return { ok: false, error: "ملف غير موجود" };
    const dest = getDbPath();
    // Safety copy of current db before overwriting.
    try { fs.copyFileSync(dest, path.join(backupsDir(), `pre-restore-${stamp()}.db`)); } catch (_) {}
    fs.copyFileSync(src, dest);
    return { ok: true, restart: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function autoWeeklyBackup() {
  try {
    const dir = backupsDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("auto-") && f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const last = files[0];
    if (last && Date.now() - last.t < weekMs) return;
    const db = getDb();
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(getDbPath(), path.join(dir, `auto-${stamp()}.db`));
    // Keep only the 8 most recent auto backups.
    const all = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("auto-") && f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of all.slice(8)) {
      try { fs.unlinkSync(path.join(dir, old.f)); } catch (_) {}
    }
  } catch (e) {
    console.error("autoWeeklyBackup failed", e);
  }
}

module.exports = { exportBackup, restoreBackup, autoWeeklyBackup };