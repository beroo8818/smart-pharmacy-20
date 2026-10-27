import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FlaskConical, Layers, AlertTriangle, FileSearch, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import XLSX from "xlsx-js-style";
import { fetchLatestBatch, fetchMovementsByBatch } from "@/lib/batchAnalysis";

type Dict = {
  original_item_name: string;
  scientific_name: string | null; trade_name: string | null;
  active_ingredient: string | null; strength: string | null; dosage_form: string | null; unit: string | null;
  standard_name: string | null; therapeutic_group_key: string | null;
  confidence_score: number; needs_review: boolean; approved: boolean;
};
const num = (v: any) => Number.isFinite(Number(v ?? 0)) ? Number(v ?? 0) : 0;

function statusOf(days: number | null) {
  if (days == null) return "بيانات غير كافية";
  if (days < 7) return "خطر عالي جدًا";
  if (days < 14) return "خطر";
  if (days < 30) return "أقل من الهدف";
  if (days < 60) return "آمن";
  if (days < 90) return "زائد";
  return "زائد جدًا";
}
function actionOf(days: number | null) {
  if (days == null) return "راجع البيانات";
  if (days < 14) return "اطلب توريد عاجل أو حوّل من صيدلية فائض";
  if (days < 30) return "تابع وادعم بالصرف من المخزن";
  if (days > 90) return "أعد التوزيع أو قلل الطلبيات";
  return "ضمن الحد الآمن";
}

