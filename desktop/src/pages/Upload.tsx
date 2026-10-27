import { previousMonth, numericValue, todayISO, validISODate } from "../../../shared/inventoryHistory";
import { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api, tokenStore } from "@/integrations/desktop/client";
import {
  Download, Upload as UploadIcon, FileSpreadsheet, AlertTriangle,
  CheckCircle2, Eye, Wand2, ClipboardPaste, FileDown, Pencil, X, Sparkles, Info,
} from "lucide-react";
import { ChevronLeft, ChevronRight, Save, FlaskConical } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

/* ============================================================
   Helpers: text normalization, numbers, dates, months.
   ============================================================ */
function normalize(s: any) {
  return (s == null ? "" : String(s))
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function toNum(v: any): number | null {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || s === "—" || s.startsWith("#")) return null;
  return numericValue(s);
}

function toISODate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().substring(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().substring(0, 10);
  }
  const s = String(v).trim();
  const m1 = s.match(/^(\d{4})[-\/](\d{1,2})(?:[-\/](\d{1,2}))?$/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2,"0")}-${(m1[3]||"01").padStart(2,"0")}`;
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2,"0")}-${m2[1].padStart(2,"0")}`;
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2.toISOString().substring(0, 10);
  return null;
}

function toMonth(v: any): string | null {
  const d = toISODate(v);
  return d ? d.substring(0, 8) + "01" : null;
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  const d = new Date(Date.UTC(year, monthNumber, 0));
  return d.toISOString().substring(0, 10);
}

/* Extract month from filename: "ديسمبر 2023", "December 2023", "2023-12", "12-2023" */
const AR_MONTHS: Record<string, number> = {
  "يناير":1,"فبراير":2,"مارس":3,"ابريل":4,"إبريل":4,"أبريل":4,"مايو":5,"يونيو":6,"يونية":6,
  "يوليو":7,"يولية":7,"اغسطس":8,"أغسطس":8,"سبتمبر":9,"اكتوبر":10,"أكتوبر":10,
  "نوفمبر":11,"ديسمبر":12,
};
const EN_MONTHS: Record<string, number> = {
  jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,
  jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12,
};
function extractMonthFromFilename(name: string): string | null {
  if (!name) return null;
  const n = normalize(name);
  // YYYY-MM or YYYY_MM or YYYY.MM
  const a = n.match(/(20\d{2})[-_\.\s]?(\d{1,2})/);
  if (a) return `${a[1]}-${a[2].padStart(2,"0")}-01`;
  const b = n.match(/(\d{1,2})[-_\.\s]?(20\d{2})/);
  if (b) return `${b[2]}-${b[1].padStart(2,"0")}-01`;
  for (const [k, m] of Object.entries(AR_MONTHS)) {
    const re = new RegExp(`${k}.{0,5}(20\\d{2})|(20\\d{2}).{0,5}${k}`);
    const mm = n.match(re);
    if (mm) return `${mm[1] || mm[2]}-${String(m).padStart(2,"0")}-01`;
  }
  for (const [k, m] of Object.entries(EN_MONTHS)) {
    const re = new RegExp(`${k}.{0,5}(20\\d{2})|(20\\d{2}).{0,5}${k}`);
    const mm = n.match(re);
    if (mm) return `${mm[1] || mm[2]}-${String(m).padStart(2,"0")}-01`;
  }
  return null;
}

type BatchKind = "monthly" | "weekly_update" | "full_snapshot" | "partial_update" | "period_consumption";

export function extractSnapshotDateFromWorkbook(wb: XLSX.WorkBook): string | null {
  for (const sheetName of wb.SheetNames.filter((name) => !isDuplicateSheetName(name))) {
    const ws = wb.Sheets[sheetName];
    const arr: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    for (const row of arr.slice(0, 18)) {
      for (const cell of row || []) {
        const text = cell == null ? "" : String(cell);
        const n = normalize(text);
        if (!n.includes("رصيد") && !n.includes("balance")) continue;
        const m = text.match(/(20\d{2}[\/\-]\d{1,2}(?:[\/\-]\d{1,2})?|\d{1,2}[\/\-]\d{1,2}[\/\-]20\d{2})/);
        const iso = m ? toISODate(m[1]) : null;
        if (iso) return iso;
      }
    }
  }
  return null;
}

/* Generate a temporary internal code from name + strength + form */
function genItemCode(name?: string | null, strength?: string | null, form?: string | null) {
  const parts = [name, strength, form].filter(Boolean).map((p) =>
    String(p).toUpperCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[^A-Z0-9\u0600-\u06FF]+/g, "_")
      .replace(/^_+|_+$/g, "")
  ).filter(Boolean);
  return parts.join("_").slice(0, 60) || null;
}

export function canonicalLocationName(name?: string | null): string {
  const raw = (name || "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  const n = normalize(raw).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  if (!n) return "غير محدد";
  if (/^(المخزن الرئيسي|مخزن رئيسي|main warehouse|main store)$/.test(n)) return "المخزن الرئيسي";
  const short = n.replace(/^صيدليه\s+/, "");
  if (/^(خارجي عيادات|العيادات الخارجيه|عيادات|العيادات)$/.test(short)) return "صيدلية العيادات الخارجية";
  const cancer = short.match(/^خارجي اورام\s*([اب])$/);
  if (cancer) return cancer[1] === "ا" ? "صيدلية خارجي أورام (أ)" : "صيدلية خارجي أورام (ب)";
  const internal = short.match(/^الداخلي\s*([abاب])$/);
  if (internal) return ["a", "ا"].includes(internal[1]) ? "صيدلية الداخلي A" : "صيدلية الداخلي B";
  const care = short.match(/^الرعايه\s*(\d+)$/);
  if (care) return `صيدلية الرعاية ${care[1]}`;
  const known: Record<string, string> = {
    "البيولوجي": "صيدلية البيولوجي", "العمليات": "صيدلية العمليات", "السادس": "صيدلية السادس",
    "القلب": "صيدلية القلب", "الزيرو": "صيدلية الزيرو",
    "التصلب العضلي ms": "صيدلية التصلب العضلي (MS)",
  };
  return known[short] || raw;
}

function isDuplicateSheetName(name: string): boolean {
  const n = normalize(name);
  return n.startsWith("copy of") || n.includes("نسخه") || n.includes("copy ");
}

/* ============================================================
   Junk row / header detection
   ============================================================ */
// Only reject pure decorative/title rows. Don't reject by data-content keywords
// (the previous list rejected real rows that happened to contain "تقرير" etc.).
const JUNK_TOKENS: string[] = [];
const HEADER_KEYWORDS = ["منصرف","رصيد","الاسم","العلمي","التجاري","الوحده","الوحدة","balance","consumption","dispens"];

function isJunkRow(row: any[]): boolean {
  const text = row.map((c) => normalize(c)).join(" ");
  if (!text.trim()) return true;
  if (JUNK_TOKENS.length && JUNK_TOKENS.some((j) => text.includes(normalize(j)))) return true;
  return false;
}

/* Find the real header row in a wide-format sheet */
function findHeaderRow(aoa: any[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const row = aoa[i] || [];
    const text = row.map((c) => normalize(c)).join(" | ");
    const hits = ["منصرف","رصيد","الاسم","balance","consumption"].filter((k) => text.includes(k)).length;
    if (hits >= 2) return i;
  }
  return 0;
}

/* ============================================================
   Wide → Long conversion
   For each "pharmacy" we expect two columns: منصرف + رصيد
   Either single-row header like "صيدلية العيادات منصرف"
   or two-row header where row N has pharmacy name (merged) and row N+1 has منصرف/رصيد.
   ============================================================ */
interface PharmacyCol { name: string; type: "sub_pharmacy" | "main_store"; issuedCol: number; balanceCol: number; }
interface MetaCols { itemName?: number; scientific?: number; trade?: number; unit?: number; strength?: number; form?: number; code?: number; }

export function detectStructure(aoa: any[][]): {
  headerRow: number; secondHeaderRow: number | null;
  meta: MetaCols; pharmacies: PharmacyCol[]; mainStoreCandidates: { col: number; label: string }[];
} {
  const maxCols = aoa.reduce((m, r) => Math.max(m, (r || []).length), 0);

  // Find the sub-header row: the row with many cells equal/containing منصرف/رصيد.
  let subRow = -1;
  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const cells = (aoa[i] || []).map((c) => normalize(c));
    const hits = cells.filter((c) =>
      c === "منصرف" || c === "صرف" || c === "رصيد" || c === "متاح" || c === "المنصرف" || c === "الرصيد"
    ).length;
    if (hits >= 4) { subRow = i; break; }
  }

  // Header rows: up to 6 rows above subRow (handles 1..4-row stacked headers).
  const headerStart = subRow >= 0 ? Math.max(0, subRow - 6) : 0;
  const headerEnd = subRow >= 0 ? subRow : Math.min(8, aoa.length);
  const headerRows: string[][] = [];
  for (let r = headerStart; r < headerEnd; r++) headerRows.push((aoa[r] || []).map((c) => normalize(c)));
  const sub: string[] = subRow >= 0 ? (aoa[subRow] || []).map((c) => normalize(c)) : [];

  const meta: MetaCols = {};
  for (let c = 0; c < maxCols; c++) {
    for (const hr of headerRows) {
      const cell = (hr[c] || "").trim();
      if (!cell) continue;
      if (meta.code == null && (cell.includes("كود") || cell === "code" || cell === "sku")) meta.code = c;
      if (meta.itemName == null && (cell.includes("اسم كما") || cell.includes("الاسم كما") || cell.includes("اسم الصنف") || cell.includes("اسم الدواء") || cell.includes("المنظومه") || cell.includes("المنظومة"))) meta.itemName = c;
      if (meta.scientific == null && (cell.includes("علمي") || cell.includes("scientific") || cell.includes("generic"))) meta.scientific = c;
      if (meta.trade == null && (cell.includes("تجاري") || cell.includes("trade") || cell.includes("brand"))) meta.trade = c;
      if (meta.unit == null && (cell === "الوحده" || cell.includes("الوحده") || cell === "unit" || cell === "uom")) meta.unit = c;
      if (meta.strength == null && (cell.includes("تركيز") || cell.includes("جرعه") || cell === "strength")) meta.strength = c;
      if (meta.form == null && (cell.includes("الشكل") || cell === "form" || cell.includes("dosage"))) meta.form = c;
    }
  }
  // Fallback for item name: any header cell with "اسم" but not علمي/تجاري.
  if (meta.itemName == null) {
    outer: for (let c = 0; c < maxCols; c++) {
      for (const hr of headerRows) {
        const cell = (hr[c] || "").trim();
        if (cell && cell.includes("اسم") && !cell.includes("علمي") && !cell.includes("تجاري")) { meta.itemName = c; break outer; }
      }
    }
  }

  const pharmacies: PharmacyCol[] = [];
  const mainStoreCandidates: { col: number; label: string }[] = [];

  if (subRow >= 0) {
    // Forward-fill each header row to recover merged-cell pharmacy names.
    const filledRows = headerRows.map((hr) => {
      const out = new Array<string>(maxCols).fill(""); let last = "";
      for (let i = 0; i < maxCols; i++) { const v = (hr[i] || "").trim(); if (v) last = v; out[i] = last; }
      return out;
    });
    const nameFor = (c: number): string => {
      let best = "";
      for (const fr of filledRows) {
        const v = (fr[c] || "").trim();
        if (!v) continue;
        if (/صيدليه|صيدلية|مخزن|warehouse|store/i.test(v) && v.length > best.length) best = v;
      }
      if (!best) for (const fr of filledRows) if (fr[c]) best = fr[c];
      return best;
    };

    const groups = new Map<string, { issued?: number; balance?: number }>();
    for (let c = 0; c < maxCols; c++) {
      const s = sub[c] || ""; if (!s) continue;
      const isIssued = s.includes("منصرف") || s.includes("صرف") || s.includes("dispens") || s.includes("consum");
      const isBalance = s.includes("رصيد") || s.includes("متاح") || s.includes("balance");
      if (!isIssued && !isBalance) continue;
      const name = nameFor(c) || `عمود ${c}`;
      const g = groups.get(name) || {};
      if (isIssued && g.issued == null) g.issued = c;
      if (isBalance && g.balance == null) g.balance = c;
      groups.set(name, g);
    }
    for (const [name, g] of groups) {
      const isMain = /مخزن|store|warehouse|رئيس/.test(name);
      if (isMain && g.balance != null && g.issued == null) {
        mainStoreCandidates.push({ col: g.balance, label: name });
      } else {
        pharmacies.push({ name, type: isMain ? "main_store" : "sub_pharmacy", issuedCol: g.issued ?? -1, balanceCol: g.balance ?? -1 });
      }
    }
  }

  // Recognize "رصيد شهر …" column as main-warehouse balance.
  for (let c = 0; c < maxCols; c++) {
    for (const hr of headerRows) {
      const cell = (hr[c] || "").trim();
      if (/^رصيد\s*(شهر|الشهر|نوفمبر|اكتوبر|ديسمبر|سبتمبر|اغسطس|يوليو|يونيو|مايو|ابريل|مارس|فبراير|يناير|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4})/.test(cell)) {
        if (!pharmacies.some((p) => p.balanceCol === c) && !mainStoreCandidates.some((m) => m.col === c)) {
          mainStoreCandidates.push({ col: c, label: cell });
        }
      }
    }
  }

  return { headerRow: headerStart, secondHeaderRow: subRow >= 0 ? subRow : null, meta, pharmacies, mainStoreCandidates };
}

