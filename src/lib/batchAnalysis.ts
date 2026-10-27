import { supabase } from "@/integrations/supabase/client";
import {
  buildStandardName,
  extractActiveIngredient,
  extractDosageForm,
  extractStrength,
} from "@/lib/activeIngredient";
import { classifyBranch, classifyMain } from "@/lib/statusRules";

export type AlertKind =
  | "critical" | "danger" | "below" | "safe" | "over" | "very_over" | "deadstock" | "no_data";

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
  critical: "bg-destructive/15 text-destructive border-destructive/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  below: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  safe: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  over: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  very_over: "bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/40",
  deadstock: "bg-muted text-muted-foreground border-border",
  no_data: "bg-muted text-muted-foreground border-border",
};

export type UploadBatch = {
  id: string; file_name: string; month: string;
  rows_saved: number; status: string; created_at: string;
  snapshot_date?: string | null; batch_kind?: string | null;
};

export type Movement = {
  id: string; upload_batch_id: string; month: string;
  item_name: string | null; item_code: string | null;
  scientific_name: string | null; trade_name: string | null; unit: string | null;
  strength?: string | null; dosage_form?: string | null; therapeutic_group_key?: string | null;
  location_name: string; location_type: string;
  issued_quantity: number | string | null; current_balance: number | string | null;
};

export type AnalysisRow = {
  key: string;
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  scientific: string | null;
  unit: string | null;
  locationName: string;
  locationType: string;
  balance: number;
  issued: number;
  adc: number;
  days: number | null;
  kind: AlertKind;
  why: string;
  action: string;
};

export const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const normalize = (s: unknown) =>
  String(s ?? "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ");

export const isMainLocation = (t: string) =>
  t === "main_warehouse" || t === "main_store";

type ItemKeyParts = {
  item_name?: string | null;
  item_code?: string | null;
  scientific_name?: string | null;
  trade_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  unit?: string | null;
  therapeutic_group_key?: string | null;
};

export function itemKeyFromParts(parts: ItemKeyParts) {
  if (parts.therapeutic_group_key) return `ai::${normalize(parts.therapeutic_group_key)}`;
  const active = extractActiveIngredient(parts.scientific_name, parts.item_name, parts.trade_name);
  const strength = parts.strength || extractStrength(parts.scientific_name, parts.item_name, parts.trade_name);
  const dosage = parts.dosage_form || extractDosageForm(parts.scientific_name, parts.item_name, parts.trade_name, parts.unit);
  if (active && strength) {
    return `ai::${[active, strength, dosage || "", parts.unit || ""].map(normalize).join("|")}`;
  }
  return normalize(parts.item_code || `${parts.item_name || ""}|${parts.scientific_name || ""}|${parts.unit || ""}`);
}

