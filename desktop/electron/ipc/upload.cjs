
const crypto = require("crypto");
const { getDb } = require("../db/sqlite.cjs");
const { getCurrentUser } = require("./auth.cjs");

function uid() { return crypto.randomUUID(); }
function clean(v) { return v == null ? null : String(v).trim() || null; }
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
  const existing = db.prepare("SELECT id FROM locations WHERE name = ? AND type = ?").get(locationName, locationType);
  if (existing) return existing.id;
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

function saveBatch({ token, fileName, month, rows, ignored, snapshotDate, batchKind }) {
  let user;
  try { user = requireAuth(token); } catch (e) { return { ok: false, error: e.message }; }
  if (!["system_admin", "pharmacy_manager", "warehouse_keeper"].includes(user.role)) {
    return { ok: false, error: "صلاحية غير كافية لحفظ البيانات" };
  }
  if (!month || !Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "لا توجد بيانات صالحة للحفظ" };
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(snapshotDate)) || snapshotDate > today) {
    return { ok: false, error: "تاريخ الرصيد غير صالح أو في المستقبل" };
  }
  for (const row of rows) {
    for (const field of ["issued_qty", "issued", "closing_balance", "closing"]) {
      if (row[field] != null && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) {
        return { ok: false, error: "كمية غير صالحة؛ راجع المنصرف والرصيد" };
      }
    }
  }

  const db = getDb();
  const batchId = uid();
  const allowedBatchKinds = new Set(["monthly", "weekly_update", "full_snapshot", "partial_update", "period_consumption"]);
  const safeBatchKind = allowedBatchKinds.has(batchKind) ? batchKind : "monthly";
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO upload_batches(id, file_name, month, status, row_count, uploaded_by, notes, snapshot_date, batch_kind)
       VALUES (?, ?, ?, 'saved', ?, ?, ?, ?, ?)`
    ).run(
      batchId, fileName || "stock.xlsx", month, rows.length, user.id,
      ignored ? `صفوف متجاهلة: ${ignored}` : null,
      snapshotDate || null,
      safeBatchKind,
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
        row.issued_qty == null && row.issued == null ? null : Number(row.issued_qty ?? row.issued),
        row.closing_balance == null && row.closing == null ? null : Number(row.closing_balance ?? row.closing),
        row.unit_price == null ? null : Number(row.unit_price),
        clean(row.expiry_date),
        row.min_stock == null ? null : Number(row.min_stock),
        row.max_stock == null ? null : Number(row.max_stock),
        row.lead_time_days == null ? null : Number(row.lead_time_days)
      );
    }
    db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)")
      .run(user.id, "upload_saved", "upload_batches", batchId, JSON.stringify({ fileName, rows: rows.length }));
  });

  try {
    tx();
    return { ok: true, batchId, rows: rows.length };
  } catch (e) {
    console.error("saveBatch failed", e);
    return { ok: false, error: "فشل حفظ البيانات: " + e.message };
  }
}

module.exports = { parseExcel, saveBatch };
