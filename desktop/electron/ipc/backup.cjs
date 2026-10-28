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
  const rights=require('./rights.cjs');
  if (!rights.has(c.user,'backup.export')||!rights.profile(c.user).all_branches||!rights.has(c.user,'data.warehouse')||!rights.has(c.user,'data.branches')) return { ok: false, error: "النسخة الكاملة تحتاج صلاحية النسخ ونطاق كل المواقع" };
  let staging;
  try {
    const db = getDb();
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
    const current = fs.statSync(src), target = fs.existsSync(dest) ? fs.statSync(dest) : null;
    if (path.resolve(dest).toLowerCase() === path.resolve(src).toLowerCase() ||
      (target && current.dev === target.dev && current.ino === target.ino)) throw new Error("اختر ملف نسخة مختلفًا عن قاعدة البيانات الحالية");
    staging = dest + "." + require("crypto").randomUUID() + ".partial";
    // SQLite's online backup API includes committed WAL pages in a consistent snapshot.
    await db.backup(staging);
    const check = new (require("better-sqlite3"))(staging, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma("quick_check", { simple: true }) !== "ok") throw new Error("فشل فحص سلامة النسخة");
    } finally { check.close(); }
    fs.renameSync(staging, dest);
    staging = null;
    return { ok: true, path: dest };
  } catch (e) {
    if (staging && fs.existsSync(staging)) fs.unlinkSync(staging);
    return { ok: false, error: e.message };
  }
}

async function restoreBackup({ token, confirm } = {}) {
  const c = getCurrentUser({ token });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  const rights=require('./rights.cjs'),scope=rights.profile(c.user);
  if (!rights.has(c.user,'backup.restore')||!scope.all_branches||!rights.has(c.user,'data.warehouse')||!rights.has(c.user,'data.branches')) return { ok: false, error: "الاسترجاع يحتاج صلاحية استرجاع ونطاق كل المواقع" };
  if(confirm!==true)return {ok:false,error:'أكد استبدال بيانات الجهاز أولًا؛ لم يتغير أي ملف'};
  if(!app.isPackaged)return {ok:false,error:'الاسترجاع وإعادة التشغيل متاحان في النسخة المستقلة فقط؛ وضع التطوير لا يستبدل قاعدة العمل'};
  try{
   const chosen=dialog.showOpenDialogSync({title:'اختيار نسخة قاعدة دواء كاملة',properties:['openFile'],filters:[{name:'Dawa Backup',extensions:['db']}]});
   if(!chosen?.[0])return {ok:false,error:'تم الإلغاء'};
   const answer=await dialog.showMessageBox({type:'warning',title:'تأكيد استرجاع قاعدة البيانات',message:'سيستبدل الاسترجاع كل بيانات وحسابات هذا الجهاز بالنسخة المختارة. سيعاد تشغيل البرنامج وتسجيل الدخول بحسابات النسخة. تحفظ نسخة أمان من البيانات الحالية.',buttons:['إلغاء','استرجاع وإعادة تشغيل'],defaultId:0,cancelId:0,noLink:true});
   if(answer.response!==1)return {ok:false,error:'تم الإلغاء'};
   const result=await require('../db/restore.cjs').prepareRestore(chosen[0],app.getPath('userData'));
   app.relaunch({execPath:process.env.PORTABLE_EXECUTABLE_FILE||process.execPath,args:process.argv.slice(1)});setTimeout(()=>app.quit(),400);
   return result;
  }catch(e){return {ok:false,error:e.message};}
}

async function autoWeeklyBackup() {
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
    await db.backup(path.join(dir, `auto-${stamp()}.db`));
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
