import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import XLSX from "xlsx-js-style";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeMovements,
  fetchMovementsByBatch,
  AnalysisRow,
  AlertKind,
  KIND_LABEL,
  KIND_CLASS,
  KIND_ORDER,
  sortBatchesForAnalysis,
} from "@/lib/batchAnalysis";
import { fmtMonth, fmtNum } from "@/lib/format";
import ItemIdentity from "@/components/ItemIdentity";

type Batch = {
  id: string;
  file_name: string;
  month: string;
  rows_saved: number;
  status: string;
  created_at: string;
  snapshot_date?: string | null;
  batch_kind?: string | null;
};

const KIND_RANK: Record<AlertKind, number> = {
  critical: 0,
  danger: 1,
  below: 2,
  no_data: 3,
  deadstock: 4,
  safe: 5,
  over: 6,
  very_over: 7,
};
const worsened = (a: AlertKind, b: AlertKind) => KIND_RANK[b] < KIND_RANK[a];
const improved = (a: AlertKind, b: AlertKind) => KIND_RANK[b] > KIND_RANK[a];
const isCritical = (k: AlertKind) =>
  k === "critical" || k === "danger" || k === "below";

type CompareRow = {
  key: string;
  itemKey: string;
  itemName: string;
  tradeNames: string[];
  itemCode: string | null;
  locationName: string;
  locationType: string;
  issued1: number;
  issued2: number;
  balance1: number;
  balance2: number;
  days1: number | null;
  days2: number | null;
  kind1: AlertKind;
  kind2: AlertKind;
  changePct: number | null;
  explanation: string;
};

function pct(a: number, b: number): number | null {
  if (a === 0 && b === 0) return 0;
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}

function explain(r: CompareRow): string {
  const loc = r.locationName || "الصيدلية";
  // أولوية: إذا تغيّر الصرف بشكل ملحوظ وتغيّرت التغطية → جملة مركّبة شبيهة بالمثال
  if (
    r.changePct != null &&
    Math.abs(r.changePct) >= 15 &&
    r.days1 != null &&
    r.days2 != null &&
    Math.abs(r.days2 - r.days1) >= 2
  ) {
    const dir = r.changePct > 0 ? "زاد" : "قل";
    const covDir = r.days2 < r.days1 ? "انخفضت" : "ارتفعت";
    return `صرف هذا الصنف ${dir} بنسبة ${Math.abs(r.changePct).toFixed(0)}% في ${loc}، لذلك ${covDir} التغطية من ${r.days1.toFixed(0)} يوم إلى ${r.days2.toFixed(0)} يوم.`;
  }

  const parts: string[] = [];
  if (r.changePct == null) {
    if (r.issued2 > 0) parts.push(`بدأ الصرف في ${loc} بعد توقف سابق.`);
    else if (r.issued1 > 0) parts.push(`توقّف الصرف تمامًا في ${loc}.`);
  } else if (r.changePct > 25) parts.push(`زاد الصرف في ${loc} بنسبة ${r.changePct.toFixed(0)}%.`);
  else if (r.changePct < -25) parts.push(`قلّ الصرف في ${loc} بنسبة ${Math.abs(r.changePct).toFixed(0)}%.`);
  else if (Math.abs(r.changePct) >= 5) parts.push(`تغيّر الصرف بنسبة ${r.changePct.toFixed(0)}%.`);
  else parts.push("الصرف ثابت تقريبًا.");

  if (worsened(r.kind1, r.kind2))
    parts.push(`والحالة تدهورت من "${KIND_LABEL[r.kind1]}" إلى "${KIND_LABEL[r.kind2]}".`);
  else if (improved(r.kind1, r.kind2))
    parts.push(`والحالة تحسّنت من "${KIND_LABEL[r.kind1]}" إلى "${KIND_LABEL[r.kind2]}".`);

  if (r.days1 != null && r.days2 != null) {
    const d = r.days2 - r.days1;
    if (Math.abs(d) >= 3)
      parts.push(`التغطية ${d > 0 ? "ارتفعت" : "انخفضت"} من ${r.days1.toFixed(0)} إلى ${r.days2.toFixed(0)} يوم.`);
  }
  return parts.join(" ");
}

