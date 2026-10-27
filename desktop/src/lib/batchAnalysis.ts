import { locationKey, monthDays, numericValue } from "../../../shared/inventoryHistory";
import { supabase } from "@/integrations/supabase/client";
import { classifyStatus, isMainLocation as isMainLoc, type AlertKind } from "./statusRules";

export type { AlertKind };

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
};

export type Movement = {
  id: string; upload_batch_id: string; month: string;
  item_name: string | null; item_code: string | null;
  scientific_name: string | null; trade_name: string | null; unit: string | null;
  location_name: string; location_type: string;
  issued_quantity: number | string | null; current_balance: number | string | null;
};

export type AnalysisRow = {
  key: string;
  itemKey: string;
  itemName: string;
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

export const isMainLocation = isMainLoc;

export const itemKey = (r: Movement) =>
  normalize(r.item_code || `${r.item_name || ""}|${r.scientific_name || ""}|${r.trade_name || ""}|${r.unit || ""}`);

function classify(days: number | null, balance: number, issued: number, target: number, locationType?: string | null): AlertKind {
  return classifyStatus({ days, balance, issued, targetDays: target, locationType });
}

export function analyzeMovements(movements: Movement[], targetDays = 30): AnalysisRow[] {
  const groups = new Map<string, { sample: Movement; balance: number; issued: number; adc: number; hasBalance: boolean; hasIssued: boolean }>();
  for (const m of movements) {
    const key = `${itemKey(m)}|${locationKey(m.location_name, m.location_type)}`;
    const cur = groups.get(key);
    const issued = num(m.issued_quantity);
    const balance = num(m.current_balance);
    const hasBalance = numericValue(m.current_balance) != null;
    const hasIssued = numericValue(m.issued_quantity) != null;
    const daily = issued / (monthDays(m.month) || 30);
    if (!cur) groups.set(key, { sample: m, balance, issued, adc: daily, hasBalance, hasIssued });
    else { cur.balance += balance; cur.issued += issued;
      cur.adc += daily;
      cur.hasBalance &&= hasBalance;
      cur.hasIssued &&= hasIssued; }
  }
  return Array.from(groups.values()).map((g) => {
    const adc = g.adc;
    const days = adc > 0 ? g.balance / adc : null;
    const kind = !g.hasBalance || !g.hasIssued ? "no_data" : classify(days, g.balance, g.issued, targetDays, g.sample.location_type);
    let why = "الرصيد ضمن حدود التغطية المطلوبة.";
    let action = "لا يوجد إجراء عاجل.";
    if (kind === "critical" || kind === "danger" || kind === "below") {
      why = `الرصيد ${g.balance.toLocaleString("ar-EG")} ÷ متوسط الصرف اليومي ${adc.toFixed(1)} = ${days == null ? "0" : days.toFixed(0)} يوم تغطية، والهدف ${targetDays} يوم.`;
      action = `زوّد الكمية حتى تصل لتغطية ${targetDays} يوم — قارب ${Math.max(0, Math.ceil(adc * targetDays - g.balance)).toLocaleString("ar-EG")} وحدة.`;
    } else if (kind === "over" || kind === "very_over") {
      if (isMainLocation(g.sample.location_type) && g.issued === 0 && g.balance > 0) {
        why = `رصيد بالمخزن الرئيسي ${g.balance.toLocaleString("ar-EG")} بدون صرف بالفروع — يحتاج مراجعة.`;
        action = "راجع احتياج الصيدليات الفرعية قبل أي طلب توريد.";
      } else {
        why = `الرصيد يغطي ${days == null ? "0" : days.toFixed(0)} يوم — أعلى من الاحتياج.`;
        action = "أوقف الطلب مؤقتًا أو حوّل الفائض لصيدلية ناقصة.";
      }
    } else if (kind === "deadstock") {
      why = `يوجد رصيد ${g.balance.toLocaleString("ar-EG")} بدون صرف في هذا الملف.`;
      action = "راجع الاحتياج أو انقل الصنف لمكان يستخدمه.";
    } else if (kind === "no_data") {
      why = "لا يوجد صرف ولا رصيد كافيان للحساب.";
      action = "راجع بيانات الملف لهذا الصنف.";
    }
    return {
      key: `${itemKey(g.sample)}|${g.sample.location_type}|${g.sample.location_name}`,
      itemKey: itemKey(g.sample),
      itemName: g.sample.item_name || g.sample.trade_name || g.sample.scientific_name || g.sample.item_code || "صنف بدون اسم",
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
  const { data, error } = await (supabase as any)
    .from("upload_batches")
    .select("id,file_name,month,rows_saved,status,created_at")
    .eq("status", "saved")
    .gt("rows_saved", 0)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function fetchMovementsByBatch(batchId: string): Promise<Movement[]> {
  const { data, error } = await (supabase as any)
    .from("inventory_movements")
    .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance")
    .eq("upload_batch_id", batchId)
    .range(0, 49999);
  if (error) throw error;
  return (data || []) as Movement[];
}