export function itemKeyAliases(r: Movement) {
  const values = [
    r.item_code,
    r.item_name,
    r.scientific_name,
    r.trade_name,
    `${r.item_name || ""}|${r.scientific_name || ""}|${r.trade_name || ""}|${r.unit || ""}`,
  ];
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

export const itemKey = (r: Movement) => itemKeyFromParts(r);

export function itemDisplayName(r: Movement) {
  const active = extractActiveIngredient(r.scientific_name, r.item_name, r.trade_name);
  const strength = r.strength || extractStrength(r.scientific_name, r.item_name, r.trade_name);
  const dosage = r.dosage_form || extractDosageForm(r.scientific_name, r.item_name, r.trade_name, r.unit);
  return buildStandardName({ active_ingredient: active, strength, dosage_form: dosage })
    || r.scientific_name
    || r.item_name
    || r.trade_name
    || r.item_code
    || "صنف بدون اسم";
}

export function itemTradeNames(r: Movement) {
  const display = normalize(itemDisplayName(r));
  const scientific = normalize(r.scientific_name);
  const values = [r.trade_name, r.item_name]
    .map((v) => (v || "").trim())
    .filter(Boolean)
    .filter((v) => {
      const n = normalize(v);
      return n && n !== display && n !== scientific;
    });
  return Array.from(new Set(values));
}

export function tradeNamesLabel(names?: string[] | null) {
  const clean = Array.from(new Set((names || []).map((n) => n.trim()).filter(Boolean)));
  if (!clean.length) return "";
  return `الاسم التجاري: ${clean.slice(0, 3).join("، ")}${clean.length > 3 ? ` +${clean.length - 3}` : ""}`;
}

type DictEntry = {
  original_item_name: string;
  scientific_name: string | null;
  trade_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  unit: string | null;
  standard_name: string | null;
  therapeutic_group_key: string | null;
};

export async function fetchActiveIngredientDictionary() {
  const { data, error } = await (supabase as any)
    .from("active_ingredient_dictionary")
    .select("original_item_name,scientific_name,trade_name,active_ingredient,strength,dosage_form,unit,standard_name,therapeutic_group_key")
    .range(0, 99999);
  if (error) return new Map<string, DictEntry>();
  const map = new Map<string, DictEntry>();
  for (const d of (data || []) as DictEntry[]) {
    for (const candidate of [
      d.original_item_name,
      d.scientific_name,
      d.trade_name,
      d.standard_name,
      d.therapeutic_group_key ? `ai::${d.therapeutic_group_key}` : null,
    ]) {
      const key = normalize(candidate);
      if (key) map.set(key, d);
    }
  }
  return map;
}

export function enrichMovementsWithDictionary(movements: Movement[], dict: Map<string, DictEntry>) {
  return movements.map((m) => {
    const d = dict.get(normalize(m.item_name)) || dict.get(normalize(m.scientific_name)) || dict.get(normalize(m.trade_name));
    if (!d) return m;
    return {
      ...m,
      scientific_name: m.scientific_name || d.active_ingredient || d.scientific_name,
      trade_name: m.trade_name || d.trade_name,
      strength: m.strength || d.strength,
      dosage_form: m.dosage_form || d.dosage_form,
      unit: m.unit || d.unit,
      therapeutic_group_key: m.therapeutic_group_key || d.therapeutic_group_key,
    };
  });
}

export function analysisDateOfBatch(batch: Pick<UploadBatch, "month" | "created_at"> & { snapshot_date?: string | null }) {
  return batch.snapshot_date || batch.month || batch.created_at || "";
}

export function savedAtOfBatch(batch: Pick<UploadBatch, "created_at"> & { uploaded_at?: string | null }) {
  return batch.uploaded_at || batch.created_at || "";
}

export function sortBatchesForAnalysis<T extends Pick<UploadBatch, "month" | "created_at"> & { snapshot_date?: string | null; uploaded_at?: string | null }>(batches: T[]) {
  return [...batches].sort((a, b) => {
    const bySavedAt = savedAtOfBatch(b).localeCompare(savedAtOfBatch(a));
    if (bySavedAt !== 0) return bySavedAt;
    return analysisDateOfBatch(b).localeCompare(analysisDateOfBatch(a));
  });
}

export function analyzeMovements(movements: Movement[], targetDays = 30): AnalysisRow[] {
  const groups = new Map<string, { sample: Movement; balance: number; issued: number; tradeNames: Set<string> }>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${normalize(m.location_type)}|${normalize(m.location_name)}`;
    const cur = groups.get(key);
    const issued = num(m.issued_quantity);
    const balance = num(m.current_balance);
    const names = itemTradeNames(m);
    if (!cur) groups.set(key, { sample: m, balance, issued, tradeNames: new Set(names) });
    else {
      cur.balance = balance;
      cur.issued += issued;
      names.forEach((n) => cur.tradeNames.add(n));
    }
  }
  const branchAdcByItem = new Map<string, number>();
  for (const g of groups.values()) {
    if (isMainLocation(g.sample.location_type)) continue;
    const k = itemKey(g.sample);
    branchAdcByItem.set(k, (branchAdcByItem.get(k) || 0) + g.issued / 30);
  }
  return Array.from(groups.values()).map((g) => {
    const itemK = itemKey(g.sample);
    const isMain = isMainLocation(g.sample.location_type);
    const branchAdc = branchAdcByItem.get(itemK) || 0;
    const adc = isMain ? branchAdc : g.issued / 30;
    const days = adc > 0 ? g.balance / adc : null;
    const kind = isMain ? classifyMain(days, g.balance, branchAdc, targetDays) : classifyBranch(days, g.balance, g.issued, targetDays);
    let why = "الرصيد ضمن حدود التغطية المطلوبة.";
    let action = "لا يوجد إجراء عاجل.";
    if (isMain && g.balance <= 0 && branchAdc > 0) {
      why = `المخزن الرئيسي غير متوفر لهذا الصنف، بينما متوسط صرف الفروع ${adc.toFixed(1)} وحدة/يوم.`;
      action = "المخزن الرئيسي لا يغطي الاحتياج؛ راجع التوريد أو التحويلات فورًا.";
    } else if (isMain && g.balance > 0 && branchAdc <= 0) {
      why = `يوجد رصيد ${g.balance.toLocaleString("ar-EG")} في المخزن الرئيسي بدون صرف واضح في الفروع.`;
      action = "راجع احتياج الفروع قبل اعتبار الرصيد راكدًا.";
    } else if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد ${g.balance.toLocaleString("ar-EG")} ÷ متوسط الصرف اليومي ${adc.toFixed(1)} = ${days == null ? "0" : days.toFixed(0)} يوم تغطية، والهدف ${targetDays} يوم.`;
      action = `زوّد الكمية حتى تصل لتغطية ${targetDays} يوم — قارب ${Math.max(0, Math.ceil(adc * targetDays - g.balance)).toLocaleString("ar-EG")} وحدة.`;
    } else if (kind === "over" || kind === "very_over") {
      why = `الرصيد يغطي ${days == null ? "0" : days.toFixed(0)} يوم — أعلى من الاحتياج.`;
      action = "أوقف الطلب مؤقتًا أو حوّل الفائض لصيدلية ناقصة.";
    } else if (kind === "deadstock") {
      why = `يوجد رصيد ${g.balance.toLocaleString("ar-EG")} بدون صرف في هذا الملف.`;
      action = "راجع الاحتياج أو انقل الصنف لمكان يستخدمه.";
    } else if (kind === "no_data") {
      why = "لا يوجد صرف ولا رصيد كافيان للحساب.";
      action = "راجع بيانات الملف لهذا الصنف.";
    }
    return {
      key: `${itemK}|${g.sample.location_type}|${g.sample.location_name}`,
      itemKey: itemK,
      itemName: itemDisplayName(g.sample),
      tradeNames: Array.from(g.tradeNames),
      itemCode: g.sample.item_code,
      scientific: g.sample.scientific_name,
      unit: g.sample.unit,
      locationName: g.sample.location_name,
      locationType: g.sample.location_type,
      balance: g.balance,
      issued: g.issued,
      adc, days, kind, why, action,
    };
  }).sort((a, b) => {
    const order: Record<AlertKind, number> = { critical:0, danger:1, below:2, very_over:3, over:4, deadstock:5, no_data:6, safe:7 };
    return order[a.kind] - order[b.kind] || a.itemName.localeCompare(b.itemName, "ar");
  });
}

export async function fetchLatestBatch(): Promise<UploadBatch | null> {
  const batches = await fetchSavedBatches(50);
  return batches[0] || null;
}

export async function fetchSavedBatches(limit = 200): Promise<UploadBatch[]> {
  const { data, error } = await (supabase as any)
    .from("upload_batches")
    .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
    .eq("status", "saved")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return sortBatchesForAnalysis((data || []) as UploadBatch[]);
}

export async function fetchMovementsByBatch(batchId: string): Promise<Movement[]> {
  const { data, error } = await (supabase as any)
    .from("inventory_movements")
    .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance")
    .eq("upload_batch_id", batchId)
    .range(0, 49999);
  if (error) throw error;
  const dict = await fetchActiveIngredientDictionary();
  return enrichMovementsWithDictionary((data || []) as Movement[], dict);
}
