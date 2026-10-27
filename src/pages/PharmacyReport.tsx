import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import ItemIdentity from "@/components/ItemIdentity";
import {
  fetchMovementsByBatch,
  isMainLocation,
  itemDisplayName,
  itemKey as analysisItemKey,
  itemTradeNames,
  sortBatchesForAnalysis,
} from "@/lib/batchAnalysis";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import XLSX from "xlsx-js-style";

type Bucket =
  | "critical"
  | "danger"
  | "below"
  | "safe"
  | "over"
  | "very_over"
  | "deadstock"
  | "no_data";

const BUCKET_ORDER: Bucket[] = [
  "critical",
  "danger",
  "below",
  "safe",
  "over",
  "very_over",
  "deadstock",
  "no_data",
];

const BUCKET_LABEL: Record<Bucket, string> = {
  critical: "خطر عالي جدًا",
  danger: "نقص متوقع",
  below: "أقل من الهدف",
  safe: "آمن",
  over: "زيادة",
  very_over: "زيادة جدًا",
  deadstock: "راكد",
  no_data: "بيانات غير كافية",
};

const BUCKET_CLASS: Record<Bucket, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  below: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  safe: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  over: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  very_over: "bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/40",
  deadstock: "bg-muted text-muted-foreground border-border",
  no_data: "bg-muted text-muted-foreground border-border",
};

type UploadBatch = {
  id: string;
  file_name: string;
  month: string;
  rows_saved: number;
  status: string;
  created_at: string;
  snapshot_date?: string | null;
  batch_kind?: string | null;
};

type Movement = {
  id: string;
  upload_batch_id: string;
  month: string;
  item_name: string | null;
  item_code: string | null;
  scientific_name: string | null;
  trade_name: string | null;
  unit: string | null;
  location_name: string;
  location_type: string;
  issued_quantity: number | string | null;
  current_balance: number | string | null;
};

const db = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => any;
  };
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
const itemKey = (r: Movement) => analysisItemKey(r as any);

function classify(balance: number, issued: number, target: number, isMain = false, branchAdc = 0): { bucket: Bucket; adc: number; days: number | null } {
  const adc = isMain ? branchAdc : issued / 30;
  if (isMain) {
    if (balance <= 0 && branchAdc <= 0) return { bucket: "no_data", adc, days: null };
    if (balance <= 0 && branchAdc > 0) return { bucket: "critical", adc, days: 0 };
    if (branchAdc <= 0) return { bucket: "no_data", adc, days: null };
    const days = balance / branchAdc;
    let bucket: Bucket;
    if (days < 7) bucket = "critical";
    else if (days < 14) bucket = "danger";
    else if (days < target) bucket = "below";
    else if (days <= target * 2) bucket = "safe";
    else if (days <= target * 3) bucket = "over";
    else bucket = "very_over";
    return { bucket, adc, days };
  }
  if (issued === 0 && balance === 0) return { bucket: "no_data", adc: 0, days: null };
  if (issued === 0 && balance > 0) return { bucket: "deadstock", adc: 0, days: null };
  const days = balance / adc;
  let bucket: Bucket;
  if (days < 7) bucket = "critical";
  else if (days < 14) bucket = "danger";
  else if (days < target) bucket = "below";
  else if (days <= target * 2) bucket = "safe";
  else if (days <= target * 3) bucket = "over";
  else bucket = "very_over";
  return { bucket, adc, days };
}

function recommend(bucket: Bucket, days: number | null, target: number, name: string) {
  switch (bucket) {
    case "critical":
      return `صرف عاجل إلى ${name} — التغطية أقل من 7 أيام.`;
    case "danger":
      return `جدوّل صرف خلال أيام إلى ${name}.`;
    case "below":
      return `زود الرصيد ليصل إلى هدف ${target} يوم.`;
    case "safe":
      return "ضمن الحد الآمن — تابع فقط.";
    case "over":
      return "كمية زائدة — راقب الاستهلاك أو حوّل الفائض.";
    case "very_over":
      return "كمية زائدة جدًا — حوّل الفائض لصيدلية محتاجة.";
    case "deadstock":
      return "صنف راكد — راجع جدوى الاحتفاظ به.";
    case "no_data":
      return "لا يوجد رصيد ولا صرف — بيانات غير كافية.";
  }
}

