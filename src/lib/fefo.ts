// ============================================================================
// fefo.ts — منطق "الصرف بالأقرب انتهاءً أولًا" (First Expired, First Out)
//
// ⚠️ هذه الميزة معطّلة افتراضيًا (feature flag: "fefo").
// الكود جاهز لكنه لا يُستخدم في الواجهة حتى تفعيل المفتاح من الإعدادات.
//
// الفكرة: كل تشغيلة (batch) لها رصيد وتاريخ صلاحية. عند الصرف نبدأ
// بالتشغيلة الأقرب انتهاءً، ونُنبّه على ما قد ينتهي قبل استهلاكه.
// ============================================================================

export type BatchLine = {
  itemKey: string;
  itemName: string;
  locationName: string;
  locationType: string;
  batchNo: string | null;
  expiryDate: string | null; // ISO YYYY-MM-DD
  balance: number;
};

export type FefoRisk = "expired" | "expiring_soon" | "watch" | "ok" | "no_date";

export const FEFO_RISK_LABEL: Record<FefoRisk, string> = {
  expired: "منتهية الصلاحية",
  expiring_soon: "قرب الانتهاء",
  watch: "تحت المتابعة",
  ok: "سليمة",
  no_date: "بدون تاريخ صلاحية",
};

function daysUntil(iso: string | null, asOf: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - asOf.getTime()) / 86_400_000);
}

/** تصنيف خطر التشغيلة حسب أيام بقاء الصلاحية. */
export function classifyExpiry(
  expiryDate: string | null,
  opts: { soonDays?: number; watchDays?: number; asOf?: Date } = {},
): { risk: FefoRisk; daysLeft: number | null } {
  const soonDays = opts.soonDays ?? 90;
  const watchDays = opts.watchDays ?? 180;
  const asOf = opts.asOf ?? new Date();
  const daysLeft = daysUntil(expiryDate, asOf);
  if (daysLeft == null) return { risk: "no_date", daysLeft: null };
  if (daysLeft < 0) return { risk: "expired", daysLeft };
  if (daysLeft <= soonDays) return { risk: "expiring_soon", daysLeft };
  if (daysLeft <= watchDays) return { risk: "watch", daysLeft };
  return { risk: "ok", daysLeft };
}

/** ترتيب تشغيلات صنف في موقع بالأقرب انتهاءً أولًا (التواريخ الفارغة في الآخر). */
export function sortFefo(lines: BatchLine[]): BatchLine[] {
  return [...lines].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
}

/**
 * خطة صرف FEFO لكمية مطلوبة: تخصم من التشغيلات الأقرب انتهاءً أولًا.
 * تُرجع التشغيلات المستخدمة والكمية الناقصة (إن وجدت).
 */
export function planFefoIssue(lines: BatchLine[], requestedQty: number) {
  const ordered = sortFefo(lines);
  let remaining = requestedQty;
  const picks: { batch: BatchLine; qty: number }[] = [];
  for (const batch of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, batch.balance));
    if (take > 0) {
      picks.push({ batch, qty: take });
      remaining -= take;
    }
  }
  return { picks, shortage: Math.max(0, remaining) };
}