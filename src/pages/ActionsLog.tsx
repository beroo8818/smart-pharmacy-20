import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

const db = supabase as any;

type Row = {
  id: string;
  upload_batch_id: string;
  recommendation_key: string;
  recommendation_type: string;
  item_name: string | null;
  item_key: string | null;
  from_location: string | null;
  to_location: string | null;
  suggested_qty: number | null;
  executed_qty: number | null;
  match_review_required: boolean;
  override_unreviewed: boolean;
  override_reason: string | null;
  therapeutic_group_key: string | null;
  status: "new" | "approved" | "rejected" | "postponed" | "executed";
  note: string | null;
  acted_by: string;
  acted_at: string;
};

const STATUS_LABEL: Record<Row["status"], string> = {
  new: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", postponed: "مؤجل", executed: "تم التنفيذ",
};
const STATUS_CLASS: Record<Row["status"], string> = {
  new: "bg-muted text-muted-foreground border border-border",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30",
  rejected: "bg-destructive/15 text-destructive border border-destructive/30",
  postponed: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30",
  executed: "bg-primary/15 text-primary border border-primary/30",
};
const TYPE_LABEL: Record<string, string> = {
  dispense_from_main: "صرف من المخزن",
  transfer_between: "تحويل بين صيدليات",
  purchase: "طلب توريد",
  do_not_order: "لا تطلب",
};

export default function ActionsLog() {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const rowsQuery = useQuery({
    queryKey: ["recommendation_actions_log"],
    staleTime: 0, refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db.from("recommendation_actions")
        .select("*")
        .order("acted_at", { ascending: false })
        .range(0, 999);
      if (error) throw error;
      return (data || []) as Row[];
    },
  });

  const usersQuery = useQuery({
    queryKey: ["profiles_for_log"],
    queryFn: async () => {
      const { data } = await db.from("profiles").select("id,name,email").range(0, 999);
      const m: Record<string, { name: string; email: string }> = {};
      for (const p of (data || []) as any[]) m[p.id] = { name: p.name || "", email: p.email || "" };
      return m;
    },
  });
  const users = usersQuery.data || {};

  const rows = rowsQuery.data || [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (typeFilter && r.recommendation_type !== typeFilter) return false;
      if (!s) return true;
      return [r.item_name, r.from_location, r.to_location, r.note, r.override_reason, users[r.acted_by]?.name, users[r.acted_by]?.email]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [rows, q, statusFilter, typeFilter, users]);

  const summary = useMemo(() => {
    const out: Record<Row["status"], number> = { new: 0, approved: 0, rejected: 0, postponed: 0, executed: 0 };
    for (const r of rows) out[r.status]++;
    return out;
  }, [rows]);

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader title="سجل الإجراءات" description="كل الإجراءات على توصيات «ماذا أفعل الآن» — مَن، متى، ماذا اعتمد ونفّذ." />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {(Object.keys(STATUS_LABEL) as Row["status"][]).map((s) => (
          <Card key={s} className="p-4">
            <div className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</div>
            <div className="text-2xl font-bold mt-1">{summary[s]}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الحالة</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">كل الحالات</option>
              {(Object.keys(STATUS_LABEL) as Row["status"][]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">نوع التوصية</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">كل الأنواع</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="الصنف، الصيدلية، المستخدم..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {rowsQuery.isLoading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : rowsQuery.error ? (
        <Card className="p-6 text-destructive">تعذر التحميل. {(rowsQuery.error as any)?.message}</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد إجراءات بعد.</Card>
      ) : (
        <Card className="p-2">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-right p-2 whitespace-nowrap">التاريخ</th>
                  <th className="text-right p-2">الحالة</th>
                  <th className="text-right p-2">النوع</th>
                  <th className="text-right p-2 min-w-[200px]">الصنف</th>
                  <th className="text-right p-2">من</th>
                  <th className="text-right p-2">إلى</th>
                  <th className="text-right p-2 whitespace-nowrap">مقترحة</th>
                  <th className="text-right p-2 whitespace-nowrap">منفذة</th>
                  <th className="text-right p-2 whitespace-nowrap">تجاوز</th>
                  <th className="text-right p-2 min-w-[140px]">المستخدم</th>
                  <th className="text-right p-2 min-w-[180px]">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const u = users[r.acted_by];
                  return (
                    <tr key={r.id} className="border-b border-border/50 align-top">
                      <td className="p-2 whitespace-nowrap text-xs" dir="ltr">{new Date(r.acted_at).toLocaleString("ar-EG")}</td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded text-[11px] ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td className="p-2 text-xs">{TYPE_LABEL[r.recommendation_type] || r.recommendation_type}</td>
                      <td className="p-2 whitespace-normal break-words" dir="auto">{r.item_name || "—"}</td>
                      <td className="p-2 whitespace-normal break-words" dir="auto">{r.from_location || "—"}</td>
                      <td className="p-2 whitespace-normal break-words" dir="auto">{r.to_location || "—"}</td>
                      <td className="p-2 whitespace-nowrap">{r.suggested_qty ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap font-semibold">{r.executed_qty ?? "—"}</td>
                      <td className="p-2 text-xs">
                        {r.override_unreviewed ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/30">نعم</span>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-xs" dir="auto">{u?.name || u?.email || r.acted_by.slice(0, 8)}</td>
                      <td className="p-2 text-xs whitespace-normal break-words" dir="auto">{r.override_reason || r.note || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