function whyText(balance: number, issued: number, adc: number, days: number | null, name: string) {
  if (issued === 0 && balance === 0) return `لا يوجد رصيد ولا صرف من هذا الصنف في ${name}.`;
  if (issued === 0) return `يوجد رصيد ${fmtNum(balance)} وحدة في ${name} لكن بدون صرف هذا الشهر.`;
  return `الرصيد ${fmtNum(balance)} ÷ متوسط الصرف اليومي ${fmtNum(adc, 1)} = ${fmtNum(days ?? 0)} يوم تغطية في ${name}.`;
}

const BUCKET_HEX: Record<Bucket, string> = {
  critical: "B91C1C",
  danger: "EF4444",
  below: "F59E0B",
  safe: "10B981",
  over: "3B82F6",
  very_over: "1D4ED8",
  deadstock: "9CA3AF",
  no_data: "D1D5DB",
};

const PRIORITY_RANK: Record<Bucket, number> = {
  critical: 0,
  danger: 1,
  below: 2,
  no_data: 3,
  deadstock: 4,
  very_over: 5,
  over: 6,
  safe: 7,
};

export default function PharmacyReport() {
  const [target, setTarget] = useState<number>(30);
  const [pharmacy, setPharmacy] = useState<string>("all");
  const [bucketFilter, setBucketFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const batchesQuery = useQuery({
    queryKey: ["upload_batches"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db
        .from("upload_batches")
        .select("id,file_name,month,rows_saved,status,created_at,snapshot_date,batch_kind")
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .range(0, 19);
      if (error) throw error;
      return sortBatchesForAnalysis((data || []) as UploadBatch[]);
    },
  });

  const latest = batchesQuery.data?.[0] || null;

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements", latest?.id],
    enabled: !!latest?.id,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      return (await fetchMovementsByBatch(latest!.id)) as Movement[];
    },
  });

  const movements = movementsQuery.data || [];

  // Aggregate per pharmacy + item
  const aggregated = useMemo(() => {
    const map = new Map<
      string,
      {
        pharmacy: string;
        pharmacyType: string;
        itemKey: string;
        itemName: string;
        tradeNames: string[];
        itemCode: string | null;
        scientific: string | null;
        unit: string | null;
        balance: number;
        issued: number;
      }
    >();
    for (const m of movements) {
      const pk = `${norm(m.location_type)}|${norm(m.location_name)}`;
      const ik = itemKey(m);
      const key = `${pk}::${ik}`;
      const prev = map.get(key);
      if (prev) {
        prev.balance = num(m.current_balance); // last value wins (single batch -> same)
        prev.issued += num(m.issued_quantity);
        prev.tradeNames = Array.from(new Set([...prev.tradeNames, ...itemTradeNames(m as any)]));
      } else {
        map.set(key, {
          pharmacy: m.location_name,
          pharmacyType: m.location_type,
          itemKey: ik,
          itemName: itemDisplayName(m as any),
          tradeNames: itemTradeNames(m as any),
          itemCode: m.item_code,
          scientific: m.scientific_name,
          unit: m.unit,
          balance: num(m.current_balance),
          issued: num(m.issued_quantity),
        });
      }
    }
    const grouped = Array.from(map.values());
    const branchAdcByItem = new Map<string, number>();
    for (const r of grouped) {
      if (isMainLocation(r.pharmacyType)) continue;
      branchAdcByItem.set(r.itemKey, (branchAdcByItem.get(r.itemKey) || 0) + r.issued / 30);
    }
    return grouped.map((r) => {
      const c = classify(r.balance, r.issued, target, isMainLocation(r.pharmacyType), branchAdcByItem.get(r.itemKey) || 0);
      return { ...r, ...c };
    });
  }, [movements, target]);

  const pharmacies = useMemo(() => {
    const set = new Map<string, string>();
    for (const a of aggregated) set.set(a.pharmacy, a.pharmacyType);
    return Array.from(set.entries())
      .map(([name, type]) => ({ name, type }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [aggregated]);

  const filtered = useMemo(() => {
    const s = norm(q);
    return aggregated.filter((r) => {
      if (pharmacy !== "all" && r.pharmacy !== pharmacy) return false;
      if (bucketFilter !== "all" && r.bucket !== bucketFilter) return false;
      if (s) {
        const hay = norm(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.scientific || ""}`);
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [aggregated, pharmacy, bucketFilter, q]);

  // Group by pharmacy -> bucket
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const r of filtered) {
      if (!map.has(r.pharmacy)) map.set(r.pharmacy, []);
      map.get(r.pharmacy)!.push(r);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "ar"))
      .map(([name, list]) => {
        const byBucket = new Map<Bucket, typeof list>();
        for (const r of list) {
          if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
          byBucket.get(r.bucket)!.push(r);
        }
        for (const arr of byBucket.values()) {
          arr.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
        }
        const summary: Record<Bucket, number> = {
          critical: 0,
          danger: 0,
          below: 0,
          safe: 0,
          over: 0,
          very_over: 0,
          deadstock: 0,
          no_data: 0,
        };
        for (const r of list) summary[r.bucket]++;
        return { pharmacy: name, list, byBucket, summary };
      });
  }, [filtered]);

  // Excel export helpers
  function rowsToSheet(rows: typeof filtered) {
    return rows.map((r) => ({
      الصيدلية: r.pharmacy,
      "اسم المادة العلاجية": r.itemName,
      "الاسم التجاري": r.tradeNames.join("، "),
      "كود الصنف": r.itemCode || "",
      "الاسم العلمي": r.scientific || "",
      الوحدة: r.unit || "",
      "الرصيد الحالي": r.balance,
      "المنصرف الشهري": r.issued,
      "متوسط الصرف اليومي": Number(r.adc.toFixed(2)),
      "أيام التغطية": r.days == null ? "" : Math.round(r.days),
      الحالة: BUCKET_LABEL[r.bucket],
      التوصية: recommend(r.bucket, r.days, target, r.pharmacy),
      السبب: whyText(r.balance, r.issued, r.adc, r.days, r.pharmacy),
    }));
  }

  function buildStyledSheet(pharmacyName: string, rows: typeof filtered) {
    const headerMeta = [
      ["اسم المستشفى", "—"],
      ["اسم التقرير", "تقرير حالة الصيدلية"],
      ["الصيدلية", pharmacyName],
      ["الشهر", latest ? fmtMonth(latest.month) : ""],
      ["مصدر البيانات", latest?.file_name || ""],
      ["upload_batch_id", latest?.id || ""],
      ["هدف التغطية (يوم)", String(target)],
      ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
    ];
    const data = rowsToSheet(rows);
    const ws: any = XLSX.utils.json_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, headerMeta, { origin: "A1" });
    XLSX.utils.sheet_add_json(ws, data, { origin: `A${headerMeta.length + 2}` });
    const headerRow = headerMeta.length + 2; // 1-based row of column headers
    // bold meta labels
    for (let i = 0; i < headerMeta.length; i++) {
      const cell = ws[XLSX.utils.encode_cell({ r: i, c: 0 })];
      if (cell) cell.s = { font: { bold: true } };
    }
    // column headers bold + bg
    const cols = Object.keys(data[0] || { x: 1 });
    for (let c = 0; c < cols.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow - 1, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: cols[c] };
      ws[addr].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "374151" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
      };
    }
    // color rows by status
    rows.forEach((r, idx) => {
      const rowIdx = headerRow + idx; // 0-based row
      const statusCol = cols.indexOf("الحالة");
      const fill = { fgColor: { rgb: BUCKET_HEX[r.bucket] } };
      const font = ["critical", "danger", "very_over"].includes(r.bucket)
        ? { color: { rgb: "FFFFFF" }, bold: true }
        : { bold: true };
      if (statusCol >= 0) {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c: statusCol });
        if (ws[addr]) ws[addr].s = { fill, font, alignment: { horizontal: "center", wrapText: true } };
      }
      for (let c = 0; c < cols.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c });
        if (!ws[addr]) continue;
        ws[addr].s = ws[addr].s || { alignment: { wrapText: true, vertical: "center" } };
        ws[addr].s.alignment = { wrapText: true, vertical: "center", ...(ws[addr].s.alignment || {}) };
      }
    });
    ws["!cols"] = [
      { wch: 22 }, { wch: 42 }, { wch: 14 }, { wch: 28 }, { wch: 10 },
      { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 50 },
    ];
    return ws;
  }

  function exportCurrent() {
    const wb = XLSX.utils.book_new();
    for (const g of grouped) {
      const ws = buildStyledSheet(g.pharmacy, g.list);
      const safeName = g.pharmacy.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "صيدلية";
      XLSX.utils.book_append_sheet(wb, ws, safeName);
    }
    XLSX.writeFile(wb, `تقرير_حالة_${pharmacy === "all" ? "كل_الصيدليات" : pharmacy}.xlsx`);
  }

  function exportSinglePharmacy(name: string, list: typeof filtered) {
    const wb = XLSX.utils.book_new();
    const sorted = [...list].sort(
      (a, b) =>
        PRIORITY_RANK[a.bucket] - PRIORITY_RANK[b.bucket] ||
        (a.days ?? Infinity) - (b.days ?? Infinity),
    );
    const ws = buildStyledSheet(name, sorted);
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "صيدلية");
    XLSX.writeFile(wb, `تقرير_${name}.xlsx`);
  }

  function exportAll() {
    const wb = XLSX.utils.book_new();
    const map = new Map<string, typeof aggregated>();
    for (const r of aggregated) {
      if (!map.has(r.pharmacy)) map.set(r.pharmacy, []);
      map.get(r.pharmacy)!.push(r);
    }
    for (const [name, list] of map) {
      const sorted = [...list].sort(
        (a, b) =>
          PRIORITY_RANK[a.bucket] - PRIORITY_RANK[b.bucket] ||
          (a.days ?? Infinity) - (b.days ?? Infinity),
      );
      const ws = buildStyledSheet(name, sorted);
      XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "صيدلية");
    }
    XLSX.writeFile(wb, `تقرير_حالة_كل_الصيدليات.xlsx`);
  }

  function exportCritical() {
    const critical = aggregated.filter((r) => r.bucket === "critical" || r.bucket === "danger");
    const ws = buildStyledSheet("الأصناف الحرجة", critical);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "الأصناف الحرجة");
    XLSX.writeFile(wb, `الأصناف_الحرجة.xlsx`);
  }

  const loading = batchesQuery.isLoading || movementsQuery.isLoading;
  const noData = !loading && (!latest || aggregated.length === 0);

  return (
    <div className="p-6 max-w-[1600px] print:p-0">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-card { box-shadow: none !important; border: 1px solid #ddd !important; page-break-inside: avoid; }
          .print-break { page-break-before: always; }
        }
      `}</style>
      <PageHeader
        title="تقرير حالة كل صيدلية"
        description="حالة كل صنف داخل كل صيدلية بناءً على آخر ملف Excel محفوظ."
      />

      {/* Source info */}
      <Card className="p-4 mb-4 bg-muted/30 print-card">
        {loading ? (
          <div className="text-sm text-muted-foreground">جارٍ التحميل...</div>
        ) : !latest ? (
          <div className="text-sm text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</div>
        ) : (
          <div className="grid md:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">مصدر البيانات</div>
              <div className="font-medium" dir="auto">{latest.file_name}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">الشهر</div>
              <div className="font-medium">{fmtMonth(latest.month)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">upload_batch_id</div>
              <div className="font-mono text-[11px] break-all">{latest.id}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">الصفوف المحفوظة</div>
              <div className="font-medium">{fmtNum(latest.rows_saved)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">هدف التغطية</div>
              <div className="font-medium">{target} يوم</div>
            </div>
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card className="p-4 mb-4 no-print">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الصيدلية</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={pharmacy}
              onChange={(e) => setPharmacy(e.target.value)}
            >
              <option value="all">كل الصيدليات</option>
              {pharmacies.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الحالة</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={bucketFilter}
              onChange={(e) => setBucketFilter(e.target.value)}
            >
              <option value="all">كل الحالات</option>
              {BUCKET_ORDER.map((b) => (
                <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">بحث باسم الصنف</label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المادة أو الكود..." />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={exportCurrent} disabled={noData}>
            <Download className="w-4 h-4" /> تصدير الصيدلية الحالية
          </Button>
          <Button variant="outline" size="sm" onClick={exportAll} disabled={noData}>
            <Download className="w-4 h-4" /> تصدير كل الصيدليات
          </Button>
          <Button variant="outline" size="sm" onClick={exportCritical} disabled={noData}>
            <Download className="w-4 h-4" /> تصدير الأصناف الحرجة فقط
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} disabled={noData}>
            <Printer className="w-4 h-4" /> طباعة التقرير
          </Button>
        </div>
      </Card>

      {loading && <div className="text-muted-foreground">جارٍ التحميل...</div>}
      {noData && !loading && (
        <Card className="p-8 text-center text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</Card>
      )}

      {grouped.map((g, gi) => {
        const total = g.list.length;
        const top20 = [...g.list]
          .sort(
            (a, b) =>
              PRIORITY_RANK[a.bucket] - PRIORITY_RANK[b.bucket] ||
              (a.days ?? Infinity) - (b.days ?? Infinity),
          )
          .slice(0, 20);
        return (
        <Card key={g.pharmacy} className={`p-5 mb-6 print-card ${gi > 0 ? "print-break" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-xl font-bold" dir="auto">{g.pharmacy}</h2>
            <div className="flex gap-2 no-print">
              <Button variant="outline" size="sm" onClick={() => exportSinglePharmacy(g.pharmacy, g.list)}>
                <Download className="w-4 h-4" /> تصدير تقرير هذه الصيدلية Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> طباعة التقرير
              </Button>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-4">
            <div className="p-3 rounded border bg-muted/30 text-center">
              <div className="text-xs text-muted-foreground">إجمالي الأصناف</div>
              <div className="text-lg font-bold">{fmtNum(total)}</div>
            </div>
            {(["critical", "danger", "below", "safe", "over", "deadstock"] as Bucket[]).map((b) => (
              <div key={b} className={`p-3 rounded border text-center ${BUCKET_CLASS[b]}`}>
                <div className="text-xs">{BUCKET_LABEL[b]}</div>
                <div className="text-lg font-bold">{fmtNum(g.summary[b] || 0)}</div>
              </div>
            ))}
          </div>

          {/* Top 20 priority */}
          {top20.length > 0 && (
            <div className="mb-5">
              <div className="font-bold mb-2">ابدأ بهذه الأصناف (أخطر {top20.length})</div>
              <div className="overflow-x-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs">
                    <tr>
                      <th className="p-2 text-right w-8">#</th>
                      <th className="p-2 text-right min-w-[260px]">المادة العلاجية</th>
                      <th className="p-2 text-right whitespace-nowrap">الرصيد</th>
                      <th className="p-2 text-right whitespace-nowrap">المنصرف</th>
                      <th className="p-2 text-right whitespace-nowrap">يكفي (يوم)</th>
                      <th className="p-2 text-right">الحالة</th>
                      <th className="p-2 text-right min-w-[220px]">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {top20.map((r, i) => (
                      <tr key={`top-${r.itemKey}`} className="border-t align-top">
                        <td className="p-2">{i + 1}</td>
                        <td className="p-2"><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} /></td>
                        <td className="p-2 whitespace-nowrap">{fmtNum(r.balance)}</td>
                        <td className="p-2 whitespace-nowrap">{fmtNum(r.issued)}</td>
                        <td className="p-2 whitespace-nowrap">{r.days == null ? "—" : fmtNum(r.days)}</td>
                        <td className="p-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${BUCKET_CLASS[r.bucket]}`}>
                            {BUCKET_LABEL[r.bucket]}
                          </span>
                        </td>
                        <td className="p-2" dir="auto">{recommend(r.bucket, r.days, target, r.pharmacy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {BUCKET_ORDER.map((b) => {
            const rows = g.byBucket.get(b);
            if (!rows || rows.length === 0) return null;
            return (
              <div key={b} className="mb-5">
                <div className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium border mb-2 ${BUCKET_CLASS[b]}`}>
                  {BUCKET_LABEL[b]} ({rows.length})
                </div>
                <div className="overflow-x-auto border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs">
                      <tr>
                        <th className="p-2 text-right min-w-[260px]">المادة العلاجية</th>
                        <th className="p-2 text-right whitespace-nowrap">الرصيد</th>
                        <th className="p-2 text-right whitespace-nowrap">المنصرف الشهري</th>
                        <th className="p-2 text-right whitespace-nowrap">المتوسط اليومي</th>
                        <th className="p-2 text-right whitespace-nowrap">التغطية (يوم)</th>
                        <th className="p-2 text-right">الحالة</th>
                        <th className="p-2 text-right min-w-[220px]">التوصية</th>
                        <th className="p-2 text-right min-w-[260px]">لماذا؟</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.pharmacy}-${r.itemKey}`} className="border-t align-top">
                          <td className="p-2 align-top">
                            <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
                          </td>
                          <td className="p-2 whitespace-nowrap">{fmtNum(r.balance)}</td>
                          <td className="p-2 whitespace-nowrap">{fmtNum(r.issued)}</td>
                          <td className="p-2 whitespace-nowrap">{fmtNum(r.adc, 1)}</td>
                          <td className="p-2 whitespace-nowrap">{r.days == null ? "—" : fmtNum(r.days)}</td>
                          <td className="p-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${BUCKET_CLASS[r.bucket]}`}>
                              {BUCKET_LABEL[r.bucket]}
                            </span>
                          </td>
                          <td className="p-2 whitespace-normal break-words leading-snug" dir="auto">
                            {recommend(r.bucket, r.days, target, r.pharmacy)}
                          </td>
                          <td className="p-2 text-xs text-muted-foreground whitespace-normal break-words leading-snug" dir="auto">
                            {whyText(r.balance, r.issued, r.adc, r.days, r.pharmacy)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </Card>
        );
      })}
    </div>
  );
}