function buildCompare(rowsA: AnalysisRow[], rowsB: AnalysisRow[]): CompareRow[] {
  const map = new Map<string, CompareRow>();
  for (const r of rowsA) {
    map.set(r.key, {
      key: r.key,
      itemKey: r.itemKey,
      itemName: r.itemName,
      tradeNames: r.tradeNames,
      itemCode: r.itemCode,
      locationName: r.locationName,
      locationType: r.locationType,
      issued1: r.issued,
      issued2: 0,
      balance1: r.balance,
      balance2: 0,
      days1: r.days,
      days2: null,
      kind1: r.kind,
      kind2: "no_data",
      changePct: null,
      explanation: "",
    });
  }
  for (const r of rowsB) {
    const cur = map.get(r.key);
    if (cur) {
      cur.issued2 = r.issued;
      cur.balance2 = r.balance;
      cur.days2 = r.days;
      cur.kind2 = r.kind;
      cur.tradeNames = Array.from(new Set([...cur.tradeNames, ...r.tradeNames]));
    } else {
      map.set(r.key, {
        key: r.key,
        itemKey: r.itemKey,
        itemName: r.itemName,
        tradeNames: r.tradeNames,
        itemCode: r.itemCode,
        locationName: r.locationName,
        locationType: r.locationType,
        issued1: 0,
        issued2: r.issued,
        balance1: 0,
        balance2: r.balance,
        days1: null,
        days2: r.days,
        kind1: "no_data",
        kind2: r.kind,
        changePct: null,
        explanation: "",
      });
    }
  }
  const out = Array.from(map.values());
  for (const r of out) {
    r.changePct = pct(r.issued1, r.issued2);
    r.explanation = explain(r);
  }
  return out;
}

