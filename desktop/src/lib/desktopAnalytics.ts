import { planTransfers } from "../../../shared/transferPlan";
import { locationKey, monthDays, numericValue, movementPeriodDays } from "../../../shared/inventoryHistory";

import type { Movement, UploadBatch } from "@/integrations/desktop/client";

export type AlertKind = "critical" | "danger" | "below" | "safe" | "over" | "very_over" | "deadstock" | "no_data";

export const KIND_ORDER: AlertKind[] = [
  "critical", "danger", "below", "safe", "over", "very_over", "deadstock", "no_data",
];

export const KIND_LABEL: Record<AlertKind, string> = {
  critical: "خطر عالي جدًا",
  danger: "نقص متوقع",
  below: "أقل من الهدف",
  safe: "آمن",
  over: "زيادة",
  very_over: "زيادة جدًا",
  deadstock: "راكد",
  no_data: "بيانات غير كافية",
};

export const KIND_CLASS: Record<AlertKind, string> = {
  critical: "bg-danger-soft text-danger border-danger/30",
  danger: "bg-danger-soft text-danger border-danger/20",
  below: "bg-warn-soft text-warn border-warn/30",
  safe: "bg-success-soft text-success border-success/30",
  over: "bg-primary-soft text-primary border-primary/25",
  very_over: "bg-primary-soft text-primary border-primary/40",
  deadstock: "bg-muted text-muted-fg border-border",
  no_data: "bg-muted text-muted-fg border-border",
};

