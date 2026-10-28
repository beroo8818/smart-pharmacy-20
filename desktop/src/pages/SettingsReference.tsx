// Archived source of the old cloud-backed settings screen; not routed in the local app.
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = {
  system_admin: "مدير النظام",
  pharmacy_manager: "مدير صيدليات",
  sub_pharmacist: "صيدلي فرعي",
  warehouse_keeper: "أمين مخزن",
  viewer: "مشاهد",
};
const ROLES = Object.keys(ROLE_LABEL) as Array<keyof typeof ROLE_LABEL>;

interface UserRow {
  id: string;
  name: string;
  email: string;
  assigned_location_id: string | null;
  roles: string[];
}

export default function Settings() {
  const { user, roles, hasRole } = useAuth();
  const isAdmin = hasRole("system_admin");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAdminData() {
    setLoading(true);
    const [{ data: profiles }, { data: ur }, { data: locs }, { data: audit }] = await Promise.all([
      supabase.from("profiles").select("id,name,email,assigned_location_id"),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("locations").select("id,name"),
      supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    const rolesByUser = new Map<string, string[]>();
    (ur || []).forEach((r: any) => {
      const arr = rolesByUser.get(r.user_id) || [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    setUsers(
      (profiles || []).map((p: any) => ({ ...p, roles: rolesByUser.get(p.id) || [] }))
    );
    setLocations(locs || []);
    setAuditRows(audit || []);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) loadAdminData();
  }, [isAdmin]);

  async function toggleRole(uid: string, role: string, has: boolean) {
    if (has) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role as any);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("user_roles").insert({ user_id: uid, role: role as any });
      if (error) return toast.error(error.message);
    }
    await supabase.from("audit_log").insert({
      user_id: user?.id, action: has ? "role_remove" : "role_add",
      entity_type: "user_role", entity_id: uid, new_value: { role },
    });
    toast.success("تم التحديث");
    loadAdminData();
  }

  async function setLocation(uid: string, locId: string | null) {
    const { error } = await supabase.from("profiles").update({ assigned_location_id: locId }).eq("id", uid);
    if (error) return toast.error(error.message);
    await supabase.from("audit_log").insert({
      user_id: user?.id, action: "set_location",
      entity_type: "profile", entity_id: uid, new_value: { assigned_location_id: locId },
    });
    toast.success("تم تعيين الموقع");
    loadAdminData();
  }

  async function wipeAllData() {
    if (!confirm("تحذير: سيتم حذف كل البيانات المرفوعة (الأصناف، الأرصدة، الدفعات، التنبيهات، التحويلات). لن يتم حذف المستخدمين أو المواقع. هل أنت متأكد؟")) return;
    if (!confirm("تأكيد أخير: لا يمكن التراجع عن هذا الإجراء. متابعة؟")) return;
    const { error } = await supabase.rpc("wipe_all_inventory_data" as any);
    if (error) return toast.error(error.message);
    toast.success("تم مسح كل البيانات المرفوعة");
    loadAdminData();
  }

  return (
    <div className="p-8 max-w-[1200px]">
      <PageHeader title="الإعدادات" description="بيانات الحساب والصلاحيات وإدارة المستخدمين." />

      <Card className="p-5 mb-4">
        <div className="font-bold mb-3">الحساب</div>
        <div className="text-sm">المستخدم: <span className="text-muted-foreground">{user?.full_name || user?.username}</span></div>
        <div className="text-sm mt-2">
          الأدوار:{" "}
          <span className="text-muted-foreground">
            {roles.map((r) => ROLE_LABEL[r] || r).join("، ") || "لا يوجد"}
          </span>
        </div>
      </Card>

      <Card className="p-5 mb-4">
        <div className="font-bold mb-3">ثوابت الحسابات</div>
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>• مخزون الأمان = AMC × ٢٥٪</li>
          <li>• نقطة إعادة الطلب = AMC × (مدة التوريد/٣٠) + مخزون الأمان</li>
          <li>• حد الزيادة = أكثر من ٦ أشهر تغطية</li>
          <li>• حد الراكد = ٦ شهور بدون صرف</li>
          <li>• تنبيه قرب الانتهاء = أقل من ٦ أشهر للتاريخ</li>
        </ul>
      </Card>

      {isAdmin && (
        <>
          <Card className="p-5 mb-4">
            <div className="flex justify-between items-center mb-3">
              <div className="font-bold">إدارة المستخدمين والأدوار</div>
              <Button size="sm" variant="outline" onClick={loadAdminData} disabled={loading}>
                تحديث
              </Button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-right p-2">البريد</th>
                    <th className="text-right p-2">الاسم</th>
                    <th className="text-right p-2">الموقع المُعيَّن</th>
                    <th className="text-right p-2">الأدوار</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border/50 align-top">
                      <td className="p-2">{u.email}</td>
                      <td className="p-2">{u.name || "—"}</td>
                      <td className="p-2">
                        <select
                          className="bg-background border border-border rounded px-2 py-1 text-xs"
                          value={u.assigned_location_id || ""}
                          onChange={(e) => setLocation(u.id, e.target.value || null)}
                        >
                          <option value="">— بدون —</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {ROLES.map((r) => {
                            const has = u.roles.includes(r);
                            return (
                              <button
                                key={r}
                                onClick={() => toggleRole(u.id, r, has)}
                                className={`text-xs px-2 py-1 rounded border transition ${
                                  has
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                                }`}
                              >
                                {ROLE_LABEL[r]}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && !loading && (
                    <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا يوجد مستخدمون</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <div className="font-bold mb-3">سجل التدقيق (آخر ٥٠ عملية)</div>
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-right p-2">التاريخ</th>
                    <th className="text-right p-2">الإجراء</th>
                    <th className="text-right p-2">الكيان</th>
                    <th className="text-right p-2">المعرّف</th>
                    <th className="text-right p-2">التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="p-2 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                      <td className="p-2">{a.action}</td>
                      <td className="p-2 text-muted-foreground">{a.entity_type || "—"}</td>
                      <td className="p-2 font-mono text-xs">{(a.entity_id || "").substring(0, 8)}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {a.new_value ? JSON.stringify(a.new_value) : "—"}
                      </td>
                    </tr>
                  ))}
                  {auditRows.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد عمليات بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5 mt-4 border-2 border-destructive/40">
            <div className="font-bold text-destructive mb-2">منطقة خطرة — مسح كل البيانات</div>
            <p className="text-sm text-muted-foreground mb-3">
              يحذف كل الأصناف والأرصدة والدفعات المرفوعة والتنبيهات والتحويلات. لا يحذف المستخدمين أو المواقع. لا يمكن التراجع.
            </p>
            <Button variant="destructive" size="sm" onClick={wipeAllData}>
              مسح كل البيانات المرفوعة
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
