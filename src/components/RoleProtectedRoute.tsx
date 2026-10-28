import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccessPage, isLocationRestricted } from "@/lib/permissions";
import { ShieldAlert } from "lucide-react";
import ForcePasswordChange from "@/components/ForcePasswordChange";

/**
 * حماية مسار بالاعتماد على الدور.
 * - غير مسجّل → تحويل لصفحة الدخول.
 * - مسجّل بدون صلاحية للصفحة → رسالة منع وصول (لا يكتفي بإخفاء الزر).
 */
export default function RoleProtectedRoute({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const { session, loading, roles, mustChangePassword,access } = useAuth();

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        جارٍ التحميل...
      </div>
    );

  if (!session) return <Navigate to="/auth" replace />;

  // بوابة إجبارية قبل أي صفحة: تغيير كلمة المرور الافتراضية.
  if (mustChangePassword) return <ForcePasswordChange />;
  if (path === "/home" && !access?.configured&&isLocationRestricted(roles)) return <Navigate to="/my-pharmacy" replace />;

  if (!canAccessPage(roles, path,access)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <ShieldAlert className="w-12 h-12 text-destructive" />
        <h1 className="text-xl font-bold">لا تملك صلاحية الوصول لهذه الصفحة</h1>
        <p className="text-muted-foreground max-w-md">
          هذه الصفحة مخصّصة لأدوار محدّدة. تواصل مع مدير النظام إذا كنت تحتاج صلاحية إضافية.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