/* ============================================================
   Canonical long row used for validation/commit
   ============================================================ */
interface CanonRow {
  _row: number;
  _sheet: string;
  _status?: "ready" | "review";
  _review_reasons?: string[];
  _suggestions?: SuggestionEntry[];
  _dup_count?: number;
  item_code?: string | null;
  item_name_ar?: string | null;
  item_name_en?: string | null;
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  unit?: string | null;
  location?: string | null;
  location_type?: "sub_pharmacy" | "main_store";
  month?: string | null;
  opening?: number | null; received?: number | null; issued?: number | null;
  transfer_in?: number | null; transfer_out?: number | null;
  returns?: number | null; closing?: number | null;
  unit_price?: number | null; expiry_date?: string | null;
  batch_no?: string | null; lead_time_days?: number | null;
}

/* Forward-fill suggestion entry */
export interface SuggestionEntry {
  field: string;        // human label e.g. "اسم النظام"
  fieldKey: string;     // stable key used for accept set
  original: string;     // original value in the file (or "—")
  suggested: string;    // value carried forward from previous row
  reason: string;       // explanation
}

export function buildLongRows(
  aoa: any[][], sheetName: string, struct: ReturnType<typeof detectStructure>,
  month: string | null, mainStoreColIdx: number | null,
  acceptedSuggestions: Set<string> = new Set(),
): { rows: CanonRow[]; skipped: number; junk: number; ignored: IgnoredRow[]; review: IgnoredRow[] } {
  const { headerRow, secondHeaderRow, meta, pharmacies } = struct;
  const dataStart = (secondHeaderRow ?? headerRow) + 1;
  const out: CanonRow[] = [];
  const ignored: IgnoredRow[] = [];
  const review: IgnoredRow[] = [];
  let skipped = 0, junk = 0;

  // Tokens that mark a row as a summary/separator/signature (truly ignorable).
  const SUMMARY_TOKENS = [
    "اجمالي","الاجمالي","المجموع","الإجمالي","total","grand total","sum","subtotal",
    "ملاحظات","توقيع","المسئول","المسؤول","signature","تم بحمد الله","انتهى",
  ].map((s) => normalize(s));

  // Last fully-known item context, used to forward-fill missing fields.
  type LastCtx = { systemName: string; scientificName: string; tradeName: string;
                   unit: string; strength: string; form: string; code: string };
  let lastCtx: LastCtx | null = null;

  for (let r = dataStart; r < aoa.length; r++) {
    const row = aoa[r] || [];
    if (isJunkRow(row)) {
      junk++;
      const text = row.map((c) => (c == null ? "" : String(c))).join(" | ").trim();
      ignored.push({ row: r + 1, sheet: sheetName, reason: text ? "صف عنوان أو معلومات غير بيانية" : "صف فارغ", preview: text.slice(0, 200) });
      continue;
    }
    const previewText = row.map((c) => (c == null ? "" : String(c))).join(" | ").slice(0, 200);

    const itemNameRaw = meta.itemName != null ? row[meta.itemName] : null;
    const scientificRaw = meta.scientific != null ? row[meta.scientific] : null;
    const tradeRaw = meta.trade != null ? row[meta.trade] : null;
    const systemName = itemNameRaw != null ? String(itemNameRaw).trim() : "";
    const scientificName = scientificRaw != null ? String(scientificRaw).trim() : "";
    const tradeName = tradeRaw != null ? String(tradeRaw).trim() : "";

    // Header-keyword row (e.g. duplicated header inside data).
    if (systemName && HEADER_KEYWORDS.some((k) => normalize(systemName) === k)) {
      junk++;
      ignored.push({ row: r + 1, sheet: sheetName, reason: "صف عناوين مكرر داخل البيانات", preview: previewText });
      continue;
    }

    // Summary / signature / separator row.
    const normName = normalize(systemName || scientificName || tradeName);
    if (normName && SUMMARY_TOKENS.some((tok) => normName === tok || normName.startsWith(tok + " "))) {
      junk++;
      ignored.push({ row: r + 1, sheet: sheetName, reason: "صف إجمالي / ملاحظات / توقيع", preview: previewText });
      continue;
    }

    // Detect whether this row carries any numeric data at all.
    let hasNumbers = false;
    for (const p of pharmacies) {
      if (p.issuedCol >= 0 && toNum(row[p.issuedCol]) != null) { hasNumbers = true; break; }
      if (p.balanceCol >= 0 && toNum(row[p.balanceCol]) != null) { hasNumbers = true; break; }
    }
    if (!hasNumbers && mainStoreColIdx != null && mainStoreColIdx >= 0 && toNum(row[mainStoreColIdx]) != null) {
      hasNumbers = true;
    }

    // Collect raw secondary fields.
    const unitRaw = meta.unit != null ? (row[meta.unit] ?? null) : null;
    const strengthRaw = meta.strength != null ? (row[meta.strength] ?? null) : null;
    const formRaw = meta.form != null ? (row[meta.form] ?? null) : null;
    const codeRaw = meta.code != null ? (row[meta.code] ?? null) : null;
    const unitStr = unitRaw ? String(unitRaw).trim() : "";
    const strengthStr = strengthRaw ? String(strengthRaw).trim() : "";
    const formStr = formRaw ? String(formRaw).trim() : "";
    const codeStr = codeRaw ? String(codeRaw).trim() : "";

    // Forward-fill: if row looks item-like (has trade/numbers/any name) but key fields
    // are missing, suggest values from the previous fully-known row.
    const rowIsItemLike = !!(tradeName || hasNumbers || systemName || scientificName);
    const suggestions: SuggestionEntry[] = [];
    const tryFill = (key: string, label: string, current: string, prev: string): string => {
      if (current || !prev) return current;
      const fieldKey = `${sheetName}|${r + 1}|${key}`;
      suggestions.push({ field: label, fieldKey, original: "—", suggested: prev,
        reason: "تم استكمال بياناته من الصف السابق — يحتاج مراجعة" });
      return acceptedSuggestions.has(fieldKey) ? prev : current;
    };

    let useSystem = systemName, useScientific = scientificName, useTrade = tradeName;
    let useUnit = unitStr, useStrength = strengthStr, useForm = formStr, useCode = codeStr;
    if (rowIsItemLike && lastCtx) {
      useSystem     = tryFill("systemName",     "اسم النظام",      useSystem,     lastCtx.systemName);
      useScientific = tryFill("scientificName", "الاسم العلمي",     useScientific, lastCtx.scientificName);
      useUnit       = tryFill("unit",           "الوحدة",           useUnit,       lastCtx.unit);
      useStrength   = tryFill("strength",       "التركيز",          useStrength,   lastCtx.strength);
      useForm       = tryFill("form",           "الشكل الصيدلي",    useForm,       lastCtx.form);
      // Don't auto-fill trade name from a previous row — it's the most volatile field.
    }

    // Priority for item name: system name → scientific → trade.
    let effectiveName = useSystem || useScientific || useTrade;
    const reviewReasons: string[] = [];

    if (!effectiveName) {
      if (!hasNumbers) {
        skipped++;
        ignored.push({ row: r + 1, sheet: sheetName, reason: "صف بدون اسم صنف ولا أرقام", preview: previewText });
        continue;
      }
      // Has data but name is missing → keep as needs-review.
      effectiveName = "(بدون اسم — يحتاج مراجعة)";
      reviewReasons.push("يوجد رصيد أو منصرف لكن اسم الصنف غير مكتمل");
    } else {
      if (!/[\p{L}]/u.test(effectiveName)) {
        if (!hasNumbers) {
          skipped++;
          ignored.push({ row: r + 1, sheet: sheetName, reason: "صف غير مفهوم (لا يحتوي أحرف)", preview: previewText });
          continue;
        }
        reviewReasons.push("اسم الصنف لا يحتوي أحرف — يحتاج مراجعة");
      }
      if (!useSystem && useScientific && !useTrade) {
        reviewReasons.push("اسم النظام غير مدوّن — استُخدم الاسم العلمي");
      } else if (!useSystem && !useScientific && useTrade) {
        reviewReasons.push("اسم النظام والاسم العلمي ناقصان — استُخدم الاسم التجاري");
      } else if (!useSystem && useScientific && useTrade) {
        reviewReasons.push("اسم النظام ناقص");
      } else if (useSystem && !useScientific && useTrade) {
        reviewReasons.push("الاسم العلمي ناقص لكن الاسم التجاري موجود");
      }
    }

    if (suggestions.length) {
      reviewReasons.push("تم استكمال بياناته من الصف السابق — يحتاج مراجعة");
    }

    if (!useUnit) reviewReasons.push("الوحدة غير محددة؛ يلزم تأكيدها قبل التجميع");
    const isReview = reviewReasons.length > 0;
    if (isReview) {
      review.push({
        row: r + 1, sheet: sheetName,
        reason: reviewReasons.join(" · "),
        preview: previewText,
        suggestions: suggestions.length ? suggestions : undefined,
      });
    }

    const scientific = useScientific || null;
    const trade = useTrade || null;
    const code = useCode || genItemCode([effectiveName, useTrade, useUnit].filter(Boolean).join(" "), useStrength, useForm);

    const base: Partial<CanonRow> = {
      _sheet: sheetName,
      _status: isReview ? "review" : "ready",
      _review_reasons: isReview ? reviewReasons : undefined,
      _suggestions: suggestions.length ? suggestions : undefined,
      item_code: code,
      item_name_ar: effectiveName,
      item_name_en: trade,
      active_ingredient: scientific,
      strength: useStrength || null,
      dosage_form: useForm || null,
      unit: useUnit || null,
      month,
    };

    // Update lastCtx whenever this row carries a real (non-suggested) item name.
    if (systemName || scientificName) {
      lastCtx = {
        systemName:     systemName     || lastCtx?.systemName     || "",
        scientificName: scientificName || lastCtx?.scientificName || "",
        tradeName:      tradeName      || lastCtx?.tradeName      || "",
        unit:           unitStr        || lastCtx?.unit           || "",
        strength:       strengthStr    || lastCtx?.strength       || "",
        form:           formStr        || lastCtx?.form           || "",
        code:           codeStr        || lastCtx?.code           || "",
      };
    }

    // Sub-pharmacies
    for (const p of pharmacies) {
      const issued = p.issuedCol >= 0 ? toNum(row[p.issuedCol]) : null;
      const closing = p.balanceCol >= 0 ? toNum(row[p.balanceCol]) : null;
      if (issued == null && closing == null) continue;
      out.push({
        ...(base as CanonRow), _row: r + 1,
        location: canonicalLocationName(p.name), location_type: p.type,
        issued, closing,
      });
    }
    // Main store column (explicit, only if user confirmed)
    if (mainStoreColIdx != null && mainStoreColIdx >= 0) {
      const closing = toNum(row[mainStoreColIdx]);
      if (closing != null) {
        out.push({
          ...(base as CanonRow), _row: r + 1,
          location: canonicalLocationName("المخزن الرئيسي"), location_type: "main_store",
          closing,
        });
      }
    }
  }
  // Detect items without any balance or issued numbers across all detected pharmacies
  const counted = new Set(out.map((r) => `${r._row}`));
  for (let r = dataStart; r < aoa.length; r++) {
    if (counted.has(`${r + 1}`)) continue;
    if (ignored.find((x) => x.row === r + 1)) continue;
    const row = aoa[r] || [];
    const itemName = meta.itemName != null ? row[meta.itemName] : null;
    const itemNameStr = itemName != null ? String(itemName).trim() : "";
    if (!itemNameStr) continue;
    ignored.push({ row: r + 1, sheet: sheetName, reason: "بدون رصيد ولا منصرف في أي صيدلية", preview: itemNameStr.slice(0, 200) });
  }
  return { rows: out, skipped, junk, ignored, review };
}

