
const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");
const { identity } = require("./importIdentity.cjs");
const {normalizeDates,effectiveRange,crosses}=require('./reportDates.cjs');
const rights=require('./rights.cjs');

function uid() { return crypto.randomUUID(); }
function clean(v) { return v == null ? null : String(v).trim() || null; }
function quantity(v) { return v == null || String(v).trim() === "" ? null : Number(v); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value; }
function requireAuth(token) {
  const c = getCurrentUser({ token });
  if (!c.ok) throw new Error("غير مسجل الدخول");
  return c.user;
}

function parseExcel({ token: tk }) {
  const c = getCurrentUser({ token: tk });
  if (!c.ok) return { ok: false, error: "غير مسجل الدخول" };
  return { ok: true };
}

function getOrCreateLocation(db, name, type) {
  const locationType = type === "main_store" ? "main_warehouse" : (type || "sub_pharmacy");
  const locationName = clean(name) || "غير محدد";
  const existing = db.prepare("SELECT id,active FROM locations WHERE name = ? AND type = ?").get(locationName, locationType);
  if (existing){if(!existing.active)throw new Error('الموقع موقوف؛ راجع المدير قبل الرفع');return existing.id;}
  const id = uid();
  db.prepare("INSERT INTO locations(id, name, type) VALUES (?, ?, ?)").run(id, locationName, locationType);
  return id;
}

