import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { buildDictionaryDraft, buildStandardName, buildTherapeuticGroupKey } from "@/lib/activeIngredient";
import { CheckCircle2, Pencil, Link2, Unlink, Search, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logAudit } from "@/lib/audit";

type Row = {
  id: string;
  original_item_name: string;
  scientific_name: string | null;
  trade_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  unit: string | null;
  standard_name: string | null;
  therapeutic_group_key: string | null;
  confidence_score: number;
  needs_review: boolean;
  approved: boolean;
};

export default function ActiveIngredients() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [edit, setEdit] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeKey, setMergeKey] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .select("*")
      .order("needs_review", { ascending: false })
      .order("original_item_name");
    if (error) toast.error(error.message);
    setRows((data || []) as Row[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "review" && !r.needs_review) return false;
      if (tab === "approved" && !r.approved) return false;
      if (tab === "low" && r.confidence_score >= 0.6) return false;
      if (!term) return true;
      return [r.original_item_name, r.scientific_name, r.trade_name, r.active_ingredient, r.standard_name, r.therapeutic_group_key]
        .some((v) => (v || "").toLowerCase().includes(term));
    });
  }, [rows, q, tab]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function approve(r: Row) {
    const { error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .update({ approved: true, needs_review: false })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user?.id,
      action: "active_ingredient_approved",
      entityType: "active_ingredient_dictionary",
      entityId: r.id,
      oldValue: { approved: r.approved, needs_review: r.needs_review },
      newValue: { approved: true, needs_review: false, original_item_name: r.original_item_name },
    });
    toast.success("تم اعتماد الصنف");
    load();
  }

  async function saveEdit() {
    if (!edit) return;
    const tgk = buildTherapeuticGroupKey({
      active_ingredient: edit.active_ingredient,
      strength: edit.strength,
      dosage_form: edit.dosage_form,
      unit: edit.unit,
    });
    const sn = buildStandardName({
      active_ingredient: edit.active_ingredient,
      strength: edit.strength,
      dosage_form: edit.dosage_form,
    });
    const { error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .update({
        scientific_name: edit.scientific_name,
        trade_name: edit.trade_name,
        active_ingredient: edit.active_ingredient,
        strength: edit.strength,
        dosage_form: edit.dosage_form,
        unit: edit.unit,
        therapeutic_group_key: tgk,
        standard_name: sn,
      })
      .eq("id", edit.id);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user?.id,
      action: "active_ingredient_edited",
      entityType: "active_ingredient_dictionary",
      entityId: edit.id,
      oldValue: rows.find((r) => r.id === edit.id) as any,
      newValue: { ...edit, therapeutic_group_key: tgk, standard_name: sn } as any,
    });
    toast.success("تم الحفظ");
    setEdit(null);
    load();
  }

  async function mergeSelected() {
    if (selected.size < 2) { toast.error("اختر صفّين على الأقل للدمج"); return; }
    if (!mergeKey.trim()) { toast.error("أدخل مفتاح المجموعة العلاجية"); return; }
    const ids = Array.from(selected);
    const { error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .update({ therapeutic_group_key: mergeKey.trim() })
      .in("id", ids);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user?.id,
      action: "active_ingredient_merged",
      entityType: "active_ingredient_dictionary",
      entityId: mergeKey.trim(),
      newValue: { ids, therapeutic_group_key: mergeKey.trim() },
    });
    toast.success(`تم دمج ${ids.length} صنف في مجموعة واحدة`);
    setSelected(new Set());
    setMergeOpen(false);
    setMergeKey("");
    load();
  }

  async function unmergeOne(r: Row) {
    const { error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .update({ therapeutic_group_key: null })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    await logAudit({
      userId: user?.id,
      action: "active_ingredient_unmerged",
      entityType: "active_ingredient_dictionary",
      entityId: r.id,
      oldValue: { therapeutic_group_key: r.therapeutic_group_key, original_item_name: r.original_item_name },
      newValue: { therapeutic_group_key: null },
    });
    toast.success("تم فصل الصنف من المجموعة");
    load();
  }

  async function recomputeFromImports() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("item_name,scientific_name,trade_name,unit")
        .limit(5000);
      if (error) throw error;
      const seen = new Set(rows.map((r) => r.original_item_name.toLowerCase()));
      const toInsert: any[] = [];
      const map = new Map<string, any>();
      (data || []).forEach((m: any) => {
        const draft = buildDictionaryDraft({
          original_item_name: m.item_name,
          scientific_name: m.scientific_name,
          trade_name: m.trade_name,
          unit: m.unit,
        });
        if (!draft) return;
        const key = draft.original_item_name.toLowerCase();
        if (seen.has(key) || map.has(key)) return;
        map.set(key, draft);
      });
      map.forEach((v) => toInsert.push(v));
      if (!toInsert.length) { toast.info("لا توجد أصناف جديدة لإضافتها"); return; }
      for (let i = 0; i < toInsert.length; i += 200) {
        const { error: err } = await (supabase as any)
          .from("active_ingredient_dictionary")
          .insert(toInsert.slice(i, i + 200));
        if (err) throw err;
      }
      await logAudit({
        userId: user?.id,
        action: "active_ingredient_recomputed",
        entityType: "active_ingredient_dictionary",
        newValue: { insertedCount: toInsert.length },
      });
      toast.success(`أُضيف ${toInsert.length} صنف إلى القاموس`);
      load();
    } catch (e: any) {
      toast.error(e.message || "فشل التحديث");
    } finally { setLoading(false); }
  }

  return (
    <div dir="rtl" className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">قاموس المواد الفعالة</h1>
          <p className="text-sm text-muted-foreground">توحيد أسماء الأصناف المستوردة عبر الاسم العلمي، التجاري، والمادة الفعالة</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={recomputeFromImports} disabled={loading}>
            <RefreshCw className="w-4 h-4 ml-2" /> استخراج من الأصناف المستوردة
          </Button>
          <Button
            variant="outline"
            disabled={selected.size < 2}
            onClick={() => setMergeOpen(true)}
          >
            <Link2 className="w-4 h-4 ml-2" /> دمج المختار ({selected.size})
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم الأصلي، العلمي، التجاري، أو المادة الفعالة..." className="pr-9" />
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">الكل ({rows.length})</TabsTrigger>
            <TabsTrigger value="review">يحتاج مراجعة ({rows.filter(r => r.needs_review).length})</TabsTrigger>
            <TabsTrigger value="low">ثقة منخفضة ({rows.filter(r => r.confidence_score < 0.6).length})</TabsTrigger>
            <TabsTrigger value="approved">معتمد ({rows.filter(r => r.approved).length})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            <div className="overflow-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="p-2 w-10"></th>
                    <th className="p-2 text-right">الاسم الأصلي</th>
                    <th className="p-2 text-right">الاسم العلمي</th>
                    <th className="p-2 text-right">الاسم التجاري</th>
                    <th className="p-2 text-right">المادة الفعالة</th>
                    <th className="p-2 text-right">التركيز</th>
                    <th className="p-2 text-right">الشكل</th>
                    <th className="p-2 text-right">الوحدة</th>
                    <th className="p-2 text-right">الاسم الموحد</th>
                    <th className="p-2 text-right">الثقة</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">جارٍ التحميل...</td></tr>
                  )}
                  {!loading && !filtered.length && (
                    <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">لا توجد بيانات. استخدم زر "استخراج من الأصناف المستوردة" لبدء بناء القاموس.</td></tr>
                  )}
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <td className="p-2">{r.original_item_name}</td>
                      <td className="p-2 text-muted-foreground">{r.scientific_name || "—"}</td>
                      <td className="p-2 text-muted-foreground">{r.trade_name || "—"}</td>
                      <td className="p-2">{r.active_ingredient || <span className="text-destructive">ناقص</span>}</td>
                      <td className="p-2">{r.strength || <span className="text-destructive">ناقص</span>}</td>
                      <td className="p-2">{r.dosage_form || <span className="text-destructive">ناقص</span>}</td>
                      <td className="p-2">{r.unit || "—"}</td>
                      <td className="p-2 font-medium">{r.standard_name || "—"}</td>
                      <td className="p-2">{(r.confidence_score * 100).toFixed(0)}%</td>
                      <td className="p-2">
                        {r.approved ? (
                          <Badge className="bg-emerald-100 text-emerald-700">معتمد</Badge>
                        ) : r.needs_review ? (
                          <Badge variant="secondary">يحتاج مراجعة</Badge>
                        ) : (
                          <Badge variant="outline">جاهز</Badge>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEdit(r)} title="تعديل">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {!r.approved && (
                            <Button size="sm" variant="ghost" onClick={() => approve(r)} title="اعتماد"
                              disabled={r.confidence_score < 0.5}>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            </Button>
                          )}
                          {r.therapeutic_group_key && (
                            <Button size="sm" variant="ghost" onClick={() => unmergeOne(r)} title="فصل من المجموعة">
                              <Unlink className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات الصنف</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>الاسم الأصلي</Label>
                <Input value={edit.original_item_name} disabled />
              </div>
              <div>
                <Label>الاسم العلمي</Label>
                <Input value={edit.scientific_name || ""} onChange={(e) => setEdit({ ...edit, scientific_name: e.target.value })} />
              </div>
              <div>
                <Label>الاسم التجاري</Label>
                <Input value={edit.trade_name || ""} onChange={(e) => setEdit({ ...edit, trade_name: e.target.value })} />
              </div>
              <div>
                <Label>المادة الفعالة</Label>
                <Input value={edit.active_ingredient || ""} onChange={(e) => setEdit({ ...edit, active_ingredient: e.target.value })} />
              </div>
              <div>
                <Label>التركيز</Label>
                <Input value={edit.strength || ""} onChange={(e) => setEdit({ ...edit, strength: e.target.value })} placeholder="مثال: 500 mg" />
              </div>
              <div>
                <Label>الشكل الدوائي</Label>
                <Input value={edit.dosage_form || ""} onChange={(e) => setEdit({ ...edit, dosage_form: e.target.value })} placeholder="vial, tab, cap..." />
              </div>
              <div>
                <Label>الوحدة</Label>
                <Input value={edit.unit || ""} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>إلغاء</Button>
            <Button onClick={saveEdit}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>دمج {selected.size} صنف في مجموعة علاجية</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>مفتاح المجموعة العلاجية</Label>
            <Input value={mergeKey} onChange={(e) => setMergeKey(e.target.value)} placeholder="مثال: ceftriaxone | 1 gm | vial | vial" />
            <p className="text-xs text-muted-foreground">سيتم وضع كل الأصناف المختارة تحت نفس مفتاح المجموعة.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>إلغاء</Button>
            <Button onClick={mergeSelected}>دمج</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