/* Aggregate duplicates (same month + item + location + type) */
export function aggregateDuplicates(rows: CanonRow[]): { rows: CanonRow[]; merged: number; duplicates: IgnoredRow[] } {
  const map = new Map<string, CanonRow>();
  const duplicates: IgnoredRow[] = [];
  let merged = 0;
  for (const r of rows) {
    const key = [r.month, r.item_code || r.item_name_ar, r.item_name_en, r.active_ingredient,
      r.strength, r.dosage_form, r.unit, r.location, r.location_type].map(normalize).join("|");
    const existing = map.get(key);
    if (!existing) { map.set(key, { ...r, _dup_count: 1 }); continue; }
    merged++;
    existing._dup_count = (existing._dup_count || 1) + 1;
    const fields = ["issued", "closing", "received", "opening", "transfer_in", "transfer_out", "returns"] as const;
    const identical = fields.every((field) => existing[field] === r[field]);
    if (!identical || r._status === "review") {
      existing._status = "review";
      existing._review_reasons = Array.from(new Set([...(existing._review_reasons || []),
        ...(r._review_reasons || []), "صفوف مكررة متعارضة؛ راجع الكميات، لم يتم جمع الأرصدة تلقائيًا"]));
    }
    duplicates.push({ row: r._row, sheet: r._sheet,
      reason: identical ? "نسخة مكررة مطابقة؛ احتُسبت مرة واحدة" : "تكرار متعارض يحتاج مراجعة؛ لم تجمع الكميات",
      preview: `${r.item_name_ar || ""} · ${r.location || ""} · رصيد ${r.closing ?? "غير مسجل"} · منصرف ${r.issued ?? "غير مسجل"}` });
  }
  return { rows: Array.from(map.values()), merged, duplicates };
}

