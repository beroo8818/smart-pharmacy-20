// ============================================================================
// statusRules.ts — منطق موحّد لتصنيف حالة الصنف (مخزن رئيسي / صيدلية فرعية)
// مصدر واحد للحقيقة يُعاد استخدامه في كل صفحات التحليل والتقارير.
// ============================================================================

export type AlertKind =
  | "critical" | "danger" | "below" | "safe" | "over" | "very_over" | "deadstock" | "no_data";

/** هل الموقع هو المخزن الرئيسي (ليس صيدلية مستهلكة)؟ */
export const isMainLocation = (t: string | null | undefined) => {
  const v = String(t ?? "").trim().toLowerCase();
  return v === "main_warehouse" || v === "main_store";
};

export type ClassifyInput = {
  balance: number;
  issued: number;
  /** أيام التغطية = الرصيد / متوسط الصرف اليومي (أو null) */
  days: number | null;
  targetDays: number;
  /** نوع الموقع لتمييز المخزن الرئيسي عن الصيدليات الفرعية */
  locationType?: string | null;
};

/**
 * التصنيف الموحّد لحالة أي صنف.
 *
 * قواعد إلزامية:
 *  - المخزن الرئيسي لا يُصنّف "راكد" أبدًا.
 *  - أي رصيد = 0 لا يُصنّف "راكد" أبدًا.
 *  - "راكد" صالح فقط: رصيد > 0 و صرف = 0 و الموقع صيدلية فرعية (مكان استهلاك).
 */
export function classifyStatus(input: ClassifyInput): AlertKind {
  const { balance, issued, days, targetDays } = input;
  const main = isMainLocation(input.locationType);
  const adc = issued / 30;

  // لا رصيد ولا صرف → بيانات غير كافية (ليس راكد إطلاقًا).
  if (issued === 0 && balance === 0) return "no_data";

  // رصيد بدون صرف.
  if (issued === 0 && balance > 0) {
    // المخزن الرئيسي: رصيد بدون صرف بالفروع → يحتاج مراجعة (نعرضه كـ over لا راكد).
    if (main) return "no_data";
    return "deadstock"; // راكد على مستوى الصيدلية الفرعية فقط.
  }

  if (days == null || adc <= 0) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < targetDays) return "below";
  if (days <= targetDays * 2) return "safe";
  if (days <= targetDays * 3) return "over";
  return "very_over";
}

/** نسخة مبسّطة بالتوقيع القديم مع تمرير نوع الموقع. */
export function classifyKind(
  days: number | null,
  balance: number,
  issued: number,
  targetDays: number,
  locationType?: string | null,
): AlertKind {
  return classifyStatus({ days, balance, issued, targetDays, locationType });
}