function getOrCreateItem(db, row) {
  const code = clean(row.item_code);
  if (code) {
    const byCode = db.prepare("SELECT id, unit, strength, dosage_form, item_name_en, item_name_ar, active_ingredient_ar FROM item_master WHERE item_code = ?").get(code);
    if (byCode) {
      for (const field of ["unit", "strength", "dosage_form", "item_name_en", "item_name_ar", "active_ingredient_ar"]) {
        if (clean(row[field]) && clean(byCode[field]) && clean(row[field]) !== clean(byCode[field])) {
          throw new Error("كود الصنف مستخدم ببيانات مختلفة؛ راجع الوحدة والتركيز والاسم التجاري: " + code);
        }
      }
      return byCode.id;
    }
  }
  const name = clean(row.item_name_ar) || clean(row.item_name_en) || code || "صنف بدون اسم";
  const byName = db.prepare(
    "SELECT id FROM item_master WHERE IFNULL(item_name_ar,'') = ? AND IFNULL(strength,'') = ? AND IFNULL(dosage_form,'') = ? AND IFNULL(unit,'') = ? AND IFNULL(item_name_en,'') = ? LIMIT 1"
  ).get(name, clean(row.strength) || "", clean(row.dosage_form) || "", clean(row.unit) || "", clean(row.item_name_en) || "");
  if (!code && byName) return byName.id;
  const id = uid();
  db.prepare(
    `INSERT INTO item_master(id, item_code, item_name_ar, item_name_en, active_ingredient_ar, strength, dosage_form, unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    code,
    name,
    clean(row.item_name_en),
    clean(row.active_ingredient_ar),
    clean(row.strength),
    clean(row.dosage_form),
    clean(row.unit)
  );
  return id;
}

function saveBatch({ token, fileName, month, rows, ignored, snapshotDate, batchKind, confirmRevision = false, branchSubmission = false, ...dateInput }) {
  if(batchKind==='period_consumption'&&!snapshotDate)snapshotDate=dateInput.issued_to;
  let user;
  try { user = requireAuth(token); } catch (e) { return { ok: false, error: e.message }; }
  const branch = !rights.has(user,'dictionary.write');
  if (!rights.has(user,'data.upload')||(confirmRevision&&!rights.has(user,'data.correct'))) {
    return { ok: false, error: "صلاحية غير كافية لحفظ البيانات" };
  }
  if (!month || !Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "لا توجد بيانات صالحة للحفظ" };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!validDate(snapshotDate) || snapshotDate > today || !validDate(month) || !month.endsWith('-01')) {
    return { ok: false, error: "تاريخ الرصيد غير صالح أو في المستقبل" };
  }
  for (const row of rows) {
    if (row.month && row.month !== month) return { ok: false, error: "ارفع كل شهر في دفعة منفصلة" };
    for (const field of ["issued_qty", "issued", "closing_balance", "closing","received_qty","received"]) {
      if (row[field] != null && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) {
        return { ok: false, error: "كمية غير صالحة؛ راجع المنصرف والرصيد" };
      }
    }
  }

  const db = getDb();
  if(rows.some(row=>!db.prepare('SELECT id FROM locations WHERE name=? AND type=? AND active=1').get(row.location,row.location_type==='main_store'?'main_warehouse':row.location_type||'sub_pharmacy')&&!rights.has(user,'users.manage')))return {ok:false,error:'الموقع جديد أو موقوف؛ اطلب من المدير تسجيله أولًا'};
  if(rows.some(row=>!rights.allowed(user,row.location,row.location_type||'sub_pharmacy')&&!(rights.has(user,'users.manage')&&rights.has(user,'data.branches')&&rights.profile(user).all_branches&&row.location_type==='sub_pharmacy')))return {ok:false,error:'موقع خارج نطاق صلاحياتك'};
  if(branch && rows.some(row=>!db.prepare('SELECT id FROM item_master WHERE item_code=? AND unit=?').get(row.item_code||'',row.unit||'')))return {ok:false,error:'الحفظ بالأصناف والوحدات المعروفة فقط'};
  const batchId = uid();
  const allowedBatchKinds = new Set(["monthly", "weekly_update", "full_snapshot", "partial_update", "period_consumption"]);
  const safeBatchKind = allowedBatchKinds.has(batchKind) ? batchKind : "monthly";
  let dates;
  try { dates=normalizeDates(month,snapshotDate,safeBatchKind,dateInput,today); } catch(e){ return {ok:false,error:e.message}; }
  if(rows.some(r=>Number(r.received_qty??r.received??0)!==0)&&!dates.received_from)return {ok:false,error:'حدد فترة الوارد من يوم إلى يوم قبل حفظ كمياته'};
  const range=effectiveRange({month,batch_kind:safeBatchKind,...dates});
  const hash = identity(month, snapshotDate, safeBatchKind, rows, dates);
  const tx = db.transaction(() => {
    const duplicate = db.prepare("SELECT id, row_count FROM upload_batches WHERE content_hash = ?").get(hash);
    if (duplicate) return { ok: true, duplicate: true, batchId: duplicate.id, rows: duplicate.row_count };
    const overlaps = db.prepare(`SELECT i.item_code, i.unit, m.issued_qty, l.name, l.type, b.month,b.batch_kind,b.snapshot_date,b.issued_from,b.issued_to FROM inventory_movements m JOIN item_master i ON i.id = m.item_master_id
      JOIN locations l ON l.id = m.location_id JOIN upload_batches b ON b.id = m.upload_batch_id
      WHERE b.status = 'saved' AND b.month = ?`).all(month);
    const same=(old,row)=>old.item_code===row.item_code&&old.unit===row.unit&&old.name===row.location&&old.type===(row.location_type==='main_store'?'main_warehouse':row.location_type);
    if(range&&rows.some(row=>quantity(row.issued_qty??row.issued)!=null&&overlaps.some(old=>old.issued_qty!=null&&same(old,row)&&effectiveRange(old)&&crosses(range,effectiveRange(old)))))throw new Error('تداخل جزئي في فترة المنصرف؛ ارفع فترة مستقلة بلا تداخل أو تقريرًا تراكميًا يغطي الفترة السابقة بالكامل');
    if (!confirmRevision && rows.some(row=>overlaps.some(old=>{
      if(!same(old,row))return false;
      const prior=effectiveRange(old);
      return (range&&prior&&range.from<=prior.to&&prior.from<=range.to)||(safeBatchKind!=='period_consumption'&&old.snapshot_date===snapshotDate&&old.batch_kind!=='period_consumption');
    }))) {
      return { ok: false, requiresRevision: true, error: "توجد فترة مغطاة أو رصيد لنفس التاريخ. راجع التصحيح؛ التقرير التراكمي الأوسع لا يُجمع مع الفترة المغطاة، وتصحيح جزء منه يحتاج إعادة الفترة الكاملة." };
    }
    db.prepare(
      `INSERT INTO upload_batches(id, file_name, month, status, row_count, uploaded_by, notes, snapshot_date, batch_kind, uploaded_at,issued_from,issued_to,received_from,received_to,snapshot_boundary)
       VALUES (?, ?, ?, 'saved', ?, ?, ?, ?, ?, ?,?,?,?,?,?)`
    ).run(
      batchId, fileName || "stock.xlsx", month, rows.length, user.id,
      ignored ? `صفوف متجاهلة: ${ignored}` : null,
      snapshotDate || null,
      safeBatchKind,
      new Date(Math.max(Date.now(), Math.round(((db.prepare("SELECT max(julianday(uploaded_at)) AS d FROM upload_batches").get().d || 2440587.5) - 2440587.5) * 86400000) + 1)).toISOString(),
      dates.issued_from,dates.issued_to,dates.received_from,dates.received_to,dates.snapshot_boundary||null,
    );

    const insertMove = db.prepare(
      `INSERT INTO inventory_movements(
        id, upload_batch_id, item_master_id, location_id, month,
        opening_balance, received_qty, issued_qty, closing_balance,
        unit_price, expiry_date, min_stock, max_stock, lead_time_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const row of rows) {
      const itemId = getOrCreateItem(db, row);
      const locationId = getOrCreateLocation(db, row.location, row.location_type);
      insertMove.run(
        uid(), batchId, itemId, locationId, row.month || month,
        Number(row.opening_balance || row.opening || 0),
        Number(row.received_qty || row.received || 0),
        ["monthly", "period_consumption"].includes(safeBatchKind) ? quantity(row.issued_qty ?? row.issued) : null,
        safeBatchKind === "period_consumption" ? null : quantity(row.closing_balance ?? row.closing),
        row.unit_price == null ? null : Number(row.unit_price),
        clean(row.expiry_date),
        row.min_stock == null ? null : Number(row.min_stock),
        row.max_stock == null ? null : Number(row.max_stock),
        row.lead_time_days == null ? null : Number(row.lead_time_days)
      );
    }
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "upload_saved", "upload_batches", batchId, JSON.stringify({ fileName, rows: rows.length }));
    db.prepare("UPDATE upload_batches SET content_hash = ? WHERE id = ?").run(hash, batchId);
    return { ok: true, batchId, rows: rows.length };
  });

  try {
    return tx();
  } catch (e) {
    console.error("saveBatch failed", e);
    return { ok: false, error: "فشل حفظ البيانات: " + e.message };
  }
}

module.exports = { parseExcel, saveBatch };