/* Validate only the long rows. Junk/empty are already filtered out. */
interface RowIssue { row: number; type: string; message: string; severity: "high" | "medium" | "low"; }
interface IgnoredRow { row: number; sheet: string; reason: string; preview: string; suggestions?: SuggestionEntry[]; }
function validate(rows: CanonRow[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rows.forEach((r) => {
    const idx = r._row;
    if (!r.item_name_ar && !r.item_name_en && !r.item_code)
      issues.push({ row: idx, type: "missing_item", message: "لا يوجد اسم للصنف", severity: "high" });
    if (!r.location)
      issues.push({ row: idx, type: "missing_location", message: "الموقع/الصيدلية فارغ", severity: "high" });
    if (!r.month)
      issues.push({ row: idx, type: "missing_month", message: "الشهر غير محدد — اختر الشهر يدويًا أو من اسم الملف", severity: "high" });
    (["opening","received","issued","closing"] as const).forEach((f) => {
      const v = r[f] as number | null;
      if (v != null && v < 0) issues.push({ row: idx, type: "negative", message: `${f} قيمة سالبة`, severity: "medium" });
    });
  });
  return issues;
}

function downloadTemplate() {
  const headers = ["كود الصنف","الاسم العربي","الاسم العلمي","الاسم التجاري","التركيز","الشكل","الوحدة","الموقع","الشهر","رصيد افتتاحي","وارد","منصرف","رصيد ختامي"];
  const rows = [headers,
    ["PAR500","باراسيتامول 500","Paracetamol","Panadol","500mg","أقراص","قرص","صيدلية العيادات","2023-12-01",1000,500,300,1200],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "data");
  XLSX.writeFile(wb, "stock-template.xlsx");
}

/* ============================================================
   Component
   ============================================================ */
export default function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const canSaveData = true; // الصلاحية تُفرض في طبقة الحفظ المحلية (saveBatch)

  const [filename, setFilename] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [aoa, setAoa] = useState<any[][]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedBatch, setSavedBatch] = useState<{ id: string; rows: number; file: string; month: string } | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  // Wide-format controls
  const [manualMonth, setManualMonth] = useState<string>(""); // "YYYY-MM"
  const [mainStoreCol, setMainStoreCol] = useState<number | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"current" | "all">("all");
  const [snapshotDate, setSnapshotDate] = useState<string>(""); // "YYYY-MM-DD"
  const [batchKind, setBatchKind] = useState<BatchKind>(
    searchParams.get("kind") === "weekly" ? "weekly_update" : "monthly",
  );
  // Accepted forward-fill suggestions: keys like "sheet|row|field".
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set());
  function toggleSuggestion(key: string) {
    setAcceptedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function acceptAllSuggestions(keys: string[]) {
    setAcceptedSuggestions((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }

  // Per-row decisions on the review screen.
  const [rowDecisions, setRowDecisions] = useState<Map<string, "approve" | "ignore">>(new Map());
  const [rowEdits, setRowEdits] = useState<Map<string, Partial<CanonRow>>>(new Map());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  function rowKey(r: { _sheet: string; _row: number; location?: string | null; location_type?: string }) {
    return `${r._sheet}|${r._row}|${r.location || ""}|${r.location_type || ""}`;
  }
  function setDecision(key: string, dec: "approve" | "ignore" | null) {
    setRowDecisions((prev) => {
      const next = new Map(prev);
      if (dec === null) next.delete(key); else next.set(key, dec);
      return next;
    });
  }
  function patchEdit(key: string, patch: Partial<CanonRow>) {
    setRowEdits((prev) => {
      const next = new Map(prev);
      next.set(key, { ...(next.get(key) || {}), ...patch });
      return next;
    });
  }

  const struct = useMemo(() => (aoa.length ? detectStructure(aoa) : null), [aoa]);
  useEffect(() => {
    setMainStoreCol(struct?.mainStoreCandidates.length === 1 ? struct.mainStoreCandidates[0].col : null);
  }, [struct]);
  const importSheetNames = useMemo(() => sheetNames.filter((name) => !isDuplicateSheetName(name)), [sheetNames]);

  // Suggest month from filename when file loads
  useEffect(() => {
    if (filename && !manualMonth) {
      const m = extractMonthFromFilename(filename);
      if (m) setManualMonth(m.substring(0, 7));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  const effectiveMonth = manualMonth ? `${manualMonth}-01` : null;
  const effectiveSnapshot = snapshotDate || null;

  function setManualMonthAndSnapshot(value: string) {
    setManualMonth(value);
  }

  // Per-sheet processing for "all sheets" mode
  type SheetReport = {
    sheet: string;
    rows: CanonRow[];
    skipped: number;
    junk: number;
    ignored: IgnoredRow[];
    review: IgnoredRow[];
    itemCount: number;
    pharmacyCount: number;
    pharmacies: string[];
  };

  const sheetReports = useMemo<SheetReport[]>(() => {
    if (!workbook || analysisMode !== "all") return [];
    return importSheetNames.map((name) => {
      const ws = workbook.Sheets[name];
      const arr: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
      if (!arr.length) return { sheet: name, rows: [], skipped: 0, junk: 0, ignored: [], review: [], itemCount: 0, pharmacyCount: 0, pharmacies: [] };
      const st = detectStructure(arr);
      // Auto: when a single main-store candidate exists, accept it. Otherwise ignore.
      const autoMain = st.mainStoreCandidates.length === 1 ? st.mainStoreCandidates[0].col : null;
      const { rows, skipped, junk, ignored, review } = buildLongRows(arr, name, st, effectiveMonth, autoMain, acceptedSuggestions);
      const itemSet = new Set(rows.map((r) => normalize(r.item_name_ar || r.item_code)));
      return {
        sheet: name, rows, skipped, junk, ignored, review,
        itemCount: itemSet.size,
        pharmacyCount: new Set(st.pharmacies.map((p) => canonicalLocationName(p.name))).size,
        pharmacies: st.pharmacies.map((p) => canonicalLocationName(p.name)),
      };
    });
  }, [workbook, importSheetNames, analysisMode, effectiveMonth, acceptedSuggestions]);

  const built = useMemo(() => {
    if (analysisMode === "all") {
      const all = sheetReports.flatMap((s) => s.rows);
      const ignoredAll = sheetReports.flatMap((s) => s.ignored);
      const reviewAll = sheetReports.flatMap((s) => s.review);
      const skippedAll = sheetReports.reduce((a, b) => a + b.skipped, 0);
      const junkAll = sheetReports.reduce((a, b) => a + b.junk, 0);
      const { rows: dedup, merged, duplicates } = aggregateDuplicates(all);
      return { rows: dedup, skipped: skippedAll, junk: junkAll, merged, ignored: [...ignoredAll, ...duplicates], review: reviewAll };
    }
    if (!aoa.length || !struct) return { rows: [] as CanonRow[], skipped: 0, junk: 0, merged: 0, ignored: [] as IgnoredRow[], review: [] as IgnoredRow[] };
    const { rows, skipped, junk, ignored, review } = buildLongRows(aoa, activeSheet, struct, effectiveMonth, mainStoreCol, acceptedSuggestions);
    const { rows: dedup, merged, duplicates } = aggregateDuplicates(rows);
    return { rows: dedup, skipped, junk, merged, ignored: [...ignored, ...duplicates], review };
  }, [analysisMode, sheetReports, aoa, struct, activeSheet, effectiveMonth, mainStoreCol, acceptedSuggestions]);

  const issues = useMemo(() => validate(built.rows), [built.rows]);
  const high = issues.filter((i) => i.severity === "high").length;
  const med = issues.filter((i) => i.severity === "medium").length;
  const issuesByRow = useMemo(() => {
    const m = new Map<number, RowIssue[]>();
    issues.forEach((i) => { const arr = m.get(i.row) || []; arr.push(i); m.set(i.row, arr); });
    return m;
  }, [issues]);

  const pharmacyCount = struct?.pharmacies.length || 0;
  const itemCount = useMemo(() => new Set(built.rows.map((r) => normalize(r.item_name_ar || r.item_code))).size, [built.rows]);

  // Classification counts.
  const reviewCount = useMemo(() => built.rows.filter((r) => r._status === "review").length, [built.rows]);
  const readyCount = built.rows.length - reviewCount;
  const actuallyIgnoredCount = built.ignored.length;
  const totalDetectedRows = readyCount + reviewCount + actuallyIgnoredCount;
  const qualityPct = totalDetectedRows ? Math.round(((readyCount + reviewCount) / totalDetectedRows) * 100) : 0;

  function getQualityLabel(pct: number): { label: string; colorClass: string } {
    if (pct > 90) return { label: "ممتاز", colorClass: "text-success" };
    if (pct >= 75) return { label: "جيد", colorClass: "text-primary" };
    if (pct >= 50) return { label: "يحتاج مراجعة", colorClass: "text-warning" };
    return { label: "ضعيف", colorClass: "text-destructive" };
  }
  const qLabel = getQualityLabel(qualityPct);

  // Apply per-row edits to canon rows.
  const decoratedRows = useMemo(() => built.rows.map((r) => {
    const k = rowKey(r);
    return rowEdits.has(k) ? { ...r, ...rowEdits.get(k)! } : r;
  }), [built.rows, rowEdits]);

  // Classify a row into a status label for the review table.
  function rowStatusLabels(r: CanonRow): string[] {
    const labels: string[] = [];
    const k = rowKey(r);
    const dec = rowDecisions.get(k);
    if (dec === "ignore") labels.push("متجاهل فعليًا");
    else if (r._status === "review" && dec !== "approve") labels.push("يحتاج مراجعة");
    else labels.push("جاهز للحفظ");
    if ((r._dup_count || 0) > 1) labels.push("مكرر محتمل");
    if (!r.item_name_ar || r.item_name_ar.startsWith("(بدون اسم")) labels.push("اسم ناقص");
    if (!r.unit) labels.push("وحدة ناقصة");
    if ((r.issued ?? 0) === 0 && (r.closing ?? 0) === 0) labels.push("بيانات غير كافية");
    return labels;
  }

  // The three tabs.
  const tabReady = useMemo(() => decoratedRows.filter((r) => {
    const dec = rowDecisions.get(rowKey(r));
    if (dec === "ignore") return false;
    return r._status === "ready" || dec === "approve";
  }), [decoratedRows, rowDecisions]);
  const tabReview = useMemo(() => decoratedRows.filter((r) => {
    const dec = rowDecisions.get(rowKey(r));
    if (dec) return false;
    return r._status === "review";
  }), [decoratedRows, rowDecisions]);
  const tabIgnoredUser = useMemo(() => decoratedRows.filter((r) => rowDecisions.get(rowKey(r)) === "ignore"), [decoratedRows, rowDecisions]);

  // Auto-fix a single review row: accept all its suggestions, drop the placeholder name if no real name exists,
  // and mark as approved.
  function autoFixRow(r: CanonRow) {
    const k = rowKey(r);
    if (r._suggestions?.length) acceptAllSuggestions(r._suggestions.map((s) => s.fieldKey));
    if (r.item_name_ar?.startsWith("(بدون اسم") && (r.item_name_en || r.active_ingredient)) {
      patchEdit(k, { item_name_ar: r.active_ingredient || r.item_name_en || r.item_name_ar });
    }
    setDecision(k, "approve");
    toast.success("تم الإصلاح التلقائي");
  }

  function approveAllReady() {
    setRowDecisions((prev) => {
      const next = new Map(prev);
      decoratedRows.forEach((r) => {
        if (r._status === "ready" && !next.has(rowKey(r))) next.set(rowKey(r), "approve");
      });
      return next;
    });
    toast.success("تم اعتماد كل الصفوف الجاهزة");
  }

  function exportFullReport() {
    const wb = XLSX.utils.book_new();
    const headers = ["رقم الصف", "الورقة", "اسم النظام", "الاسم العلمي", "الاسم التجاري", "الوحدة", "الرصيد", "المنصرف", "الحالة", "السبب"];
    const reviewData = [headers, ...tabReview.map((r) => [
      r._row, r._sheet, r.item_name_ar || "", r.active_ingredient || "", r.item_name_en || "",
      r.unit || "", r.closing ?? 0, r.issued ?? 0, rowStatusLabels(r).join(" · "),
      r._review_reasons?.join(" · ") || "",
    ])];
    const readyData = [headers, ...tabReady.map((r) => [
      r._row, r._sheet, r.item_name_ar || "", r.active_ingredient || "", r.item_name_en || "",
      r.unit || "", r.closing ?? 0, r.issued ?? 0, "جاهز للحفظ", "",
    ])];
    const ignoredData = [["رقم الصف", "الورقة", "السبب", "محتوى مختصر"],
      ...built.ignored.map((r) => [r.row, r.sheet, r.reason, r.preview])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readyData),   "جاهز");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reviewData),  "يحتاج مراجعة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ignoredData), "متجاهل");
    XLSX.writeFile(wb, `import-review-${filename || "file"}.xlsx`);
  }

  function loadSheet(wb: XLSX.WorkBook, name: string) {
    const ws = wb.Sheets[name];
    const arr: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
    setAoa(arr);
    setActiveSheet(name);
    setMainStoreCol(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setFilename(f.name); setManualMonth(""); setSavedBatch(null);
    setAcceptedSuggestions(new Set()); setRowDecisions(new Map()); setRowEdits(new Map());
    setCurrentStep(1);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const detectedSnapshot = extractSnapshotDateFromWorkbook(wb);
    const monthFromName = extractMonthFromFilename(f.name);
    if (detectedSnapshot) setSnapshotDate(detectedSnapshot);
    else if (monthFromName) setSnapshotDate(lastDayOfMonth(monthFromName.substring(0, 7)));
    else setSnapshotDate("");
    if (detectedSnapshot) setManualMonth(previousMonth(detectedSnapshot));
    else if (monthFromName) setManualMonth(monthFromName.substring(0, 7));
    setWorkbook(wb);
    setSheetNames(wb.SheetNames);
    loadSheet(wb, wb.SheetNames.find((name) => !isDuplicateSheetName(name)) || wb.SheetNames[0]);
  }

  function importFromPaste() {
    const txt = pasteText.trim();
    if (!txt) return;
    const sep = txt.includes("\t") ? "\t" : ",";
    const wb = XLSX.read(txt, { type: "string", FS: sep });
    const detectedSnapshot = extractSnapshotDateFromWorkbook(wb);
    setSnapshotDate(detectedSnapshot || "");
    setManualMonth(detectedSnapshot ? previousMonth(detectedSnapshot) : "");
    if (detectedSnapshot) {
      setSnapshotDate(detectedSnapshot);
      setManualMonth(previousMonth(detectedSnapshot));
    }
    setAcceptedSuggestions(new Set()); setRowDecisions(new Map()); setRowEdits(new Map());
    setCurrentStep(1);
    setWorkbook(wb);
    setSheetNames(wb.SheetNames);
    setFilename("paste.csv");
    setSavedBatch(null);
    loadSheet(wb, wb.SheetNames[0]);
    setPasteOpen(false);
  }

  function reset() {
    setAoa([]); setFilename(""); setFile(null); setWorkbook(null);
    setSheetNames([]); setActiveSheet(""); setManualMonth(""); setMainStoreCol(null);
    setSavedBatch(null);
  }

  async function commit() {
    if (!tabReady.length) { toast.error("تم رفع ملف جديد لكن لا توجد صفوف محفوظة صالحة للتحليل. راجع شاشة مراجعة البيانات."); return; }
    if (high > 0) { toast.error(`أصلح ${high} مشكلة حرجة قبل الحفظ`); return; }
    if (!effectiveMonth) { toast.error("اختر الشهر قبل الحفظ"); return; }
    if (!effectiveSnapshot) { toast.error("اختر تاريخ الرصيد قبل الحفظ"); return; }
    if (!validISODate(effectiveSnapshot) || effectiveSnapshot > todayISO()) { toast.error("لا يمكن حفظ رصيد بتاريخ مستقبلي"); return; }
    if (analysisMode === "all" && workbook && importSheetNames.some((name) => detectStructure(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: null, raw: false }) as any[][]).mainStoreCandidates.length > 1)) {
      toast.error("يوجد أكثر من عمود محتمل للمخزن؛ اختر تحليل ورقة واحدة وحدد العمود قبل الحفظ"); return;
    }
    setBusy(true);
    try {
      const fileName = filename || "paste.csv";
      const rows = tabReady.map((r) => {
        const isMain = r.location_type === "main_store";
        return {
          item_code: r.item_code || null,
          item_name_ar: r.item_name_ar || r.item_name_en || "",
          item_name_en: r.item_name_en || null,
          active_ingredient_ar: r.active_ingredient || null,
          strength: r.strength || null,
          dosage_form: r.dosage_form || null,
          unit: r.unit || null,
          location: isMain ? "المخزن الرئيسي" : canonicalLocationName(r.location || "غير محدد"),
          location_type: (isMain ? "main_store" : "sub_pharmacy") as "main_store" | "sub_pharmacy",
          month: (r.month || effectiveMonth) as string,
          issued_qty: batchKind === "monthly" || batchKind === "period_consumption" ? r.issued ?? null : null,
          closing_balance: batchKind === "period_consumption" ? null : r.closing ?? null,
        };
      });
      const res = await api.upload.saveBatch({
        token: tokenStore.get(),
        fileName,
        month: effectiveMonth,
        rows,
        ignored: built.skipped + built.junk + tabIgnoredUser.length,
        snapshotDate: effectiveSnapshot,
        batchKind,
      });
      if (!res || !res.ok) throw new Error((res && res.error) || "فشل حفظ البيانات");
      queryClient.invalidateQueries();
      const savedRows = res.rows ?? rows.length;
      setSavedBatch({ id: res.batchId, rows: savedRows, file: fileName, month: effectiveMonth });
      toast.success(`تم حفظ ${savedRows} صف بنجاح في قاعدة البيانات`);
    } catch (e: unknown) {
      console.error("commit() failed:", e);
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally { setBusy(false); }
  }

  function exportIgnoredToExcel() {
    if (!built.ignored.length) { toast.info("لا توجد صفوف متجاهلة"); return; }
    const data = [
      ["رقم الصف", "الورقة", "السبب", "محتوى مختصر"],
      ...built.ignored.map((r) => [r.row, r.sheet, r.reason, r.preview]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ignored");
    XLSX.writeFile(wb, `ignored-rows-${filename || "file"}.xlsx`);
  }

  const filenameMonth = filename ? extractMonthFromFilename(filename) : null;

  // ------------------- Wizard (5 steps) -------------------
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  // قاموس المواد الفعالة يُدار في طبقة الحفظ المحلية؛ لا يوجد عدّاد مراجعة في نسخة سطح المكتب.
  const [dictReviewCount] = useState<number | null>(null);

  const STEPS = [
    { n: 1, label: "اختيار الملف" },
    { n: 2, label: "قراءة الملف" },
    { n: 3, label: "مراجعة البيانات" },
    { n: 4, label: "مطابقة الأصناف" },
    { n: 5, label: "حفظ البيانات" },
  ] as const;

  const canGoNext =
    currentStep === 1 ? (aoa.length > 0 && !!effectiveMonth) :
    currentStep === 2 ? (built.rows.length > 0) :
    currentStep === 3 ? true :
    currentStep === 4 ? true :
    false;

  function goNext() {
    if (currentStep < 5) setCurrentStep((s) => (s + 1) as any);
  }
  function goPrev() {
    if (currentStep > 1) setCurrentStep((s) => (s - 1) as any);
  }

  function Stepper() {
    return (
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {STEPS.map((s, i) => {
            const active = currentStep === s.n;
            const done = currentStep > s.n;
            return (
              <div key={s.n} className="flex items-center gap-2 flex-1 min-w-[140px]">
                <button
                  type="button"
                  onClick={() => { if (done || active) setCurrentStep(s.n); }}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition ${
                    active ? "bg-primary text-primary-foreground" :
                    done ? "bg-success/20 text-success" :
                    "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : s.n}
                </button>
                <div className={`text-xs font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</div>
                {i < STEPS.length - 1 && <div className="flex-1 h-[2px] bg-border" />}
              </div>
            );
          })}
        </div>
      </Card>
    );
  }

  function WizardNav({ extra }: { extra?: React.ReactNode }) {
    return (
      <Card className="p-3 mb-4 flex items-center justify-between gap-2 flex-wrap">
        <Button variant="outline" onClick={goPrev} disabled={currentStep === 1}>
          <ChevronRight className="w-4 h-4" /> السابق
        </Button>
        <div className="text-xs text-muted-foreground">الخطوة {currentStep} من 5</div>
        <div className="flex gap-2">
          {extra}
          {currentStep < 5 && (
            <Button onClick={goNext} disabled={!canGoNext}>
              التالي <ChevronLeft className="w-4 h-4" />
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title="رفع البيانات"
        description="ارفع ملف Excel/CSV من المستشفى. يدعم تلقائيًا الشكل العريض (Wide Format) حيث الصيدليات أعمدة."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="w-4 h-4" /> قالب
            </Button>
            <Button variant="outline" onClick={() => setPasteOpen((s) => !s)}>
              <ClipboardPaste className="w-4 h-4" /> لصق من Google Sheets
            </Button>
          </div>
        }
      />

      {pasteOpen && (
        <Card className="p-5 mb-4">
          <div className="text-sm font-medium mb-2">الصق المحتوى:</div>
          <Textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} dir="ltr" className="font-mono text-xs" />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => { setPasteOpen(false); setPasteText(""); }}>إلغاء</Button>
            <Button size="sm" onClick={importFromPaste} disabled={!pasteText.trim()}><Wand2 className="w-4 h-4" /> تحليل</Button>
          </div>
        </Card>
      )}

      <Stepper />

      {currentStep === 1 && (
      <Card className="p-6 mb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="font-semibold mb-1">اختر ملف Excel أو CSV</div>
            <div className="text-xs text-muted-foreground">سيتم تجاهل صفوف العناوين والصفوف الفارغة تلقائيًا.</div>
          </div>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="max-w-xs" />
        </div>

        {sheetNames.length > 1 && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-muted-foreground">نطاق التحليل:</span>
              <button onClick={() => setAnalysisMode("current")}
                className={`px-3 py-1 rounded text-xs border ${analysisMode === "current" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                تحليل الشيت الحالي
              </button>
              <button onClick={() => setAnalysisMode("all")}
                className={`px-3 py-1 rounded text-xs border ${analysisMode === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                تحليل كل الشيتات ({importSheetNames.length})
              </button>
            </div>
            {analysisMode === "current" && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="text-muted-foreground">الورقة:</span>
                {sheetNames.map((n) => (
                  <button key={n} onClick={() => workbook && loadSheet(workbook, n)}
                    className={`px-3 py-1 rounded text-xs border ${activeSheet === n ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
                    {n}
                  </button>
                ))}
              </div>
            )}
            {analysisMode === "all" && (
              <div className="text-xs text-muted-foreground">
                سيتم قراءة كل أوراق العمل وتحويل كل ورقة من Wide إلى Long، مع حفظ <code>source_sheet</code> لكل صف، ودمج كل النتائج داخل دفعة رفع واحدة.
              </div>
            )}
          </div>
        )}
      </Card>
      )}

      {aoa.length > 0 && struct && (
        <>
          {/* Month picker */}
          {currentStep === 1 && (
          <Card className="p-5 mb-4">
            <div className="font-bold mb-2">شهر المنصرف (مستقل عن تاريخ الرصيد)</div>
            <p className="text-xs text-muted-foreground mb-3">الاقتراح الافتراضي هو الشهر السابق لتاريخ الرصيد. راجعه وعدله إذا كان الملف يخص فترة مختلفة.</p>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <Input type="month" value={manualMonth} onChange={(e) => setManualMonthAndSnapshot(e.target.value)} className="max-w-[180px]" />
              {filenameMonth && (
                <span className="text-xs text-muted-foreground">
                  مقترح من اسم الملف: <b>{filenameMonth.substring(0, 7)}</b>
                  <Button variant="link" size="sm" onClick={() => setManualMonthAndSnapshot(filenameMonth.substring(0, 7))}>استخدم</Button>
                </span>
              )}
              {!manualMonth && <span className="text-warning text-xs">⚠ اختر الشهر — لا يمكن الحفظ بدونه.</span>}
            </div>
            <div className="flex items-center gap-3 flex-wrap text-sm mt-3 pt-3 border-t">
              <label className="flex items-center gap-2">
                <span>تاريخ الرصيد (snapshot):</span>
                <Input
                  type="date"
                  value={snapshotDate}
                  onChange={(e) => setSnapshotDate(e.target.value)}
                  className="max-w-[180px]"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>نوع الرفع:</span>
                <select
                  value={batchKind}
                  onChange={(e) => setBatchKind(e.target.value as BatchKind)}
                  className="border rounded-md px-2 py-1 bg-background"
                >
                  <option value="monthly">ملف شهري كامل</option>
                  <option value="full_snapshot">رصيد كامل في تاريخ محدد</option>
                  <option value="partial_update">تحديث جزئي لبعض الأصناف</option>
                  <option value="period_consumption">منصرف فترة فقط</option>
                  <option value="weekly_update">تحديث أسبوعي / منتصف الشهر</option>
                </select>
              </label>
              <span className="text-xs text-muted-foreground">
                تاريخ الرصيد إلزامي ومستقل. تحديث الرصيد لا يضيف شهر استهلاك جديدًا. المنصرف لفترة فقط لا يغيّر الرصيد.
              </span>
            </div>
          </Card>
          )}

          {/* Main store column confirmation */}
          {currentStep === 1 && analysisMode === "current" && struct.mainStoreCandidates.length > 0 && (
            <Card className="p-5 mb-4">
              {struct.mainStoreCandidates.length === 1 ? (
                <>
                  <div className="font-bold mb-1">
                    هل عمود «{struct.mainStoreCandidates[0].label}» يمثل رصيد المخزن الرئيسي؟
                  </div>
                  <div className="text-xs text-muted-foreground mb-3">
                    إذا اخترت "نعم" سيتم حساب تغطية المخزن الرئيسي وإجمالي المستشفى. إذا اخترت "لا" سيتم تحليل الصيدليات الفرعية فقط.
                  </div>
                  <div className="flex gap-2 text-sm">
                    <Button
                      size="sm"
                      variant={mainStoreCol === struct.mainStoreCandidates[0].col ? "default" : "outline"}
                      onClick={() => setMainStoreCol(struct.mainStoreCandidates[0].col)}
                    >
                      نعم — اعتبره رصيد المخزن الرئيسي
                    </Button>
                    <Button
                      size="sm"
                      variant={mainStoreCol === null ? "default" : "outline"}
                      onClick={() => setMainStoreCol(null)}
                    >
                      لا — تجاهل هذا العمود
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-bold mb-2">أيٌّ من هذه الأعمدة يمثل رصيد المخزن الرئيسي؟</div>
                  <div className="flex flex-col gap-2 text-sm">
                    {struct.mainStoreCandidates.map((c) => (
                      <label key={c.col} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="mainStore"
                          checked={mainStoreCol === c.col}
                          onChange={() => setMainStoreCol(c.col)}
                        />
                        <span>{c.label}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="mainStore"
                        checked={mainStoreCol === null}
                        onChange={() => setMainStoreCol(null)}
                      />
                      <span>لا — لا يوجد عمود مخزن رئيسي</span>
                    </label>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* Per-sheet summary (all-sheets mode) */}
          {currentStep === 2 && analysisMode === "all" && sheetReports.length > 0 && (
            <Card className="p-5 mb-4">
              <div className="font-bold mb-3">ملخص كل ورقة عمل</div>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="text-right p-2">الورقة</th>
                      <th className="text-right p-2">أصناف</th>
                      <th className="text-right p-2">صيدليات</th>
                      <th className="text-right p-2">صفوف للحفظ</th>
                      <th className="text-right p-2">صفوف متجاهلة</th>
                      <th className="text-right p-2">مشاكل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetReports.map((s) => {
                      const noData = s.rows.length === 0;
                      return (
                        <tr key={s.sheet} className="border-b border-border/40">
                          <td className="p-2 font-medium">{s.sheet}</td>
                          <td className="p-2">{s.itemCount}</td>
                          <td className="p-2">{s.pharmacyCount}</td>
                          <td className="p-2 text-success">{s.rows.length}</td>
                          <td className="p-2">{s.skipped + s.junk}</td>
                          <td className="p-2 text-destructive">{noData ? "لم يُكتشف هيكل بيانات" : (s.ignored.length > s.rows.length ? "راجع الصفوف المتجاهلة" : "—")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* File Quality Card */}
          {currentStep === 2 && (
          <Card className="p-5 mb-4 border-2 border-primary/15">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <div className="font-bold text-lg">جودة الملف</div>
                  <div className="text-xs text-muted-foreground">ملخص تحليل البيانات المستخرجة من الملف</div>
                </div>
              </div>
              <div dir="ltr" className="text-left">
                <div className="text-4xl font-bold text-primary">{qualityPct}%</div>
                <div className={`text-sm font-semibold ${qLabel.colorClass}`}>{qLabel.label}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">إجمالي الصفوف المقروءة</div>
                <div className="text-xl font-bold">{totalDetectedRows}</div>
              </div>
              <div className="bg-success/10 rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">الصفوف الجاهزة للحفظ</div>
                <div className="text-xl font-bold text-success">{readyCount}</div>
              </div>
              <div className="bg-warning/10 rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">يحتاج مراجعة</div>
                <div className="text-xl font-bold text-warning">{reviewCount}</div>
                <div className="text-[10px] text-warning mt-1">قابل للإصلاح ✓</div>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground mb-1">متجاهل فعليًا</div>
                <div className="text-xl font-bold text-muted-foreground">{actuallyIgnoredCount}</div>
              </div>
            </div>

            {(actuallyIgnoredCount > 0 || reviewCount > 0) && (
              <div className="bg-primary/5 border border-primary/10 rounded-lg p-3 mb-4 text-sm">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    تم تجاهل <b>{actuallyIgnoredCount}</b> صفًا فقط فعليًا.
                    {reviewCount > 0 && (
                      <> يوجد <b>{reviewCount}</b> صفًا يحتاج مراجعة و<span className="text-success font-medium">يمكن إصلاحه</span> قبل الحفظ.</>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {reviewCount > 0 && (
                <Button
                  onClick={() => setCurrentStep(3)}
                >
                  <Eye className="w-4 h-4" /> مراجعة الصفوف الآن
                </Button>
              )}
              <Button variant="outline" onClick={() => setCurrentStep(5)} disabled={!tabReady.length}>
                <Save className="w-4 h-4" /> الانتقال إلى الحفظ ({tabReady.length})
              </Button>
            </div>
          </Card>
          )}

          {/* Detected pharmacies (current sheet only) */}
          {currentStep === 2 && analysisMode === "current" && (
          <Card className="p-5 mb-4">
            <div className="font-bold mb-2">الصيدليات المُكتشفة من رؤوس الأعمدة</div>
            <div className="flex flex-wrap gap-2">
              {struct.pharmacies.map((p) => (
                <span key={p.name} className="px-3 py-1 rounded-full bg-primary-soft text-primary text-xs">
                  {p.name} {p.issuedCol < 0 && "(بدون منصرف)"} {p.balanceCol < 0 && "(بدون رصيد)"}
                </span>
              ))}
              {!struct.pharmacies.length && <span className="text-xs text-muted-foreground">لم يتم اكتشاف صيدليات. تأكد أن الأعمدة تحتوي "منصرف" و"رصيد".</span>}
            </div>
          </Card>
          )}

          {/* Pre-save review screen with 3 tabs */}
          {currentStep === 3 && (
          <Card className="p-5 mb-4" id="review-section">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="font-bold text-lg">شاشة المراجعة قبل الحفظ</div>
                <div className="text-xs text-muted-foreground">راجع كل صف قبل الحفظ. لن يُحفظ شيء حتى تضغط زر الحفظ بالأسفل.</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={approveAllReady}>
                  <CheckCircle2 className="w-4 h-4" /> اعتماد كل الصفوف الجاهزة
                </Button>
                <Button variant="outline" size="sm" onClick={exportFullReport}>
                  <FileDown className="w-4 h-4" /> تحميل تقرير مشاكل الاستيراد Excel
                </Button>
              </div>
            </div>

            <Tabs defaultValue="ready">
              <TabsList>
                <TabsTrigger value="ready">جاهز للحفظ ({tabReady.length})</TabsTrigger>
                <TabsTrigger value="review">يحتاج مراجعة ({tabReview.length})</TabsTrigger>
                <TabsTrigger value="ignored">متجاهل فعليًا ({built.ignored.length + tabIgnoredUser.length})</TabsTrigger>
              </TabsList>

              {/* READY TAB */}
              <TabsContent value="ready">
                <ReviewTable
                  rows={tabReady}
                  emptyMsg="لا توجد صفوف جاهزة بعد."
                  rowStatusLabels={rowStatusLabels}
                  acceptedSuggestions={acceptedSuggestions}
                  editingKey={editingKey}
                  setEditingKey={setEditingKey}
                  rowKey={rowKey}
                  patchEdit={patchEdit}
                  rowDecisions={rowDecisions}
                  setDecision={setDecision}
                  showActions
                />
              </TabsContent>

              {/* REVIEW TAB */}
              <TabsContent value="review">
                <ReviewTable
                  rows={tabReview}
                  emptyMsg="لا توجد صفوف تحتاج مراجعة. 🎉"
                  rowStatusLabels={rowStatusLabels}
                  acceptedSuggestions={acceptedSuggestions}
                  editingKey={editingKey}
                  setEditingKey={setEditingKey}
                  rowKey={rowKey}
                  patchEdit={patchEdit}
                  rowDecisions={rowDecisions}
                  setDecision={setDecision}
                  onAutoFix={autoFixRow}
                  onToggleSuggestion={toggleSuggestion}
                  showActions
                />
              </TabsContent>

              {/* IGNORED TAB */}
              <TabsContent value="ignored">
                <div className="overflow-auto max-h-96 border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border sticky top-0 bg-background">
                      <tr>
                        <th className="text-right p-2">#</th>
                        <th className="text-right p-2">الورقة</th>
                        <th className="text-right p-2">السبب</th>
                        <th className="text-right p-2">محتوى مختصر</th>
                        <th className="text-right p-2">الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {built.ignored.slice(0, 500).map((r, i) => (
                        <tr key={`s-${i}`} className="border-b border-border/40">
                          <td className="p-2">{r.row}</td>
                          <td className="p-2">{r.sheet}</td>
                          <td className="p-2 text-muted-foreground">{r.reason}</td>
                          <td className="p-2 text-muted-foreground">{r.preview}</td>
                          <td className="p-2 text-muted-foreground text-[10px]">تلقائي</td>
                        </tr>
                      ))}
                      {tabIgnoredUser.map((r, i) => {
                        const k = rowKey(r);
                        return (
                          <tr key={`u-${i}`} className="border-b border-border/40 bg-muted/30">
                            <td className="p-2">{r._row}</td>
                            <td className="p-2">{r._sheet}</td>
                            <td className="p-2 text-muted-foreground">تم تجاهله يدويًا</td>
                            <td className="p-2 text-muted-foreground">{r.item_name_ar || ""} · {r.location || ""}</td>
                            <td className="p-2">
                              <Button size="sm" variant="outline" onClick={() => setDecision(k, null)}>إعادة</Button>
                            </td>
                          </tr>
                        );
                      })}
                      {!built.ignored.length && !tabIgnoredUser.length && (
                        <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد صفوف متجاهلة.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </Card>
          )}

          {currentStep === 3 && (high + med) > 0 && (
            <Card className="p-5 mb-4">
              <h2 className="font-bold mb-3">المشاكل ({high + med})</h2>
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b border-border">
                    <tr><th className="text-right p-2">الصف</th><th className="text-right p-2">المشكلة</th><th className="text-right p-2">الخطورة</th></tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 300).map((iss, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="p-2">{iss.row}</td>
                        <td className="p-2">{iss.message}</td>
                        <td className="p-2">
                          <span className={iss.severity === "high" ? "status-danger" : "status-warning"}>
                            {iss.severity === "high" ? "حرجة" : "متوسطة"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {currentStep === 4 && (
            <Card className="p-5 mb-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <FlaskConical className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-lg">مطابقة الأصناف بالمواد الفعالة</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    قبل الحفظ، تأكد من أن الأصناف الجديدة سيتم ربطها بمجموعاتها العلاجية بشكل صحيح.
                    الأصناف ذات الثقة المنخفضة ستُضاف للمراجعة تلقائيًا بعد الحفظ.
                  </div>
                </div>
              </div>
              {dictReviewCount !== null && (
                <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 text-sm mb-3">
                  يوجد حاليًا <b>{dictReviewCount}</b> صنف في قاموس المواد الفعالة يحتاج مراجعة مطابقة.
                  راجعها بعد الحفظ لضمان صحة التحليل حسب المجموعة العلاجية.
                </div>
              )}
              <div className="text-xs text-muted-foreground mb-3">
                سيتم استخراج المادة الفعالة والتركيز والشكل الدوائي تلقائيًا من <b>{tabReady.length}</b> صف معتمد عند الحفظ.
              </div>
              <Button variant="outline" onClick={() => navigate("/active-ingredients")}>
                <FlaskConical className="w-4 h-4" /> فتح قاموس المواد الفعالة
              </Button>
            </Card>
          )}

          {currentStep === 5 && savedBatch && (
            <Card className="p-4 mb-4 border-primary/30 bg-primary-soft/40">
              <div className="font-semibold text-primary mb-1 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> تم حفظ البيانات بنجاح
              </div>
              <div className="text-xs text-muted-foreground mb-3 leading-6">
                <div>اسم الملف: <b>{savedBatch.file}</b></div>
                <div>النطاق المحفوظ: <b>{analysisMode === "all" ? `كل الشيتات (${importSheetNames.length})` : `شيت واحد فقط: ${activeSheet}`}</b></div>
                <div>الشهر: <b>{savedBatch.month.substring(0, 7)}</b></div>
                <div>عدد الصفوف المحفوظة: <b>{savedBatch.rows}</b></div>
              </div>
              <div className="text-sm font-semibold mb-2">ماذا تريد أن تفعل الآن؟</div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => navigate("/daily")}>افتح مركز العمل اليومي</Button>
                <Button variant="outline" onClick={() => navigate(`/items?batch=${savedBatch.id}`)}>تحليل الأصناف</Button>
                <Button variant="outline" onClick={() => navigate("/active-ingredients")}>
                  <FlaskConical className="w-4 h-4" /> مراجعة المطابقة
                </Button>
                <Button variant="outline" onClick={exportFullReport}>
                  <FileDown className="w-4 h-4" /> تحميل تقرير مشاكل الملف
                </Button>
              </div>
            </Card>
          )}

          {currentStep === 5 && !savedBatch && (
          <Card className="p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm">
              {canSaveData ? (
                <span className="text-muted-foreground">جاهز للحفظ: <b>{tabReady.length}</b> صف معتمد سيتم حفظه في قاعدة البيانات.</span>
              ) : (
                <span className="text-destructive">ليس لديك صلاحية حفظ البيانات. اطلب من مدير النظام رفع صلاحيتك.</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCurrentStep(3)}>مراجعة المشاكل</Button>
              <Button onClick={commit} disabled={busy || high > 0 || !tabReady.length || !canSaveData || !!savedBatch}>
                <Save className="w-4 h-4" /> {busy ? "جارٍ الحفظ..." : `حفظ البيانات (${tabReady.length})`}
              </Button>
            </div>
          </Card>
          )}

          {currentStep >= 2 && built.merged > 0 && (
            <div className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> تم دمج {built.merged} صف مكرر (نفس الصنف/الصيدلية/الشهر) تلقائيًا.
            </div>
          )}
          {currentStep >= 2 && (built.junk + built.skipped) > 0 && (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Eye className="w-4 h-4" /> تم تجاهل {built.junk} صف عناوين/إجمالي/فارغ و {built.skipped} صف بدون اسم ولا أرقام. الصفوف ذات الاسم الناقص لكن بها أرقام نُقلت إلى "يحتاج مراجعة".
            </div>
          )}

          <WizardNav />
        </>
      )}

      {!aoa.length && (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
          ارفع ملف Excel للبدء. النظام يتعرف تلقائيًا على الشكل العريض ويُحوّله إلى الشكل الطولي.
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   Review table (shared between Ready / Review tabs)
   ============================================================ */
interface ReviewTableProps {
  rows: CanonRow[];
  emptyMsg: string;
  rowStatusLabels: (r: CanonRow) => string[];
  acceptedSuggestions: Set<string>;
  editingKey: string | null;
  setEditingKey: (k: string | null) => void;
  rowKey: (r: CanonRow) => string;
  patchEdit: (key: string, patch: Partial<CanonRow>) => void;
  rowDecisions: Map<string, "approve" | "ignore">;
  setDecision: (key: string, dec: "approve" | "ignore" | null) => void;
  onAutoFix?: (r: CanonRow) => void;
  onToggleSuggestion?: (k: string) => void;
  showActions?: boolean;
}
function ReviewTable({
  rows, emptyMsg, rowStatusLabels, acceptedSuggestions, editingKey, setEditingKey,
  rowKey, patchEdit, rowDecisions, setDecision, onAutoFix, onToggleSuggestion, showActions,
}: ReviewTableProps) {
  if (!rows.length) {
    return <div className="p-8 text-center text-muted-foreground text-sm">{emptyMsg}</div>;
  }
  return (
    <div className="overflow-auto max-h-[600px] border border-border rounded-lg">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground border-b border-border sticky top-0 bg-background z-10">
          <tr>
            <th className="text-right p-2">#</th>
            <th className="text-right p-2">الشيت</th>
            <th className="text-right p-2">اسم النظام</th>
            <th className="text-right p-2">الاسم العلمي</th>
            <th className="text-right p-2">الاسم التجاري</th>
            <th className="text-right p-2">الوحدة</th>
            <th className="text-right p-2">الرصيد</th>
            <th className="text-right p-2">المنصرف</th>
            <th className="text-right p-2">الحالة</th>
            <th className="text-right p-2">السبب / الإجراء المقترح</th>
            {showActions && <th className="text-right p-2">إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r) => {
            const k = rowKey(r);
            const editing = editingKey === k;
            const labels = rowStatusLabels(r);
            const decision = rowDecisions.get(k);
            const isReview = r._status === "review" && !decision;
            const labelColor = (l: string) =>
              l === "جاهز للحفظ" ? "bg-success/15 text-success" :
              l === "يحتاج مراجعة" ? "bg-warning/15 text-warning" :
              l === "متجاهل فعليًا" ? "bg-muted text-muted-foreground" :
              l === "مكرر محتمل" ? "bg-primary/10 text-primary" :
              "bg-destructive/10 text-destructive";
            return (
              <tr key={k} className={`border-b border-border/40 align-top ${isReview ? "bg-warning/5" : ""}`}>
                <td className="p-2 text-muted-foreground">{r._row}</td>
                <td className="p-2 text-muted-foreground">{r._sheet}</td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs" defaultValue={r.item_name_ar || ""} onBlur={(e) => patchEdit(k, { item_name_ar: e.target.value })} />
                  ) : (r.item_name_ar || "—")}
                </td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs" defaultValue={r.active_ingredient || ""} onBlur={(e) => patchEdit(k, { active_ingredient: e.target.value })} />
                  ) : (r.active_ingredient || "—")}
                </td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs" defaultValue={r.item_name_en || ""} onBlur={(e) => patchEdit(k, { item_name_en: e.target.value })} />
                  ) : (r.item_name_en || "—")}
                </td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs w-16" defaultValue={r.unit || ""} onBlur={(e) => patchEdit(k, { unit: e.target.value })} />
                  ) : (r.unit || "—")}
                </td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs w-20" type="number" defaultValue={r.closing ?? 0} onBlur={(e) => patchEdit(k, { closing: Number(e.target.value) })} />
                  ) : (r.closing ?? "—")}
                </td>
                <td className="p-2">
                  {editing ? (
                    <Input className="h-7 text-xs w-20" type="number" defaultValue={r.issued ?? 0} onBlur={(e) => patchEdit(k, { issued: Number(e.target.value) })} />
                  ) : (r.issued ?? "—")}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {labels.map((l) => (
                      <span key={l} className={`px-2 py-0.5 rounded-full text-[10px] ${labelColor(l)}`}>{l}</span>
                    ))}
                  </div>
                </td>
                <td className="p-2 min-w-[220px]">
                  {r._review_reasons?.length ? (
                    <div className="text-warning text-[11px] mb-1">{r._review_reasons.join(" · ")}</div>
                  ) : null}
                  {r._suggestions?.length ? (
                    <div className="space-y-1">
                      {r._suggestions.map((s) => {
                        const accepted = acceptedSuggestions.has(s.fieldKey);
                        return (
                          <div key={s.fieldKey} className="flex items-center justify-between gap-2 border border-border/60 rounded px-2 py-1 text-[11px]">
                            <div className="flex-1 min-w-0">
                              <b>{s.field}</b>: <span className="text-muted-foreground">المقترح</span> <b className="text-primary">{s.suggested}</b>
                            </div>
                            {onToggleSuggestion && (
                              <Button size="sm" variant={accepted ? "default" : "outline"} onClick={() => onToggleSuggestion(s.fieldKey)}>
                                {accepted ? "✓" : "اعتماد"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </td>
                {showActions && (
                  <td className="p-2">
                    <div className="flex flex-col gap-1">
                      {isReview && (
                        <>
                          <Button size="sm" variant="default" onClick={() => setDecision(k, "approve")}>
                            <CheckCircle2 className="w-3 h-3" /> اعتماد
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingKey(editing ? null : k)}>
                            <Pencil className="w-3 h-3" /> {editing ? "إنهاء التعديل" : "تعديل"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDecision(k, "ignore")}>
                            <X className="w-3 h-3" /> تجاهل
                          </Button>
                          {onAutoFix && (
                            <Button size="sm" variant="outline" onClick={() => onAutoFix(r)}>
                              <Sparkles className="w-3 h-3" /> إصلاح تلقائي
                            </Button>
                          )}
                        </>
                      )}
                      {!isReview && decision === "approve" && (
                        <Button size="sm" variant="outline" onClick={() => setDecision(k, null)}>إلغاء الاعتماد</Button>
                      )}
                      {!isReview && r._status === "ready" && !decision && (
                        <Button size="sm" variant="outline" onClick={() => setDecision(k, "ignore")}>
                          <X className="w-3 h-3" /> تجاهل
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 500 && (
        <div className="p-2 text-center text-xs text-muted-foreground bg-muted/30">
          يتم عرض أول 500 من {rows.length} صف.
        </div>
      )}
    </div>
  );
}
