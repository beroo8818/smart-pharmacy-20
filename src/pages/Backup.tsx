import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import NextStep from "@/components/NextStep";
import XLSX from "xlsx-js-style";
import { buildUnifiedHeader } from "@/lib/excelReport";
import { logAudit } from "@/lib/audit";
import { canBackupRestore } from "@/lib/permissions";

type BackupInfo = {
  lastBackupAt: string | null;
  daysSince: number | null;
  totalItems: number;
  totalMovements: number;
  totalTxns: number;
  totalBatches: number;
};

const LS_KEY = "dawa_last_backup_at";

export default function Backup() {
  const { user, roles } = useAuth();
  const isAdmin = canBackupRestore(roles);
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const sb = supabase as any;
      const [im, st, ub] = await Promise.all([
        sb.from("inventory_movements").select("id", { count: "exact", head: true }),
        sb.from("stock_transactions").select("id", { count: "exact", head: true }),
        sb.from("upload_batches").select("id", { count: "exact", head: true }),
      ]);
      const lastBackupAt = localStorage.getItem(LS_KEY);
      const daysSince = lastBackupAt
        ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000)
        : null;
      setInfo({
        lastBackupAt,
        daysSince,
        totalItems: 0,
        totalMovements: im.count || 0,
        totalTxns: st.count || 0,
        totalBatches: ub.count || 0,
      });
    })();
  }, [isAdmin]);

  async function exportFullBackup() {
    if (!user || !isAdmin) return;
    setBusy(true);
    try {
      const sb = supabase as any;
      // اجلب الجداول الأساسية (حتى 10000 صف لكل)
      const tables = [
        "upload_batches", "inventory_movements", "stock_transactions",
        "item_master", "item_aliases", "active_ingredient_dictionary",
        "monthly_stock_movements", "recommendation_actions",
        "import_ignored_rows", "alerts", "transfers", "forecasts",
        "data_quality_issues", "profiles", "user_roles", "locations",
      ];
      const wb = XLSX.utils.book_new();
      const header = buildUnifiedHeader({
        reportTitle: "نسخة احتياطية كاملة",
        source: "Lovable Cloud",
        user: user.email || user.id,
      });
      // ورقة فهرس
      const indexRows: any[][] = [["الجدول", "عدد الصفوف"]];
      for (const t of tables) {
        const { data, error } = await sb.from(t).select("*").limit(10000);
        if (error) {
          indexRows.push([t, `خطأ: ${error.message}`]);
          continue;
        }
        const rows = data || [];
        indexRows.push([t, rows.length]);
        if (!rows.length) continue;
        const cols = Object.keys(rows[0]);
        const aoa = [...header, cols, ...rows.map((r: any) => cols.map((c) => {
          const v = r[c];
          if (v == null) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return v;
        }))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(wb, ws, t.slice(0, 30));
      }
      const wsIndex = XLSX.utils.aoa_to_sheet([...header, ...indexRows]);
      XLSX.utils.book_append_sheet(wb, wsIndex, "فهرس");
      const stamp = new Date().toISOString().substring(0, 10);
      XLSX.writeFile(wb, `نسخة-احتياطية-${stamp}.xlsx`);
      localStorage.setItem(LS_KEY, new Date().toISOString());
      toast.success("تم تصدير النسخة الاحتياطية");
      await logAudit({
        userId: user.id,
        action: "backup_created",
        entityType: "system",
        newValue: { at: new Date().toISOString(), tables: tables.length },
      });
      setInfo((s) => s ? { ...s, lastBackupAt: new Date().toISOString(), daysSince: 0 } : s);
    } catch (e: any) {
      console.error(e);
      toast.error("فشل التصدير: " + (e?.message || ""));
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <div className="font-bold mb-1">صفحة محجوزة لمدير النظام</div>
          <div className="text-sm text-muted-foreground">ليس لديك صلاحية الوصول لهذه الصفحة.</div>
        </Card>
      </div>
    );
  }

  const warn = info?.daysSince != null && info.daysSince >= 7;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="النسخ الاحتياطي"
        description="تصدير نسخة كاملة من بيانات النظام كملف Excel متعدد الأوراق. احتفظ بها في مكان آمن."
      />

      {warn && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-destructive mb-1">
              مرّ على آخر نسخة احتياطية أكثر من {info!.daysSince} يوم
            </div>
            <div className="text-muted-foreground">
              يُنصح بأخذ نسخة احتياطية كل أسبوع على الأكثر.
            </div>
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> آخر نسخة
          </div>
          <div className="text-base font-bold mt-1">
            {info?.lastBackupAt ? new Date(info.lastBackupAt).toLocaleString("ar-EG") : "لم تُنشأ بعد"}
          </div>
          {info?.daysSince != null && (
            <div className={`text-xs mt-1 ${warn ? "text-destructive" : "text-muted-foreground"}`}>
              منذ {info.daysSince} يوم
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">دفعات الرفع</div>
          <div className="text-2xl font-bold mt-1">{info?.totalBatches ?? "…"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">صفوف الأرصدة</div>
          <div className="text-2xl font-bold mt-1">{info?.totalMovements ?? "…"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">حركات يومية</div>
          <div className="text-2xl font-bold mt-1">{info?.totalTxns ?? "…"}</div>
        </Card>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <div className="font-bold text-lg mb-1">تصدير نسخة كاملة (Excel)</div>
          <div className="text-sm text-muted-foreground">
            يصدّر ملف Excel يحتوي على ورقة لكل جدول رئيسي في النظام مع فهرس.
            يُحفظ على جهازك مباشرة — احتفظ به في مكان آمن خارج الجهاز كذلك.
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={exportFullBackup} disabled={busy}>
            <Download className="w-4 h-4 ml-1" />
            {busy ? "جارٍ التصدير…" : "تصدير نسخة احتياطية الآن"}
          </Button>
        </div>
      </Card>

      <NextStep
        title="نصيحة"
        description="بعد تصدير النسخة الاحتياطية، انقلها إلى ذاكرة خارجية أو خدمة سحابية (Google Drive / OneDrive)."
        to="/home"
        cta="رجوع لمركز التشغيل"
      />
    </div>
  );
}