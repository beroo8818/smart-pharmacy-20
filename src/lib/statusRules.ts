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

// ============================================================================
// المصدر الموحّد الوحيد لتصنيف حالة الصنف.
// تُستخدم نفس هاتين الدالتين في كل مسارات التحليل (batchAnalysis / continuousAnalysis)
// لضمان نتائج متطابقة في كل الصفحات والتقارير.
//
// قواعد إلزامية:
//  - المخزن الرئيسي لا يُصنّف "راكد" أبدًا.
//  - أي رصيد = 0 لا يُصنّف "راكد" أبدًا.
//  - "راكد" صالح فقط: رصيد > 0 و صرف = 0 على مستوى صيدلية فرعية.
// ============================================================================

/** تصنيف صنف داخل صيدلية فرعية (مكان استهلاك). */
export function classifyBranch(
  days: number | null,
  balance: number,
  issued: number,
  target: number,
): AlertKind {
  const adc = issued / 30;
  if (issued === 0 && balance === 0) return "no_data";
  if (issued === 0 && balance > 0) return "deadstock";
  if (days == null || adc <= 0) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < target) return "below";
  if (days <= target * 2) return "safe";
  if (days <= target * 3) return "over";
  return "very_over";
}

/** تصنيف صنف في المخزن الرئيسي (يعتمد على متوسط صرف الفروع، ولا يُصنّف راكدًا أبدًا). */
export function classifyMain(
  days: number | null,
  balance: number,
  branchAdc: number,
  target: number,
): AlertKind {
  if (balance <= 0 && branchAdc <= 0) return "no_data";
  if (balance <= 0 && branchAdc > 0) return "critical";
  if (branchAdc <= 0) return "no_data";
  if (days == null) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < target) return "below";
  if (days <= target * 2) return "safe";
  if (days <= target * 3) return "over";
  return "very_over";
}

// ملاحظة: التصنيف الموحّد يتم عبر classifyBranch / classifyMain أعلاه فقط.