function exportMultiSheet(name: string, sheets: { name: string; rows: any[] }[]) {
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  sheets.forEach((s) => {
    const rows = s.rows.length ? s.rows : [{ ملاحظة: "لا توجد بيانات" }];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, `${name.replace(/[\\/?*:[\]]/g, "_")}.xlsx`);
}

export default function ActiveIngredientReports() {
  const batchQ = useQuery({ queryKey: ["latest-batch-air"], queryFn: fetchLatestBatch });
  const batch = batchQ.data || null;
  const movQ = useQuery({
    queryKey: ["movements-air", batch?.id],
    enabled: !!batch?.id,
    queryFn: () => fetchMovementsByBatch(batch!.id),
  });
  const dictQ = useQuery({
    queryKey: ["aid-dict-air"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("active_ingredient_dictionary").select("*").range(0, 49999);
      return (data || []) as Dict[];
    },
  });

  const dictMap = useMemo(() => {
    const m = new Map<string, Dict>();
    (dictQ.data || []).forEach((d) => m.set((d.original_item_name || "").toLowerCase(), d));
    return m;
  }, [dictQ.data]);

  const meta = {
    "الشهر": batch?.month || "",
    "تاريخ الرصيد": new Date().toLocaleDateString("ar-EG"),
    "مصدر البيانات": batch?.file_name || "",
  };
  const movements = movQ.data || [];

  function metaRow(method: string) {
    const reviewed = (dictQ.data || []).filter((d) => d.needs_review && !d.approved).length;
    const groups = new Set((dictQ.data || []).map((d) => d.therapeutic_group_key).filter(Boolean)).size;
    return {
      ...meta,
      "طريقة التحليل": method,
      "عدد الأصناف الأصلية": (dictQ.data || []).length,
      "عدد المجموعات العلاجية": groups,
      "عدد الأصناف التي تحتاج مراجعة": reviewed,
    };
  }

  function buildByRaw() {
    return movements.map((m: any) => {
      const balance = num(m.current_balance), issued = num(m.issued_quantity);
      const adc = issued / 30; const days = adc > 0 ? balance / adc : null;
      return {
        "الصيدلية": m.location_name, "الصنف": m.item_name,
        "الرصيد": balance, "المنصرف": issued, "متوسط يومي": Number(adc.toFixed(2)),
        "أيام التغطية": days == null ? "" : Math.round(days),
        "الحالة": statusOf(days), "التوصية": actionOf(days),
      };
    });
  }

  function buildBy(keyFn: (m: any) => string | null, labelFn: (m: any, d?: Dict) => string) {
    const groups = new Map<string, { label: string; balance: number; issued: number; dicts: Set<string>; reviews: number }>();
    movements.forEach((m: any) => {
      const d = dictMap.get((m.item_name || "").toLowerCase());
      const k = keyFn(m);
      if (!k) return;
      const cur = groups.get(k) || { label: labelFn(m, d), balance: 0, issued: 0, dicts: new Set(), reviews: 0 };
      cur.balance += num(m.current_balance);
      cur.issued += num(m.issued_quantity);
      if (d) {
        cur.dicts.add(d.original_item_name);
        if (d.needs_review && !d.approved) cur.reviews += 1;
      }
      groups.set(k, cur);
    });
    return Array.from(groups.entries()).map(([k, v]) => {
      const adc = v.issued / 30;
      const days = adc > 0 ? v.balance / adc : null;
      const d = (dictQ.data || []).find((x) => keyFn({ item_name: x.original_item_name } as any) === k);
      return {
        "اسم المجموعة": v.label,
        "المادة الفعالة": d?.active_ingredient || "",
        "التركيز": d?.strength || "",
        "الشكل": d?.dosage_form || "",
        "الوحدة": d?.unit || "",
        "عدد الأصناف الأصلية": v.dicts.size,
        "تحتاج مراجعة": v.reviews,
        "إجمالي الرصيد": v.balance,
        "إجمالي المنصرف": v.issued,
        "متوسط يومي": Number(adc.toFixed(2)),
        "أيام التغطية": days == null ? "" : Math.round(days),
        "الحالة": statusOf(days),
        "التوصية": actionOf(days),
      };
    });
  }

  function reviewSheet() {
    return (dictQ.data || []).filter((d) => d.needs_review && !d.approved).map((d) => ({
      "الاسم الأصلي": d.original_item_name,
      "الاسم العلمي": d.scientific_name || "",
      "الاسم التجاري": d.trade_name || "",
      "المادة الفعالة": d.active_ingredient || "",
      "التركيز": d.strength || "",
      "الشكل": d.dosage_form || "",
      "الوحدة": d.unit || "",
      "درجة الثقة %": Math.round(d.confidence_score * 100),
    }));
  }

  const reports = [
    { id: "raw", title: "تقرير حسب الصنف كما في الملف", icon: ListChecks, method: "raw",
      build: () => [{ name: "بيانات", rows: [metaRow("حسب الصنف كما في الملف")] }, { name: "الأصناف", rows: buildByRaw() }, { name: "يحتاج مراجعة", rows: reviewSheet() }] },
    { id: "ai", title: "تقرير حسب المادة الفعالة", icon: FlaskConical, method: "active_ingredient",
      build: () => [{ name: "بيانات", rows: [metaRow("حسب المادة الفعالة فقط")] },
        { name: "المجموعات", rows: buildBy(
          (m) => { const d = dictMap.get((m.item_name || "").toLowerCase()); return d?.active_ingredient ? `AI::${d.active_ingredient.toLowerCase()}` : null; },
          (_m, d) => d?.active_ingredient || "—") },
        { name: "يحتاج مراجعة", rows: reviewSheet() }] },
    { id: "tgk", title: "تقرير حسب المادة الفعالة + التركيز + الشكل", icon: Layers, method: "tgk",
      build: () => [{ name: "بيانات", rows: [metaRow("حسب المادة + التركيز + الشكل")] },
        { name: "المجموعات", rows: buildBy(
          (m) => { const d = dictMap.get((m.item_name || "").toLowerCase()); return d?.therapeutic_group_key || null; },
          (_m, d) => d?.standard_name || d?.therapeutic_group_key || "—") },
        { name: "يحتاج مراجعة", rows: reviewSheet() }] },
    { id: "review", title: "الأصناف التي تحتاج مراجعة مطابقة", icon: FileSearch, method: "review",
      build: () => [{ name: "بيانات", rows: [metaRow("مراجعة مطابقة")] }, { name: "يحتاج مراجعة", rows: reviewSheet() }] },
    { id: "critical_groups", title: "تقرير المجموعات العلاجية الحرجة", icon: AlertTriangle, method: "tgk_critical",
      build: () => {
        const all = buildBy(
          (m) => { const d = dictMap.get((m.item_name || "").toLowerCase()); return d?.therapeutic_group_key || null; },
          (_m, d) => d?.standard_name || d?.therapeutic_group_key || "—");
        const crit = all.filter((r) => ["خطر عالي جدًا", "خطر", "أقل من الهدف"].includes(r["الحالة"] as string));
        return [{ name: "بيانات", rows: [metaRow("مجموعات حرجة")] }, { name: "المجموعات الحرجة", rows: crit }, { name: "يحتاج مراجعة", rows: reviewSheet() }];
      }},
  ];

  const loading = batchQ.isLoading || movQ.isLoading || dictQ.isLoading;

  return (
    <Card className="p-5 mt-6">
      <div className="mb-3">
        <div className="font-bold">تقارير المواد الفعالة والمجموعات العلاجية</div>
        <div className="text-xs text-muted-foreground mt-1">تقارير مبنية على قاموس المواد الفعالة، مع ورقة منفصلة في كل ملف للأصناف التي تحتاج مراجعة.</div>
      </div>
      {loading ? <div className="text-muted-foreground text-sm">جارٍ التحميل...</div> : (
        <div className="grid md:grid-cols-2 gap-3">
          {reports.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.id} className="border rounded-md p-3 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-primary/10 text-primary"><Icon className="w-4 h-4" /></div>
                  <div className="font-medium text-sm">{r.title}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => exportMultiSheet(r.title, r.build())}>
                  <Download className="w-4 h-4" /> تنزيل
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}