export function normalize(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

export function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function fmtNum(v: unknown, digits = 0) {
  return num(v).toLocaleString("ar-EG", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtMonth(m?: string | null) {
  if (!m) return "-";
  try {
    return new Date(m).toLocaleDateString("ar-EG", { year: "numeric", month: "long" });
  } catch {
    return m.substring(0, 7);
  }
}

export function isMainLocation(t: string) {
  return t === "main_warehouse" || t === "main_store";
}

const STRENGTH_RE = /(\d+(?:[.,]\d+)?)\s*(mg\/ml|mcg\/ml|g\/ml|iu\/ml|iu|mg|mcg|gm|g|ml|l|%)\b/gi;
const FORM_PATTERNS: Array<[string, RegExp]> = [
  ["tablet", /\btab(let)?s?\b|قرص|أقراص/i],
  ["capsule", /\bcap(sule)?s?\b|كبسول/i],
  ["vial", /\bvial\b|فيال|قارورة/i],
  ["ampoule", /\bamp(oule|s)?\b|أمبول|امبول/i],
  ["syrup", /\bsyrup\b|شراب/i],
  ["solution", /\bsol(ution)?\b|محلول/i],
  ["injection", /\binj(ection)?\b|حقن/i],
  ["drops", /\bdrops?\b|قطرة|نقط/i],
  ["cream", /\bcream\b|كريم/i],
  ["ointment", /\boint(ment)?\b|مرهم/i],
  ["gel", /\bgel\b|جل/i],
  ["spray", /\bspray\b|بخاخ/i],
];

function normUnit(u: string) { return u.toLowerCase() === "g" ? "gm" : u.toLowerCase(); }
function extractStrengthText(...sources: (string | null | undefined)[]) {
  const text = sources.filter(Boolean).join(" ");
  STRENGTH_RE.lastIndex = 0;
  const m = STRENGTH_RE.exec(text);
  return m ? `${m[1].replace(",", ".")} ${normUnit(m[2])}` : "";
}
function extractFormText(...sources: (string | null | undefined)[]) {
  const text = sources.filter(Boolean).join(" ");
  return FORM_PATTERNS.find(([, re]) => re.test(text))?.[0] || "";
}
function cleanActiveName(s: string | null | undefined) {
  return String(s || "")
    .replace(STRENGTH_RE, " ")
    .replace(/\b(vial|amp(oule)?s?|tab(let)?s?|cap(sule)?s?|syrup|drops?|cream|oint(ment)?|gel|spray|sol(ution)?|inj(ection)?)\b/gi, " ")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function extractActiveName(active?: string | null, item?: string | null, trade?: string | null) {
  const candidate = active || item || trade || "";
  const cleaned = cleanActiveName(candidate);
  if (!cleaned) return "";
  const m = cleaned.match(/[A-Za-z][A-Za-z\-\/]+(?:\s+[A-Za-z][A-Za-z\-\/]+){0,2}/);
  return (m ? m[0] : cleaned).toLowerCase();
}

export function itemKeyFromParts(parts: {
  item_name_ar?: string | null; item_name_en?: string | null; item_code?: string | null;
  active_ingredient_ar?: string | null; strength?: string | null; dosage_form?: string | null; unit?: string | null;
  therapeutic_group_key?:string|null;
}) {
  const active = extractActiveName(parts.active_ingredient_ar, parts.item_name_ar, parts.item_name_en);
  const strength = parts.strength || extractStrengthText(parts.active_ingredient_ar, parts.item_name_ar, parts.item_name_en);
  const form = parts.dosage_form || extractFormText(parts.active_ingredient_ar, parts.item_name_ar, parts.item_name_en, parts.unit);
  if(parts.therapeutic_group_key)return `ai::${[parts.therapeutic_group_key,strength,form,parts.unit].map(normalize).join('|')}`;
  if (active && strength) return `ai::${[active, strength, form, parts.unit || ""].map(normalize).join("|")}`;
  return normalize(parts.item_code || `${parts.item_name_ar || ""}|${parts.active_ingredient_ar || ""}|${parts.unit || ""}`);
}

export function itemKeyAliases(r: Movement) {
  const values = [
    r.item_code,
    r.item_name_ar,
    r.active_ingredient_ar,
    r.item_name_en,
    itemKeyFromParts({...r,therapeutic_group_key:null}),
    r.therapeutic_group_key?`ai::${normalize(r.therapeutic_group_key)}|${normalize(r.unit)}`:null,
    `${r.item_name_ar || ""}|${r.active_ingredient_ar || ""}|${r.item_name_en || ""}|${r.unit || ""}`,
  ];
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

export function itemKey(r: Movement) {
  return itemKeyFromParts(r);
}

export function itemDisplayName(r: Movement) {
  const active = extractActiveName(r.active_ingredient_ar, r.item_name_ar, r.item_name_en);
  const strength = r.strength || extractStrengthText(r.active_ingredient_ar, r.item_name_ar, r.item_name_en);
  const form = r.dosage_form || extractFormText(r.active_ingredient_ar, r.item_name_ar, r.item_name_en, r.unit);
  const label = [active ? active.replace(/\b\w/g, (c) => c.toUpperCase()) : "", strength, form].filter(Boolean).join(" ");
  return label || r.active_ingredient_ar || r.item_name_ar || r.item_name_en || r.item_code || "صنف بدون اسم";
}

export function itemTradeNames(r: Movement) {
  const display = normalize(itemDisplayName(r));
  const active = normalize(r.active_ingredient_ar);
  const values = [r.item_name_ar, r.item_name_en]
    .map((v) => (v || "").trim())
    .filter(Boolean)
    .filter((v) => {
      const n = normalize(v);
      return n && n !== display && n !== active;
    });
  return Array.from(new Set(values));
}

export function tradeNamesLabel(names?: string[] | null) {
  const clean = Array.from(new Set((names || []).map((n) => n.trim()).filter(Boolean)));
  if (!clean.length) return "";
  return `الاسم التجاري: ${clean.slice(0, 3).join("، ")}${clean.length > 3 ? ` +${clean.length - 3}` : ""}`;
}

export type AnalysisRow = {
  key: string;
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  unit?: string | null;
  locationName: string;
  locationType: string;
  balance: number;
  issued: number;
  adc: number;
  days: number | null;
  kind: AlertKind;
  severity: "high" | "medium" | "low";
  why: string;
  action: string;
};

export type TransferRow = {
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  from: string;
  to: string;
  qty: number;
  reason: string;
};

function classifyBranch(days: number | null, balance: number, issued: number, targetDays: number): AlertKind {
  const adc = issued / 30;
  if (issued === 0 && balance === 0) return "no_data";
  if (issued === 0 && balance > 0) return "deadstock";
  if (days == null || adc <= 0) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < targetDays) return "below";
  if (days <= targetDays * 2) return "safe";
  if (days <= targetDays * 3) return "over";
  return "very_over";
}

function classifyMain(days: number | null, balance: number, branchAdc: number, targetDays: number): AlertKind {
  if (balance <= 0 && branchAdc <= 0) return "no_data";
  if (balance <= 0 && branchAdc > 0) return "critical";
  if (branchAdc <= 0) return "no_data";
  if (days == null) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < targetDays) return "below";
  if (days < targetDays * 2) return "safe";
  if (days < targetDays * 3) return "over";
  return "very_over";
}

export function analyzeMovements(movements: Movement[], targetDays = 30): AnalysisRow[] {
  const groups = new Map<string, { sample: Movement; balance: number; issued: number; adc: number; hasBalance: boolean; hasIssued: boolean; tradeNames: Set<string> }>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${locationKey(m.location_name, m.location_type)}`;
    const cur = groups.get(key);
    const issued = num(m.issued_qty);
    const balance = num(m.closing_balance);
    const hasBalance = numericValue(m.closing_balance) != null;
    const hasIssued = numericValue(m.issued_qty) != null;
    const duration=movementPeriodDays(m);
    const daily = duration>0 ? issued/duration : 0;
    const names = itemTradeNames(m);
    if (!cur) groups.set(key, { sample: m, balance, issued, adc: daily, hasBalance, hasIssued, tradeNames: new Set(names) });
    else {
      cur.balance += balance;
      cur.issued += issued;
      cur.adc += daily;
      cur.hasBalance &&= hasBalance;
      cur.hasIssued &&= hasIssued;
      names.forEach((n) => cur.tradeNames.add(n));
    }
  }
  const branchAdcByItem = new Map<string, number>();
  for (const g of groups.values()) {
    if (isMainLocation(g.sample.location_type)) continue;
    const k = itemKey(g.sample);
    branchAdcByItem.set(k, (branchAdcByItem.get(k) || 0) + g.adc);
  }

  return Array.from(groups.values()).map((g) => {
    const itemK = itemKey(g.sample);
    const isMain = isMainLocation(g.sample.location_type);
    const branchAdc = branchAdcByItem.get(itemK) || 0;
    const adc = isMain ? branchAdc : g.adc;
    const days = adc > 0 ? g.balance / adc : null;
    const kind = !g.hasBalance || (!isMain && !g.hasIssued) ? "no_data" : isMain ? classifyMain(days, g.balance, branchAdc, targetDays) : classifyBranch(days, g.balance, g.issued, targetDays);
    const severity: AnalysisRow["severity"] = kind === "critical" || kind === "danger" ? "high" : kind === "below" || kind === "very_over" ? "medium" : "low";
    let why = "الرصيد ضمن حدود التغطية المطلوبة.";
    let action = "لا يوجد إجراء عاجل.";
    if (isMain && g.balance <= 0 && branchAdc > 0) {
      why = `المخزن الرئيسي غير متوفر لهذا الصنف، بينما متوسط صرف الفروع ${fmtNum(adc, 1)} وحدة/يوم.`;
      action = "المخزن الرئيسي لا يغطي الاحتياج؛ راجع التوريد أو التحويلات فورًا.";
    } else if (isMain && g.balance > 0 && branchAdc <= 0) {
      why = `يوجد رصيد ${fmtNum(g.balance)} في المخزن الرئيسي بدون صرف واضح في الفروع.`;
      action = "راجع احتياج الفروع قبل اعتبار الرصيد راكدًا.";
    } else if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد يغطي ${days == null ? "0" : fmtNum(days, 1)} يوم فقط، والهدف ${targetDays} يوم.`;
      action = `وفّر كمية تقارب ${fmtNum(Math.max(0, Math.ceil(adc * targetDays - g.balance)))} وحدة.`;
    } else if (kind === "over" || kind === "very_over") {
      why = `الرصيد يغطي ${fmtNum(days, 1)} يوم، أعلى من الاحتياج.`;
      action = "أوقف الطلب مؤقتًا أو حوّل الفائض لصيدلية ناقصة.";
    } else if (kind === "deadstock") {
      why = "يوجد رصيد بدون صرف في الملف الحالي.";
      action = "راجع الاحتياج أو انقل الصنف لمكان يستخدمه.";
    } else if (kind === "no_data") {
      why = "لا يوجد صرف ولا رصيد كافيان للحساب.";
      action = "راجع صحة بيانات الملف لهذا الصنف.";
    }
    return {
      key: `${itemK}|${g.sample.location_type}|${g.sample.location_name}`,
      itemKey: itemK,
      itemName: itemDisplayName(g.sample),
      tradeNames: Array.from(g.tradeNames),
      itemCode: g.sample.item_code,
      unit: g.sample.unit,
      locationName: g.sample.location_name,
      locationType: g.sample.location_type,
      balance: g.balance,
      issued: g.issued,
      adc,
      days,
      kind,
      severity,
      why,
      action,
    };
  }).sort((a, b) => {
    const order: Record<AlertKind, number> = { critical: 0, danger: 1, below: 2, very_over: 3, over: 4, deadstock: 5, no_data: 6, safe: 7 };
    return order[a.kind] - order[b.kind] || a.itemName.localeCompare(b.itemName, "ar");
  });
}

export function suggestTransfers(rows: AnalysisRow[], targetDays = 30): TransferRow[] {
  return planTransfers(rows, targetDays).map((plan) => ({
    itemName: plan.to.itemName, tradeNames: plan.to.tradeNames, itemCode: plan.to.itemCode,
    from: plan.from.locationName, to: plan.to.locationName, qty: plan.qty,
    reason: `اقتراح يحتاج اعتمادًا ومراجعة الرصيد والصلاحية. المتبقي لدى المصدر ${fmtNum(plan.fromAfter)} ${plan.from.unit || ""}.`,
  }));
}

export async function loadLatestDataset(api: any, token: string) {
  const b = await api.queries.latestBatch({ token });
  const batch = b.batch as UploadBatch | null;
  if (!batch) return { batch: null, movements: [] as Movement[] };
  const m = await api.queries.movementsByBatch({ token, batchId: batch.id });
  return { batch, movements: (m.movements || []) as Movement[] };
}
