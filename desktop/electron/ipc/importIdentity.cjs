const crypto = require("crypto");
const text = (v) => v == null ? null : String(v).trim() || null;
const number = (v) => v == null || v === "" ? null : Number(v);
function identity(month, snapshot, kind, rows, dates = {}) {
  const canonical = rows.map((row) => [
    row.month || month, text(row.item_code), text(row.item_name_ar), text(row.item_name_en),
    text(row.active_ingredient_ar), text(row.strength), text(row.dosage_form), text(row.unit),
    text(row.location), row.location_type === "main_store" ? "main_warehouse" : row.location_type,
    kind === "period_consumption" ? null : number(row.closing_balance ?? row.closing),
    ["monthly", "period_consumption"].includes(kind) ? number(row.issued_qty ?? row.issued) : null,
    number(row.opening_balance ?? row.opening ?? 0), number(row.received_qty ?? row.received ?? 0),
    number(row.unit_price), text(row.expiry_date), number(row.min_stock), number(row.max_stock), number(row.lead_time_days),
  ]).map(JSON.stringify).sort();
  return crypto.createHash("sha256").update(JSON.stringify([month, snapshot, kind, dates.issued_from||null,dates.issued_to||null,dates.received_from||null,dates.received_to||null,...(dates.snapshot_boundary?[dates.snapshot_boundary]:[]),canonical])).digest("hex");
}
module.exports = { identity };
