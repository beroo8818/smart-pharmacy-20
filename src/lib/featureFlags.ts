// ============================================================================
// featureFlags.ts — مفاتيح تشغيل الميزات (Feature Flags)
// تسمح بكتابة كود ميزة كاملة لكن تبقى معطّلة حتى تفعيلها لاحقًا،
// بدون أي تأثير على عمل البرنامج الحالي.
//
// الافتراضي: كل الميزات الجديدة OFF.
// التفعيل: لمدير النظام فقط عبر صفحة الإعدادات (يُحفظ في localStorage).
// ============================================================================

export type FeatureFlag = "fefo";

/** القيم الافتراضية — كلها معطّلة. */
const DEFAULTS: Record<FeatureFlag, boolean> = {
  fefo: false,
};

export const FLAG_LABEL: Record<FeatureFlag, string> = {
  fefo: "الصرف بالأقرب انتهاءً أولًا (FEFO) + تتبّع التشغيلات وتاريخ الصلاحية",
};

const STORAGE_PREFIX = "feature_flag_";

/** هل الميزة مفعّلة؟ (افتراضيًا لا). */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (typeof window === "undefined") return DEFAULTS[flag];
  const raw = window.localStorage.getItem(STORAGE_PREFIX + flag);
  if (raw === null) return DEFAULTS[flag];
  return raw === "true";
}

/** تفعيل/تعطيل ميزة (يُستدعى من الإعدادات بصلاحية مدير النظام). */
export function setFeatureEnabled(flag: FeatureFlag, enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_PREFIX + flag, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent("feature-flag-changed", { detail: { flag, enabled } }));
}

export const ALL_FLAGS: FeatureFlag[] = Object.keys(DEFAULTS) as FeatureFlag[];