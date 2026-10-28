import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canSeeNav } from "@/lib/permissions";
import {
  LayoutDashboard,
  Upload,
  BookOpen,
  Pill,
  Bell,
  ArrowLeftRight,
  Compass,
  FileBarChart,
  GitCompare,
  History,
  ShieldAlert,
  Sparkles,
  Settings,
  HelpCircle,
  LogOut,
  Target,
  Activity,
  Cloud,
  Database,
  FlaskConical,
  HardDriveDownload,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ROLE_LABEL: Record<string, string> = {
  system_admin: "مدير النظام (system_admin)",
  pharmacy_manager: "مدير الصيدلية (pharmacy_manager)",
  warehouse_keeper: "أمين المخزن (warehouse_keeper)",
  sub_pharmacist: "صيدلي فرعي (sub_pharmacist)",
  viewer: "مشاهد فقط (viewer)",
};

const nav = [
  { to: "/my-pharmacy", label: "صيدليتي والتحديثات", icon: Pill },
  { to: "/branch-access", label: "إدارة الفروع والمستخدمين", icon: Settings },
  { to: "/permissions", label: "صلاحيات المستخدمين", icon: Settings },
  { to: "/data-freshness", label: "متابعة تحديث الصيدليات", icon: History },
  { to: "/report-center", label: "مركز التقارير", icon: FileBarChart },
  { to: "/workflows", label: "دليل التشغيل خطوة بخطوة", icon: HelpCircle },
  { to: "/account", label: "كلمة مرور حسابي", icon: Settings },
  { to: "/home", label: "مركز التشغيل", icon: Compass },
  { to: "/dashboard", label: "اللوحة الرئيسية", icon: LayoutDashboard },
  { to: "/daily", label: "مركز العمل اليومي", icon: Target },
  { to: "/data-sources", label: "مصادر البيانات والتحديثات", icon: Database },
  { to: "/upload", label: "رفع البيانات", icon: Upload },
  { to: "/google-sync", label: "مزامنة Google Sheet", icon: Cloud },
  { to: "/dictionary", label: "قاموس الأصناف", icon: BookOpen },
  { to: "/active-ingredients", label: "قاموس المواد الفعالة", icon: FlaskConical },
  { to: "/items", label: "تحليل الأصناف", icon: Pill },
  { to: "/consumption", label: "منصرف المستشفى", icon: Pill },
  { to: "/alerts", label: "التنبيهات", icon: Bell },
  { to: "/transfers", label: "التحويلات المقترحة", icon: ArrowLeftRight },
  { to: "/stock-transactions", label: "سجل الحركات اليومية", icon: Activity },
  { to: "/what-to-do", label: "ماذا أفعل الآن؟", icon: Compass },
  { to: "/actions-log", label: "سجل الإجراءات", icon: History },
  { to: "/reports", label: "التقارير", icon: FileBarChart },
  { to: "/reports/compare", label: "مقارنة شهر بشهر", icon: GitCompare },
  { to: "/data-review", label: "مراجعة البيانات", icon: ShieldAlert },
  { to: "/assistant", label: "مساعد ذكي", icon: Sparkles },
  { to: "/help", label: "مساعدة", icon: HelpCircle },
  { to: "/settings", label: "الإعدادات", icon: Settings },
  { to: "/backup", label: "النسخ الاحتياطي", icon: HardDriveDownload, adminOnly: true },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, signOut, roles,access } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 shrink-0 border-l border-border bg-card flex flex-col">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">
              د
            </div>
            <div>
              <div className="font-bold text-base leading-none">دواء</div>
              <div className="text-xs text-muted-foreground mt-1">
                إدارة أرصدة المستشفى
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.filter((n) => canSeeNav(roles, n.to,access)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-primary-soft text-primary font-semibold"
                    : "text-foreground/80 hover:bg-muted"
                }`
              }
            >
              <n.icon className="w-4 h-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-2 px-1 truncate">
            {user?.full_name || user?.username}
          </div>
          <div className="mb-3 px-2 py-2 rounded-md bg-primary-soft/50 border border-primary/20">
            <div className="text-[10px] text-muted-foreground mb-1">دورك الحالي</div>
            <div className="text-xs font-semibold text-primary leading-tight">
              {roles.length
                ? roles.map((r) => ROLE_LABEL[r] || r).join("، ")
                : "بدون دور"}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4" /> تسجيل الخروج
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}
