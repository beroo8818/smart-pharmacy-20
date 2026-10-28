import { useMemo } from "react";
import {loadContinuousAnalysis} from "@/lib/continuousAnalysis";
import {currentGroupStock} from "../../shared/currentGroupStock";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Pencil, Unlink, AlertTriangle, Info } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { toast } from "sonner";

type Dict = {
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

type Move = {
  id: string; item_name: string | null; scientific_name: string | null; trade_name: string | null;
  unit: string | null; location_name: string; location_type: string;
  issued_quantity: number | string | null; current_balance: number | string | null;
  source_sheet: string | null; month: string;
};

const num = (v: any) => Number.isFinite(Number(v ?? 0)) ? Number(v ?? 0) : 0;

export default function ActiveIngredientGroup() {
  const { key = "" } = useParams();
  const tgk = decodeURIComponent(key);
  const nav = useNavigate();

  const dictQ = useQuery({
    queryKey: ["aid-group", tgk],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("active_ingredient_dictionary")
        .select("*")
        .eq("therapeutic_group_key", tgk);
      if (error) throw error;
      return (data || []) as Dict[];
    },
  });

  const movQ = useQuery({
    queryKey: ['group-current-stock',tgk,dictQ.data],
    enabled: !!dictQ.data?.length,
    queryFn: () => loadContinuousAnalysis({groupBy:'sku'}),
  });

  const dict = dictQ.data || [];
  const group=currentGroupStock(movQ.data?.rows||[],dict);
  const movements=group.selected.map(r=>({id:r.key,item_name:r.itemName,scientific_name:null,trade_name:r.tradeNames?.join("، ")||null,unit:r.unit,location_name:r.locationName,location_type:r.locationType,current_balance:r.hasBalance?r.balance:null,issued_quantity:r.hasConsumption?r.adc*30:null,source_sheet:null,month:r.snapshotDate}));
  const first = dict[0];
  const hasReview = dict.some((d) => d.needs_review && !d.approved);

  const totals=group.totals,perPharmacy=group.perPharmacy;

  function statusOf(days: number | null) {
    if (days == null) return { label: "بيانات غير كافية", cls: "bg-muted text-muted-foreground" };
    if (days < 7) return { label: "خطر عالي جدًا", cls: "bg-destructive/15 text-destructive" };
    if (days < 14) return { label: "خطر", cls: "bg-destructive/10 text-destructive" };
    if (days < 30) return { label: "أقل من الهدف", cls: "bg-amber-500/15 text-amber-700" };
    if (days < 60) return { label: "آمن", cls: "bg-emerald-500/15 text-emerald-700" };
    if (days < 90) return { label: "زائد", cls: "bg-sky-500/15 text-sky-700" };
    return { label: "زائد جدًا", cls: "bg-sky-500/20 text-sky-800" };
  }
  const st = statusOf(totals.days);

  async function unmerge(d: Dict) {
    const { error } = await (supabase as any)
      .from("active_ingredient_dictionary")
      .update({ therapeutic_group_key: null })
      .eq("id", d.id);
    if (error) return toast.error(error.message);
    toast.success("تم فصل الصنف من المجموعة");
    dictQ.refetch();
  }

  if(dictQ.error||movQ.error)return <p role="alert" className="p-6">تعذر حساب رصيد المجموعة من المصادر الحالية. راجع الاتصال والصلاحيات.</p>;
  return (
    <div dir="rtl" className="p-6 space-y-4 max-w-[1400px]">
      <p className="border p-3">أرصدة حالية للمواقع المتاحة لحسابك، وليست جمعًا لأرصدة الشهور القديمة. المنصرف هنا معياري 30 يومًا وليس إجمالي شهر مختار. لا تجمع تعريفات أو وحدات مختلفة، وراجع اكتمال الصيدليات في مركز التقارير.</p>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ArrowRight className="w-4 h-4 ml-1" /> رجوع</Button>
        <h1 className="text-xl font-bold">{first?.standard_name || tgk}</h1>
        {hasReview && <Badge variant="secondary" className="gap-1"><AlertTriangle className="w-3 h-3" /> توجد أصناف لم يتم اعتماد مطابقتها</Badge>}
      </div>

      <Card className="p-4 text-sm border-primary/20 bg-primary-soft/30 flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <span>تم تجميع هذه الأصناف لأنها تشترك في نفس المادة الفعالة والتركيز والشكل الدوائي والوحدة.</span>
      </Card>

      <Card className="p-5">
        <div className="text-sm text-muted-foreground mb-3">ملخص المجموعة</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">المادة الفعالة</div><div className="font-semibold">{first?.active_ingredient || "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">التركيز</div><div className="font-semibold">{first?.strength || "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">الشكل</div><div className="font-semibold">{first?.dosage_form || "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">الوحدة</div><div className="font-semibold">{first?.unit || "—"}</div></div>
          <div><div className="text-xs text-muted-foreground">عدد الأصناف الأصلية</div><div className="font-semibold">{dict.length}</div></div>
          <div><div className="text-xs text-muted-foreground">إجمالي الرصيد</div><div className="font-semibold">{totals.balance==null?'غير مؤكد':fmtNum(totals.balance)}</div></div>
          <div><div className="text-xs text-muted-foreground">منصرف معياري 30 يومًا</div><div className="font-semibold">{totals.issued==null?'غير مؤكد':fmtNum(totals.issued)}</div></div>
          <div><div className="text-xs text-muted-foreground">متوسط الصرف اليومي</div><div className="font-semibold">{totals.adc==null?'غير مؤكد':fmtNum(totals.adc, 2)}</div></div>
          <div><div className="text-xs text-muted-foreground">أيام التغطية</div><div className="font-semibold">{totals.days == null ? "—" : `${totals.days.toFixed(0)} يوم`}</div></div>
          <div><div className="text-xs text-muted-foreground">الحالة</div><div><Badge className={st.cls}>{st.label}</Badge></div></div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="font-semibold mb-3">الأصناف الأصلية داخل المجموعة ({dict.length})</div>
        <div className="overflow-auto border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-right">الاسم كما في الملف</th>
                <th className="p-2 text-right">الاسم العلمي</th>
                <th className="p-2 text-right">الاسم التجاري</th>
                <th className="p-2 text-right">حالة المطابقة</th>
                <th className="p-2 text-right">مصدر المطابقة</th>
                <th className="p-2 text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {dict.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="p-2">{d.original_item_name}</td>
                  <td className="p-2 text-muted-foreground">{d.scientific_name || "—"}</td>
                  <td className="p-2 text-muted-foreground">{d.trade_name || "—"}</td>
                  <td className="p-2">
                    {d.approved ? <Badge className="bg-emerald-100 text-emerald-700">معتمد</Badge>
                      : d.needs_review ? <Badge variant="secondary">يحتاج مراجعة</Badge>
                      : <Badge variant="outline">جاهز</Badge>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">ثقة {(d.confidence_score * 100).toFixed(0)}%</td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Link to="/active-ingredients"><Button size="sm" variant="ghost"><Pencil className="w-3.5 h-3.5" /> تعديل المطابقة</Button></Link>
                      <Button size="sm" variant="ghost" onClick={() => unmerge(d)}><Unlink className="w-3.5 h-3.5" /> فصل من المجموعة</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <div className="font-semibold mb-3">حسب الصيدلية</div>
        <div className="overflow-auto border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-right">الصيدلية</th>
                <th className="p-2 text-right">إجمالي رصيد المجموعة</th>
                <th className="p-2 text-right">إجمالي منصرف المجموعة</th>
                <th className="p-2 text-right">أيام التغطية</th>
                <th className="p-2 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {perPharmacy.map((p) => {
                const s = statusOf(p.days);
                return (
                  <tr key={p.name} className="border-t">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2">{p.balance==null?'غير مؤكد':fmtNum(p.balance)}</td>
                    <td className="p-2">{p.issued==null?'غير مؤكد':fmtNum(p.issued)}</td>
                    <td className="p-2">{p.days == null ? "—" : `${p.days.toFixed(0)} يوم`}</td>
                    <td className="p-2"><Badge className={s.cls}>{s.label}</Badge></td>
                  </tr>
                );
              })}
              {!perPharmacy.length && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">لا توجد حركات مرتبطة بهذه المجموعة بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
