import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccessPage, isLocationRestricted } from "@/lib/permissions";

export default function ProtectedRoute({ children, path = "/home" }: { children: ReactNode; path?: string }) {
  const { session, loading, roles,access } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        جارٍ التحميل...
      </div>
    );
  if (!session) return <Navigate to="/auth" replace />;
  if (path === "/home" && !access?.configured&&isLocationRestricted(roles)) return <Navigate to="/my-pharmacy" replace />;
  if (!canAccessPage(roles, path,access)) return <div className="p-8" dir="rtl">لا تملك صلاحية هذه الصفحة. <a href="#/account">حسابي</a></div>;
  return <>{children}</>;
}
