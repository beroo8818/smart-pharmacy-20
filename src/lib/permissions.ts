// ============================================================================
// permissions.ts — مصدر واحد لقواعد الصلاحيات حسب الدور (RBAC)
// يُستخدم في حماية الصفحات، الاستعلامات، أزرار الحفظ/التعديل/الحذف، والقرارات.
// لا تعتمد على إخفاء الأزرار فقط — استدعِ هذه الدوال قبل أي إجراء حسّاس.
// ============================================================================

export type Role =
  | "system_admin"
  | "pharmacy_manager"
  | "warehouse_keeper"
  | "sub_pharmacist"
  | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  system_admin: "مدير النظام",
  pharmacy_manager: "مدير الصيدلية",
  warehouse_keeper: "أمين المخزن",
  sub_pharmacist: "صيدلي فرعي",
  viewer: "مشاهد فقط",
};

/** ترتيب القوة (الأعلى أوسع صلاحية). للعرض/المقارنة فقط. */
export const ROLE_RANK: Record<Role, number> = {
  system_admin: 100,
  pharmacy_manager: 80,
  warehouse_keeper: 60,
  sub_pharmacist: 40,
  viewer: 20,
};

export const ALL_ROLES: Role[] = [
  "system_admin",
  "pharmacy_manager",
  "warehouse_keeper",
  "sub_pharmacist",
  "viewer",
];

const has = (roles: Role[], ...allowed: Role[]) =>
  roles.some((r) => allowed.includes(r));

export const isAdmin = (roles: Role[]) => has(roles, "system_admin");
export const isViewerOnly = (roles: Role[]) =>
  roles.length > 0 && roles.every((r) => r === "viewer");

// ---------------------------------------------------------------------------
// قواعد الإجراءات الحسّاسة
// ---------------------------------------------------------------------------

/** رفع/مراجعة بيانات شهرية. */
export const canUploadData = (roles: Role[]) =>
  has(roles, "system_admin", "pharmacy_manager", "warehouse_keeper");

/** اعتماد/رفض/تأجيل/تنفيذ توصيات مركز العمل اليومي. */
export const canApproveRecommendation = (roles: Role[]) =>
  has(roles, "system_admin", "pharmacy_manager");

/** إدارة المستخدمين والأدوار. */
export const canManageUsers = (roles: Role[]) => isAdmin(roles);

/** إدارة إعدادات النظام. */
export const canManageSettings = (roles: Role[]) => isAdmin(roles);

/** حذف/تصفير كل البيانات المستوردة. */
export const canResetData = (roles: Role[]) => isAdmin(roles);

/** النسخ الاحتياطي والاستعادة. */
export const canBackupRestore = (roles: Role[]) => isAdmin(roles);

/** تسجيل حركات مخزن (استلام/صرف/مرتجع). */
export const canRegisterStockTx = (roles: Role[]) =>
  has(roles, "system_admin", "pharmacy_manager", "warehouse_keeper");

/** أي عملية كتابة عامة (حفظ/تعديل). المشاهد لا يكتب أبدًا. */
export const canWrite = (roles: Role[]) => !isViewerOnly(roles) && roles.length > 0;

/** إنشاء/تنفيذ تحويلات بين الصيدليات. */
export const canManageTransfers = (roles: Role[]) =>
  has(roles, "system_admin", "pharmacy_manager", "warehouse_keeper");

// ---------------------------------------------------------------------------
// رؤية المواقع — للصيدلي الفرعي تقييد على موقعه المخصّص فقط
// ---------------------------------------------------------------------------

/**
 * هل يمكن لهذا المستخدم رؤية بيانات موقع معيّن؟
 * - الأدوار الواسعة ترى كل المواقع.
 * - sub_pharmacist يرى فقط موقعه المخصّص (assignedLocationId).
 */
export function canViewLocation(
  roles: Role[],
  assignedLocationId: string | null | undefined,
  targetLocationId: string | null | undefined,
): boolean {
  if (has(roles, "system_admin", "pharmacy_manager", "warehouse_keeper")) return true;
  if (has(roles, "viewer")) return true; // مشاهد عام (قراءة فقط) ما لم يكن أيضًا صيدلي فرعي
  if (has(roles, "sub_pharmacist")) {
    if (!assignedLocationId) return false;
    return assignedLocationId === targetLocationId;
  }
  return false;
}

/** هل المستخدم مقيّد بموقع واحد (صيدلي فرعي بدون دور أوسع)؟ */
export const isLocationRestricted = (roles: Role[]) =>
  has(roles, "sub_pharmacist") &&
  !has(roles, "system_admin", "pharmacy_manager", "warehouse_keeper");

// ---------------------------------------------------------------------------
// صلاحية الصفحات — الأدوار المسموح لها بكل مسار
// (الأدوار غير المذكورة لا تستطيع الوصول؛ المسارات غير المذكورة متاحة لأي مسجّل)
// ---------------------------------------------------------------------------

export const PAGE_ROLES: Record<string, Role[]> = {
  "/settings": ["system_admin"],
  "/backup": ["system_admin"],
  "/data-sources": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
  "/upload": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
  "/google-sync": ["system_admin", "pharmacy_manager"],
  "/data-review": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
  "/dictionary": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
  "/active-ingredients": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
  "/stock-transactions": [
    "system_admin",
    "pharmacy_manager",
    "warehouse_keeper",
    "sub_pharmacist",
  ],
  "/transfers": ["system_admin", "pharmacy_manager", "warehouse_keeper"],
};

/** هل يستطيع المستخدم الوصول لصفحة بمسارها؟ */
export function canAccessPage(roles: Role[], path: string): boolean {
  // طابق أطول مفتاح يبدأ به المسار (لدعم المسارات المتداخلة).
  const key = Object.keys(PAGE_ROLES)
    .filter((p) => path === p || path.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return roles.length > 0; // صفحة عامة لأي مستخدم له دور
  return has(roles, ...PAGE_ROLES[key]);
}

/** التنقّل الجانبي: هل يُعرض هذا المسار لهذا الدور؟ */
export const canSeeNav = (roles: Role[], path: string) => canAccessPage(roles, path);