export default function CompareMonths() {
  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ["compare-batches"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("upload_batches")
        .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return sortBatchesForAnalysis((data || []) as Batch[]);
    },
  });

  const [batchA, setBatchA] = useState<string>("");
  const [batchB, setBatchB] = useState<string>("");
  const [pharmacyFilter, setPharmacyFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | AlertKind>("all");
  const [minChange, setMinChange] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);

  // Auto-pick the two newest batches once loaded
  useMemo(() => {
    if (!batchA && !batchB && batches.length >= 2) {
      setBatchB(batches[0].id);
      setBatchA(batches[1].id);
    } else if (!batchA && batches.length >= 1) {
      setBatchA(batches[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches.length]);

  const { data: movA = [] } = useQuery({
    queryKey: ["compare-mov", batchA],
    enabled: !!batchA,
    queryFn: () => fetchMovementsByBatch(batchA),
  });
  const { data: movB = [] } = useQuery({
    queryKey: ["compare-mov", batchB],
    enabled: !!batchB,
    queryFn: () => fetchMovementsByBatch(batchB),
  });

  const rowsA = useMemo(() => analyzeMovements(movA), [movA]);
  const rowsB = useMemo(() => analyzeMovements(movB), [movB]);
  const compare = useMemo(() => buildCompare(rowsA, rowsB), [rowsA, rowsB]);

  const pharmacies = useMemo(() => {
    const s = new Set<string>();
    compare.forEach((r) => s.add(r.locationName));
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ar"));
  }, [compare]);

  const filtered = useMemo(() => {
    const minC = minChange.trim() === "" ? null : Number(minChange);
    return compare.filter((r) => {
      if (pharmacyFilter && r.locationName !== pharmacyFilter) return false;
      if (kindFilter !== "all" && r.kind2 !== kindFilter) return false;
      if (criticalOnly && !(isCritical(r.kind1) || isCritical(r.kind2))) return false;
      if (minC != null && (r.changePct == null || Math.abs(r.changePct) < minC))
        return false;
      return true;
    });
  }, [compare, pharmacyFilter, kindFilter, minChange, criticalOnly]);

  const increased = useMemo(
    () =>
      [...filtered]
        .filter((r) => (r.changePct ?? -999) > 10)
        .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
        .slice(0, 50),
    [filtered],
  );
  const decreased = useMemo(
    () =>
      [...filtered]
        .filter((r) => (r.changePct ?? 999) < -10)
        .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
        .slice(0, 50),
    [filtered],
  );
  const becameRisky = useMemo(
    () =>
      filtered.filter((r) => !isCritical(r.kind1) && isCritical(r.kind2)),
    [filtered],
  );
  const becameBetter = useMemo(
    () =>
      filtered.filter((r) => isCritical(r.kind1) && !isCritical(r.kind2)),
    [filtered],
  );

  const pharmacyShortageDelta = useMemo(() => {
    const m = new Map<string, { name: string; before: number; after: number }>();
    for (const r of compare) {
      if (pharmacyFilter && r.locationName !== pharmacyFilter) continue;
      const cur = m.get(r.locationName) || { name: r.locationName, before: 0, after: 0 };
      if (isCritical(r.kind1)) cur.before++;
      if (isCritical(r.kind2)) cur.after++;
      m.set(r.locationName, cur);
    }
    return Array.from(m.values()).map((x) => ({ ...x, delta: x.after - x.before }));
  }, [compare, pharmacyFilter]);

  const pharmaciesWorse = useMemo(
    () => [...pharmacyShortageDelta].filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta),
    [pharmacyShortageDelta],
  );
  const pharmaciesBetter = useMemo(
    () => [...pharmacyShortageDelta].filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta),
    [pharmacyShortageDelta],
  );

  const labelOf = (id: string) => {
    const b = batches.find((x) => x.id === id);
    return b ? `${fmtMonth(b.month)} — ${b.file_name}` : "—";
  };

  function exportExcel() {
    if (!filtered.length) return;
    const wb = XLSX.utils.book_new();
    const head = [
      "اسم الصنف",
      "الاسم التجاري",
      "كود",
      "الصيدلية",
      `المنصرف (${labelOf(batchA)})`,
      `المنصرف (${labelOf(batchB)})`,
      "نسبة التغير %",
      `الرصيد (${labelOf(batchA)})`,
      `الرصيد (${labelOf(batchB)})`,
      `أيام التغطية (${labelOf(batchA)})`,
      `أيام التغطية (${labelOf(batchB)})`,
      "الحالة قبل",
      "الحالة بعد",
      "التفسير",
    ];
    const toRow = (r: CompareRow) => [
      r.itemName,
      r.tradeNames.join("، "),
      r.itemCode || "",
      r.locationName,
      r.issued1,
      r.issued2,
      r.changePct == null ? "" : Number(r.changePct.toFixed(1)),
      r.balance1,
      r.balance2,
      r.days1 == null ? "" : Number(r.days1.toFixed(0)),
      r.days2 == null ? "" : Number(r.days2.toFixed(0)),
      KIND_LABEL[r.kind1],
      KIND_LABEL[r.kind2],
      r.explanation,
    ];
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1F4E79" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
    const addSheet = (name: string, rows: CompareRow[]) => {
      const aoa = [head, ...rows.map(toRow)];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      head.forEach((_, i) => {
        const addr = XLSX.utils.encode_cell({ r: 0, c: i });
        if (ws[addr]) (ws[addr] as any).s = headerStyle;
      });
      ws["!cols"] = head.map(() => ({ wch: 22 }));
      ws["!rtl"] = true as any;
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };
    addSheet("الكل", filtered);
    addSheet("زاد صرفها", increased);
    addSheet("قل صرفها", decreased);
    addSheet("أصبحت خطر", becameRisky);
    addSheet("تحسنت", becameBetter);

    // ورقة الصيدليات
    const phHead = ["الصيدلية", "حرج قبل", "حرج بعد", "الفرق"];
    const phRows = [
      ...pharmaciesWorse.map((p) => [p.name, p.before, p.after, p.delta]),
      ...pharmaciesBetter.map((p) => [p.name, p.before, p.after, p.delta]),
    ];
    const phWs = XLSX.utils.aoa_to_sheet([phHead, ...phRows]);
    phHead.forEach((_, i) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: i });
      if (phWs[addr]) (phWs[addr] as any).s = headerStyle;
    });
    phWs["!cols"] = phHead.map(() => ({ wch: 24 }));
    phWs["!rtl"] = true as any;
    XLSX.utils.book_append_sheet(wb, phWs, "الصيدليات");

    XLSX.writeFile(wb, "مقارنة_شهر_بشهر.xlsx");
  }

  const ChangePill = ({ v }: { v: number | null }) => {
    if (v == null) return <span className="text-muted-foreground">—</span>;
    const cls =
      v > 10
        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        : v < -10
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
        {v > 0 ? "+" : ""}
        {v.toFixed(0)}%
      </span>
    );
  };

  const RowTable = ({ rows }: { rows: CompareRow[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="text-right p-2">الصنف</th>
            <th className="text-right p-2">الصيدلية</th>
            <th className="text-right p-2">منصرف قبل</th>
            <th className="text-right p-2">منصرف بعد</th>
            <th className="text-right p-2">% التغير</th>
            <th className="text-right p-2">رصيد قبل</th>
            <th className="text-right p-2">رصيد بعد</th>
            <th className="text-right p-2">أيام قبل</th>
            <th className="text-right p-2">أيام بعد</th>
            <th className="text-right p-2">الحالة بعد</th>
            <th className="text-right p-2">التفسير</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="p-2"><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} /></td>
              <td className="p-2">{r.locationName}</td>
              <td className="p-2">{fmtNum(r.issued1)}</td>
              <td className="p-2">{fmtNum(r.issued2)}</td>
              <td className="p-2"><ChangePill v={r.changePct} /></td>
              <td className="p-2">{fmtNum(r.balance1)}</td>
              <td className="p-2">{fmtNum(r.balance2)}</td>
              <td className="p-2">{r.days1 == null ? "—" : r.days1.toFixed(0)}</td>
              <td className="p-2">{r.days2 == null ? "—" : r.days2.toFixed(0)}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded border text-xs ${KIND_CLASS[r.kind2]}`}>
                  {KIND_LABEL[r.kind2]}
                </span>
              </td>
              <td className="p-2 text-muted-foreground">{r.explanation}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={11} className="p-6 text-center text-muted-foreground">
                لا توجد بيانات مطابقة.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 max-w-[1400px] mx-auto" dir="rtl">
      <PageHeader
        title="مقارنة شهر بشهر"
        description="قارن بين رفعتين لمعرفة ماذا تغير في الصرف والأرصدة والحالة."
        actions={
          <Button onClick={exportExcel} disabled={!filtered.length}>
            <Download className="w-4 h-4 ml-1" /> تصدير مقارنة Excel
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              شهر الأساس (قبل)
            </label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={batchA}
              onChange={(e) => setBatchA(e.target.value)}
              disabled={loadingBatches}
            >
              <option value="">اختر…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {fmtMonth(b.month)} — {b.file_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              شهر المقارنة (بعد)
            </label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={batchB}
              onChange={(e) => setBatchB(e.target.value)}
              disabled={loadingBatches}
            >
              <option value="">اختر…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {fmtMonth(b.month)} — {b.file_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3 mt-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الصيدلية</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={pharmacyFilter}
              onChange={(e) => setPharmacyFilter(e.target.value)}
            >
              <option value="">الكل</option>
              {pharmacies.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الحالة (بعد)</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as any)}
            >
              <option value="all">الكل</option>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              أدنى نسبة تغير %
            </label>
            <Input
              type="number"
              placeholder="مثال: 25"
              value={minChange}
              onChange={(e) => setMinChange(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={criticalOnly}
                onChange={(e) => setCriticalOnly(e.target.checked)}
              />
              الأصناف الحرجة فقط
            </label>
          </div>
        </div>
      </Card>

      {(!batchA || !batchB) ? (
        <Card className="p-8 text-center text-muted-foreground">
          اختر شهرين للمقارنة.
        </Card>
      ) : (
        <>
          <div className="grid md:grid-cols-4 gap-3 mb-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">زاد صرفها</div>
              <div className="text-2xl font-bold text-emerald-600">{increased.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">قل صرفها</div>
              <div className="text-2xl font-bold text-destructive">{decreased.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">أصبحت خطر</div>
              <div className="text-2xl font-bold text-destructive">{becameRisky.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">تحسنت</div>
              <div className="text-2xl font-bold text-emerald-600">{becameBetter.length}</div>
            </Card>
          </div>

          <Card className="p-4 mb-4">
            <h3 className="font-bold mb-3">الأصناف التي زاد صرفها <span className="text-muted-foreground font-normal text-sm">({increased.length})</span></h3>
            <RowTable rows={increased} />
          </Card>
          <Card className="p-4 mb-4">
            <h3 className="font-bold mb-3">الأصناف التي قل صرفها <span className="text-muted-foreground font-normal text-sm">({decreased.length})</span></h3>
            <RowTable rows={decreased} />
          </Card>
          <Card className="p-4 mb-4">
            <h3 className="font-bold mb-3">الأصناف التي أصبحت خطر <span className="text-muted-foreground font-normal text-sm">({becameRisky.length})</span></h3>
            <RowTable rows={becameRisky} />
          </Card>
          <Card className="p-4 mb-4">
            <h3 className="font-bold mb-3">الأصناف التي تحسنت <span className="text-muted-foreground font-normal text-sm">({becameBetter.length})</span></h3>
            <RowTable rows={becameBetter} />
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="font-bold mb-3">صيدليات زاد فيها النقص <span className="text-muted-foreground font-normal text-sm">({pharmaciesWorse.length})</span></h3>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-right p-2">الصيدلية</th>
                    <th className="text-right p-2">حرج قبل</th>
                    <th className="text-right p-2">حرج بعد</th>
                    <th className="text-right p-2">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmaciesWorse.map((p) => (
                    <tr key={p.name} className="border-t border-border">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{p.before}</td>
                      <td className="p-2">{p.after}</td>
                      <td className="p-2 text-destructive font-semibold">+{p.delta}</td>
                    </tr>
                  ))}
                  {!pharmaciesWorse.length && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">لا يوجد تدهور.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
            <Card className="p-4">
              <h3 className="font-bold mb-3">صيدليات تحسنت <span className="text-muted-foreground font-normal text-sm">({pharmaciesBetter.length})</span></h3>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-right p-2">الصيدلية</th>
                    <th className="text-right p-2">حرج قبل</th>
                    <th className="text-right p-2">حرج بعد</th>
                    <th className="text-right p-2">الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmaciesBetter.map((p) => (
                    <tr key={p.name} className="border-t border-border">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">{p.before}</td>
                      <td className="p-2">{p.after}</td>
                      <td className="p-2 text-emerald-600 font-semibold">{p.delta}</td>
                    </tr>
                  ))}
                  {!pharmaciesBetter.length && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">لا يوجد تحسن.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="p-4 mt-4 border-primary/30 bg-primary-soft/40">
            <div className="text-sm font-semibold mb-2">الخطوة التالية:</div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={exportExcel} disabled={!filtered.length}>
                <Download className="w-4 h-4 ml-1" /> صدّر التقرير
              </Button>
              <Button variant="outline" onClick={() => (window.location.href = "/daily")}>
                افتح مركز العمل اليومي
              </Button>
              <Button variant="outline" onClick={() => (window.location.href = "/alerts")}>
                عرض التنبيهات
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
