import PageHeader from "@/components/PageHeader";
import DataSourceCard from "@/components/DataSourceCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, ArrowLeft, FileText, AlertTriangle, PackageMinus, ArrowLeftRight, PackagePlus, Timer, Ban, FileWarning, Hospital, Warehouse, Grid3x3 } from "lucide-react";
import { Link } from "react-router-dom";
import XLSX from "xlsx-js-style";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchLatestBatch, fetchMovementsByBatch, analyzeMovements,
  isMainLocation, KIND_LABEL, type AnalysisRow,
} from "@/lib/batchAnalysis";
import { supabase } from "@/integrations/supabase/client";
import {
  computePriority, PRIO_LABEL, PRIO_RANK, PRIO_FILTER_OPTIONS,
  type Priority, useVitalSet,
} from "@/lib/priority";
import ActiveIngredientReports from "@/components/ActiveIngredientReports";

type ReportMeta = {
  reportName: string;
  fileName: string;
  month: string;
  batchId: string;
  targetDays: number;
  hospitalName: string;
};

// Status color palette (ARGB)
const STATUS_FILL: Record<string, string> = {
  red: "FFFECACA",     // خطر عالي / حرج / نقص متوقع / عاجل
  dark_red: "FFB91C1C", // عاجل جدًا
  yellow: "FFFEF3C7",  // أقل من الهدف
  green: "FFD1FAE5",   // آمن
  blue: "FFDBEAFE",    // زيادة
  gray: "FFE5E7EB",    // راكد / بيانات غير كافية
};

function colorForStatus(text: unknown): string | null {
  const s = String(text ?? "");
  if (!s) return null;
  if (/عاجل\s*جد/i.test(s)) return STATUS_FILL.dark_red;
  if (/^عاجل$|^\s*عاجل\s*$|خطر|حرج|نقص متوقع|critical|danger/i.test(s)) return STATUS_FILL.red;
  if (/متابعة|أقل من الهدف|below|watch/i.test(s)) return STATUS_FILL.yellow;
  if (/منخفض/i.test(s)) return STATUS_FILL.gray;
  if (/آمن|safe/i.test(s)) return STATUS_FILL.green;
  if (/زيادة|over/i.test(s)) return STATUS_FILL.blue;
  if (/راكد|dead|بيانات غير كافية|no[_ ]?data/i.test(s)) return STATUS_FILL.gray;
  return null;
}

function colHeaderToLetter(n: number): string {
  let s = ""; n = n + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function exportXlsx(meta: ReportMeta, rows: any[]) {
  const headerInfo: any[][] = [
    ["اسم المستشفى", meta.hospitalName || "—"],
    ["اسم التقرير", meta.reportName],
    ["الشهر", meta.month],
    ["مصدر البيانات", meta.fileName],
    ["upload_batch_id", meta.batchId],
    ["هدف التغطية (يوم)", meta.targetDays],
    ["تاريخ التصدير", new Date().toLocaleString("ar-EG")],
    ["عدد الصفوف", rows.length],
    [],
  ];
  const ws = XLSX.utils.aoa_to_sheet(headerInfo);

  // Style meta header rows
  const labelFill = { patternType: "solid", fgColor: { rgb: "FFE0E7FF" } };
  const labelFont = { bold: true, name: "Arial", sz: 11 };
  const valueFont = { name: "Arial", sz: 11 };
  for (let r = 0; r < headerInfo.length - 1; r++) {
    const a = ws[`A${r + 1}`];
    const b = ws[`B${r + 1}`];
    if (a) a.s = { fill: labelFill, font: labelFont, alignment: { horizontal: "right", vertical: "center" } };
    if (b) b.s = { font: valueFont, alignment: { horizontal: "right", vertical: "center" } };
  }

  const tableStartRow = headerInfo.length; // 0-based row index where the data table starts
  const columns = rows.length ? Object.keys(rows[0]) : ["ملاحظة"];
  const data = rows.length ? rows : [{ ملاحظة: "لا توجد بيانات" }];

  // Write table header
  XLSX.utils.sheet_add_aoa(ws, [columns], { origin: { r: tableStartRow, c: 0 } });
  // Write data
  XLSX.utils.sheet_add_json(ws, data, { origin: { r: tableStartRow + 1, c: 0 }, skipHeader: true, header: columns });

  // Style table header row
  const headerFill = { patternType: "solid", fgColor: { rgb: "FF1E3A8A" } };
  const headerFont = { bold: true, color: { rgb: "FFFFFFFF" }, name: "Arial", sz: 11 };
  for (let c = 0; c < columns.length; c++) {
    const cell = ws[`${colHeaderToLetter(c)}${tableStartRow + 1}`];
    if (cell) cell.s = { fill: headerFill, font: headerFont, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
  }

  // Find priority/status column index (prefer "الأولوية")
  const priorityColIdx = columns.findIndex((c) => /أولوية|priority/i.test(c));
  const statusColIdx = priorityColIdx >= 0 ? priorityColIdx : columns.findIndex((c) => /حال|status|kind/i.test(c));

  // Style data rows with color based on status column
  for (let i = 0; i < data.length; i++) {
    const rowNum = tableStartRow + 2 + i; // 1-based excel row
    let fillRgb: string | null = null;
    if (statusColIdx >= 0) fillRgb = colorForStatus((data[i] as any)[columns[statusColIdx]]);
    for (let c = 0; c < columns.length; c++) {
      const ref = `${colHeaderToLetter(c)}${rowNum}`;
      const cell = ws[ref];
      if (!cell) continue;
      cell.s = {
        font: { name: "Arial", sz: 11 },
        alignment: { horizontal: "right", vertical: "center", wrapText: true },
        ...(fillRgb ? { fill: { patternType: "solid", fgColor: { rgb: fillRgb } } } : {}),
      };
    }
  }

  // Column widths — wide enough for long Arabic item names
  const widths = columns.map((c) => {
    const headerLen = c.length;
    let maxLen = headerLen;
    for (const r of data) {
      const v = String((r as any)[c] ?? "");
      if (v.length > maxLen) maxLen = v.length;
    }
    // Item / drug / scientific / trade name columns get extra space
    const isName = /صنف|مادة|اسم|name|الصيدلية|pharmacy|الموقع|location|السبب|التوصية|الرسالة|المعاينة/i.test(c);
    const base = Math.min(Math.max(maxLen + 4, isName ? 36 : 14), isName ? 70 : 40);
    return { wch: base };
  });
  ws["!cols"] = widths;

  // Merge meta header label/value cells visually wider when possible
  ws["!rows"] = ws["!rows"] || [];
  ws["!rows"][tableStartRow] = { hpt: 22 };

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true } as any] };
  XLSX.utils.book_append_sheet(wb, ws, "report");
  const safe = meta.reportName.replace(/[\\/?*:[\]]/g, "_");
  XLSX.writeFile(wb, `${safe}.xlsx`);
}

export default function Reports() {
  const [target, setTarget] = useState(30);
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const { isVital } = useVitalSet();

  const batchQ = useQuery({
    queryKey: ["latest-batch-reports"],
    queryFn: fetchLatestBatch,
    staleTime: 0,
  });
  const batch = batchQ.data || null;

  const movQ = useQuery({
    queryKey: ["movements-reports", batch?.id],
    enabled: !!batch?.id,
    queryFn: () => fetchMovementsByBatch(batch!.id),
    staleTime: 0,
  });
  const movements = movQ.data || [];
  const rows: AnalysisRow[] = useMemo(() => analyzeMovements(movements, target), [movements, target]);

  const dqQ = useQuery({
    queryKey: ["dq-issues", batch?.id],
    enabled: !!batch?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("data_quality_issues")
        .select("row_no,issue_type,severity,status,message_ar,suggested_fix,created_at")
        .eq("upload_id", batch!.id)
        .order("row_no", { ascending: true });
      if (error) return [];
      return data || [];
    },
    staleTime: 0,
  });

  const ignoredQ = useQuery({
    queryKey: ["import-ignored-rows", batch?.id],
    enabled: !!batch?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("import_ignored_rows")
        .select("sheet_name,row_number,reason,preview,created_at")
        .eq("upload_batch_id", batch!.id)
        .order("sheet_name", { ascending: true })
        .order("row_number", { ascending: true })
        .range(0, 49999);
      if (error) return [];
      return data || [];
    },
    staleTime: 0,
  });

  const loading = batchQ.isLoading || movQ.isLoading;

  const reports = useMemo(() => {
    // Attach computed priority to each row (per-location)
    const withPrio = rows.map((r) => ({
      r,
      priority: computePriority({ days: r.days, kind: r.kind, targetDays: target, isVital: isVital(r.itemCode, r.itemName) }),
    }));
    const passPrio = (p: Priority) => prioFilter === "all" || p === prioFilter;
    const critical = withPrio.filter(({ r }) => r.kind === "critical" || r.kind === "danger" || r.kind === "below");

    const buildPharmacyStatus = () => {
      const map = new Map<string, { items: number; critical: number; below: number; safe: number; over: number; dead: number; balance: number; issued: number }>();
      rows.forEach(r => {
        const p = map.get(r.locationName) || { items: 0, critical: 0, below: 0, safe: 0, over: 0, dead: 0, balance: 0, issued: 0 };
        p.items += 1; p.balance += r.balance; p.issued += r.issued;
        if (r.kind === "critical" || r.kind === "danger") p.critical += 1;
        else if (r.kind === "below") p.below += 1;
        else if (r.kind === "safe") p.safe += 1;
        else if (r.kind === "over" || r.kind === "very_over") p.over += 1;
        else if (r.kind === "deadstock") p.dead += 1;
        map.set(r.locationName, p);
      });
      return Array.from(map.entries()).map(([name, v]) => ({
        الصيدلية: name, "عدد الأصناف": v.items, "إجمالي الرصيد": v.balance, "إجمالي المنصرف": v.issued,
        "حرج/خطر": v.critical, "أقل من الهدف": v.below, "آمن": v.safe, "زيادة": v.over, "راكد": v.dead,
      }));
    };

    // تصنيف نصّي موحّد بالأيام (للتقارير التجميعية) — متوافق مع ألوان الحالة.
    const dayStatusLabel = (days: number | null, balance: number, adc: number): string => {
      if (adc <= 0 || days == null) return balance > 0 ? "بيانات غير كافية" : "بيانات غير كافية";
      if (days < 7) return "خطر عالي";
      if (days < 14) return "نقص متوقع";
      if (days < target) return "أقل من الهدف";
      if (days <= target * 2) return "آمن";
      if (days <= target * 3) return "زيادة";
      return "زيادة جدًا";
    };

    const groupByItem = () => {
      const byItem = new Map<string, AnalysisRow[]>();
      rows.forEach((r) => { const list = byItem.get(r.itemKey) || []; list.push(r); byItem.set(r.itemKey, list); });
      return byItem;
    };

    // (3) إجمالي المستشفى: كل صنف مجمّعًا عبر كل المواقع (مخزن + فروع) في سطر واحد.
    const buildHospitalTotal = () => {
      const out: any[] = [];
      for (const list of groupByItem().values()) {
        const sample = list[0];
        const main = list.find((r) => isMainLocation(r.locationType));
        const branches = list.filter((r) => !isMainLocation(r.locationType));
        const totalBalance = list.reduce((s, r) => s + r.balance, 0);
        const branchBalance = branches.reduce((s, r) => s + r.balance, 0);
        const branchAdc = branches.reduce((s, r) => s + (r.adc || 0), 0);
        const branchIssued = branches.reduce((s, r) => s + r.issued, 0);
        const hospitalDays = branchAdc > 0 ? totalBalance / branchAdc : null;
        const required = Math.max(0, Math.ceil(branchAdc * target - totalBalance));
        out.push({
          الصنف: sample.itemName,
          "الاسم التجاري": sample.tradeNames.join("، "),
          "كود الصنف": sample.itemCode || "",
          "إجمالي رصيد المستشفى": totalBalance,
          "رصيد المخزن": main?.balance ?? 0,
          "رصيد الصيدليات": branchBalance,
          "المنصرف الشهري (الفروع)": branchIssued,
          "متوسط الصرف اليومي": Number(branchAdc.toFixed(2)),
          "تغطية المستشفى (يوم)": hospitalDays == null ? "" : Math.round(hospitalDays),
          "العجز عن الهدف": required,
          الحالة: dayStatusLabel(hospitalDays, totalBalance, branchAdc),
        });
      }
      return out.sort((a, b) => String(a.الصنف).localeCompare(String(b.الصنف), "ar"));
    };

    // (2) حالة المخزن الرئيسي وحده: كفايته لكل الفروع والمطلوب توريده.
    const buildWarehouseStatus = () => {
      const out: any[] = [];
      for (const list of groupByItem().values()) {
        const main = list.find((r) => isMainLocation(r.locationType));
        const branches = list.filter((r) => !isMainLocation(r.locationType));
        const branchAdc = branches.reduce((s, r) => s + (r.adc || 0), 0);
        if (!main && branchAdc <= 0) continue;
        const sample = main || list[0];
        const mainBalance = main?.balance ?? 0;
        const mainDays = branchAdc > 0 ? mainBalance / branchAdc : null;
        const required = Math.max(0, Math.ceil(branchAdc * target - mainBalance));
        out.push({
          الصنف: sample.itemName,
          "الاسم التجاري": sample.tradeNames.join("، "),
          "كود الصنف": sample.itemCode || "",
          "رصيد المخزن": mainBalance,
          "متوسط صرف الفروع اليومي": Number(branchAdc.toFixed(2)),
          "احتياج الفروع الشهري": Math.round(branchAdc * 30),
          "تغطية المخزن للفروع (يوم)": mainDays == null ? "" : Math.round(mainDays),
          "الكمية المطلوب توريدها": required,
          الحالة: dayStatusLabel(mainDays, mainBalance, branchAdc),
        });
      }
      return out.sort((a, b) => String(a.الصنف).localeCompare(String(b.الصنف), "ar"));
    };

    // (4) جدول الصنف × الصيدليات: رصيد كل صنف في كل صيدلية جنب بعض لقرارات المناقلة.
    const buildItemPharmacyPivot = () => {
      const pharmacies = Array.from(
        new Set(rows.filter((r) => !isMainLocation(r.locationType)).map((r) => r.locationName))
      ).sort((a, b) => a.localeCompare(b, "ar"));
      const out: any[] = [];
      for (const list of groupByItem().values()) {
        const sample = list[0];
        const main = list.find((r) => isMainLocation(r.locationType));
        const branchBalance = list.filter((r) => !isMainLocation(r.locationType)).reduce((s, r) => s + r.balance, 0);
        const row: any = {
          الصنف: sample.itemName,
          "كود الصنف": sample.itemCode || "",
          "المخزن الرئيسي": main?.balance ?? 0,
        };
        for (const ph of pharmacies) {
          const r = list.find((x) => x.locationName === ph && !isMainLocation(x.locationType));
          row[ph] = r ? r.balance : 0;
        }
        row["إجمالي الصيدليات"] = branchBalance;
        out.push(row);
      }
      return out.sort((a, b) => String(a.الصنف).localeCompare(String(b.الصنف), "ar"));
    };

    const buildCritical = () => critical.filter(({ priority }) => passPrio(priority)).map(({ r, priority }) => ({
      الصيدلية: r.locationName, الصنف: r.itemName, "الاسم التجاري": r.tradeNames.join("، "), "كود الصنف": r.itemCode || "",
      الرصيد: r.balance, "متوسط يومي": Number(r.adc.toFixed(2)),
      "أيام التغطية": r.days == null ? "" : Math.round(r.days),
      "كمية مطلوبة لهدف التغطية": Math.max(0, Math.ceil(r.adc * target - r.balance)),
      الحالة: KIND_LABEL[r.kind], "الأولوية": PRIO_LABEL[priority], السبب: r.why, التوصية: r.action,
    }));

    const buildMainDispense = () => {
      const byItem = new Map<string, AnalysisRow[]>();
      rows.forEach(r => { const list = byItem.get(r.itemKey) || []; list.push(r); byItem.set(r.itemKey, list); });
      const out: any[] = [];
      for (const list of byItem.values()) {
        const main = list.find(r => isMainLocation(r.locationType));
        if (!main || main.balance <= 0) continue;
        const branches = list.filter(r => !isMainLocation(r.locationType));
        const totalBranchAdc = branches.reduce((s, b) => s + (b.adc || 0), 0);
        const reserve = totalBranchAdc * target;
        let mainBalance = main.balance;
        let mainDays = totalBranchAdc > 0 ? mainBalance / totalBranchAdc : null;
        let available = Math.max(0, Math.floor(mainBalance - reserve));
        if (available <= 0) continue;
        const needy = branches.filter(r => r.kind === "critical" || r.kind === "danger" || r.kind === "below");
        for (const need of needy) {
          if (available <= 0) break;
          const required = Math.max(0, Math.ceil(need.adc * target - need.balance));
          const qty = Math.min(required, available);
          if (qty > 0) {
            const needPrio = computePriority({ days: need.days, kind: need.kind, targetDays: target, isVital: isVital(need.itemCode, need.itemName) });
            if (!passPrio(needPrio)) { available -= qty; continue; }
            const mainBalanceBefore = mainBalance;
            const mainDaysBefore = mainDays;
            const mainBalanceAfter = mainBalance - qty;
            const mainDaysAfter = totalBranchAdc > 0 ? mainBalanceAfter / totalBranchAdc : null;
            const branchBalanceAfter = need.balance + qty;
            const branchDaysAfter = need.adc > 0 ? branchBalanceAfter / need.adc : null;
            out.push({
              الصنف: need.itemName, "الاسم التجاري": need.tradeNames.join("، "), "من المخزن": main.locationName, "إلى الصيدلية": need.locationName,
              الكمية: qty,
              "رصيد المخزن قبل": mainBalanceBefore,
              "تغطية المخزن قبل (يوم)": mainDaysBefore == null ? "" : Math.round(mainDaysBefore),
              "احتياطي المخزن المطلوب": Math.ceil(reserve),
              "متاح للصرف من المخزن": available,
              "رصيد المخزن بعد": mainBalanceAfter,
              "تغطية المخزن بعد (يوم)": mainDaysAfter == null ? "" : Math.round(mainDaysAfter),
              "رصيد الصيدلية قبل": need.balance,
              "تغطية الصيدلية قبل (يوم)": need.days == null ? "" : Math.round(need.days),
              "رصيد الصيدلية بعد": branchBalanceAfter,
              "تغطية الصيدلية بعد (يوم)": branchDaysAfter == null ? "" : Math.round(branchDaysAfter),
              "أيام تغطية الصيدلية": need.days == null ? "" : Math.round(need.days),
              "الأولوية": PRIO_LABEL[needPrio],
            });
            available -= qty;
            mainBalance = mainBalanceAfter;
            mainDays = mainDaysAfter;
          }
        }
      }
      return out;
    };

    // Items where the branch needs help but main store is blocked by its safety reserve
    const buildBlockedMain = () => {
      const byItem = new Map<string, AnalysisRow[]>();
      rows.forEach(r => { const list = byItem.get(r.itemKey) || []; list.push(r); byItem.set(r.itemKey, list); });
      const out: any[] = [];
      for (const list of byItem.values()) {
        const main = list.find(r => isMainLocation(r.locationType));
        if (!main) continue;
        const branches = list.filter(r => !isMainLocation(r.locationType));
        const totalBranchAdc = branches.reduce((s, b) => s + (b.adc || 0), 0);
        const reserve = totalBranchAdc * target;
        const mainDays = totalBranchAdc > 0 ? main.balance / totalBranchAdc : null;
        const available = Math.floor(main.balance - reserve);
        if (available > 0) continue;
        const needy = branches.filter(r => r.kind === "critical" || r.kind === "danger" || r.kind === "below");
        if (!needy.length) continue;
        for (const need of needy) {
          const needPrio = computePriority({ days: need.days, kind: need.kind, targetDays: target, isVital: isVital(need.itemCode, need.itemName), noMainNoDonor: true });
          if (!passPrio(needPrio)) continue;
          out.push({
            الصنف: need.itemName,
            "الاسم التجاري": need.tradeNames.join("، "),
            "كود الصنف": need.itemCode || "",
            "الصيدلية المحتاجة": need.locationName,
            "احتياج الصيدلية": Math.max(0, Math.ceil(need.adc * target - need.balance)),
            "تغطية الصيدلية (يوم)": need.days == null ? "" : Math.round(need.days),
            "المخزن": main.locationName,
            "رصيد المخزن": main.balance,
            "تغطية المخزن (يوم)": mainDays == null ? "" : Math.round(mainDays),
            "الاحتياطي المطلوب": Math.ceil(reserve),
            "متاح للصرف": available,
            "السبب": `لم يتم اقتراح الصرف من المخزن لأن رصيد المخزن يغطي ${mainDays == null ? "—" : Math.round(mainDays)} يوم فقط، والحد الآمن ${target} يوم.`,
            "التوصية البديلة": "ابحث عن صيدلية فائض أو اطلب توريد.",
            "الأولوية": PRIO_LABEL[needPrio],
          });
        }
      }
      return out;
    };

    const buildPharmacyTransfer = () => {
      const byItem = new Map<string, AnalysisRow[]>();
      rows.forEach(r => { const list = byItem.get(r.itemKey) || []; list.push(r); byItem.set(r.itemKey, list); });
      const out: any[] = [];
      for (const list of byItem.values()) {
        const needy = list.filter(r => !isMainLocation(r.locationType) && (r.kind === "critical" || r.kind === "danger" || r.kind === "below"));
        const donors = list.filter(r => !isMainLocation(r.locationType) && (r.kind === "over" || r.kind === "very_over") && r.balance > 0)
          .map(r => ({ r, available: Math.max(0, Math.floor(r.balance - (r.adc > 0 ? r.adc * target : 0))) }))
          .filter(d => d.available > 0)
          .sort((a, b) => b.available - a.available);
        for (const need of needy) {
          const needPrio = computePriority({ days: need.days, kind: need.kind, targetDays: target, isVital: isVital(need.itemCode, need.itemName) });
          if (!passPrio(needPrio)) continue;
          let required = Math.max(0, Math.ceil(need.adc * target - need.balance));
          for (const donor of donors) {
            if (required <= 0) break;
            if (donor.r.locationName === need.locationName) continue;
            const qty = Math.min(required, donor.available);
            if (qty > 0) {
              out.push({
                الصنف: need.itemName, "الاسم التجاري": need.tradeNames.join("، "), "من صيدلية": donor.r.locationName, "إلى صيدلية": need.locationName,
                الكمية: qty, "تغطية المرسل قبل": donor.r.days == null ? "" : Math.round(donor.r.days),
                "تغطية المستلم قبل": need.days == null ? "" : Math.round(need.days),
                "الأولوية": PRIO_LABEL[needPrio],
              });
              donor.available -= qty; required -= qty;
            }
          }
        }
      }
      return out;
    };

    const buildOver = () => withPrio.filter(({ r }) => r.kind === "over" || r.kind === "very_over").filter(({ priority }) => passPrio(priority)).map(({ r, priority }) => ({
      الصيدلية: r.locationName, الصنف: r.itemName, "الاسم التجاري": r.tradeNames.join("، "), الرصيد: r.balance,
      "متوسط يومي": Number(r.adc.toFixed(2)),
      "أيام التغطية": r.days == null ? "" : Math.round(r.days),
      "الفائض عن الهدف": Math.max(0, Math.floor(r.balance - r.adc * target)),
      الحالة: KIND_LABEL[r.kind], "الأولوية": PRIO_LABEL[priority],
    }));

    const buildDead = () => withPrio.filter(({ r }) => r.kind === "deadstock").filter(({ priority }) => passPrio(priority)).map(({ r, priority }) => ({
      الصيدلية: r.locationName, الصنف: r.itemName, "الاسم التجاري": r.tradeNames.join("، "), "كود الصنف": r.itemCode || "",
      الرصيد: r.balance, "المنصرف الشهري": r.issued, "الأولوية": PRIO_LABEL[priority], التوصية: r.action,
    }));

    const buildNoOrder = () => withPrio.filter(({ r }) => {
      const required = r.adc * target - r.balance;
      return r.kind !== "critical" && r.kind !== "danger" && r.kind !== "below" && required <= 0;
    }).filter(({ priority }) => passPrio(priority)).map(({ r, priority }) => ({
      الصيدلية: r.locationName, الصنف: r.itemName, "الاسم التجاري": r.tradeNames.join("، "), الرصيد: r.balance,
      "أيام التغطية": r.days == null ? "" : Math.round(r.days), الحالة: KIND_LABEL[r.kind], "الأولوية": PRIO_LABEL[priority],
      "ملاحظة": "التغطية كافية — لا حاجة للطلب هذا الشهر",
    }));

    const buildDQ = () => {
      const ignoredRows = (ignoredQ.data || []).map((r: any) => ({
        "المصدر": "صف متجاهل أثناء الاستيراد",
        "الورقة": r.sheet_name || "",
        "رقم الصف": r.row_number ?? "",
        "النوع": "ignored_row",
        "الخطورة": "",
        "الحالة": "",
        "الرسالة": r.reason || "",
        "المعاينة": typeof r.preview === "string" ? r.preview : (r.preview == null ? "" : JSON.stringify(r.preview)),
        "الإصلاح المقترح": "",
      }));
      const dqRows = (dqQ.data || []).map((d: any) => ({
        "المصدر": "مشكلة بيانات",
        "الورقة": "",
        "رقم الصف": d.row_no ?? "",
        "النوع": d.issue_type,
        "الخطورة": d.severity,
        "الحالة": d.status,
        "الرسالة": d.message_ar,
        "المعاينة": "",
        "الإصلاح المقترح": d.suggested_fix || "",
      }));
      return [...ignoredRows, ...dqRows];
    };

    return [
      { id: "pharmacy_status", title: "تقرير حالة كل صيدلية", icon: FileText,
        desc: "ملخص لكل صيدلية: عدد الأصناف، الإجماليات، وعدد الحالات الحرجة والآمنة والزيادة والراكد.",
        build: buildPharmacyStatus },
      { id: "hospital_total", title: "إجمالي المستشفى", icon: Hospital,
        desc: "كل صنف مجمّعًا عبر المخزن وكل الصيدليات: إجمالي الرصيد، الصرف، تغطية المستشفى ككل، والعجز عن الهدف.",
        build: buildHospitalTotal },
      { id: "warehouse_status", title: "حالة المخزن الرئيسي", icon: Warehouse,
        desc: "كفاية المخزن الرئيسي لكل الفروع: تغطية المخزن بالأيام والكمية المطلوب توريدها لكل صنف.",
        build: buildWarehouseStatus },
      { id: "item_pharmacy_pivot", title: "جدول الصنف × الصيدليات", icon: Grid3x3,
        desc: "رصيد كل صنف في كل صيدلية جنب بعض لاتخاذ قرارات المناقلة الفورية بين الفروع.",
        build: buildItemPharmacyPivot },
      { id: "critical_items", title: "تقرير الأصناف الحرجة", icon: AlertTriangle,
        desc: "كل الأصناف التي تغطيتها أقل من هدف التغطية مع الكمية المطلوبة.",
        build: buildCritical },
      { id: "main_dispense", title: "خطة صرف من المخزن", icon: PackageMinus,
        desc: "كميات يوصى صرفها من المخزن الرئيسي إلى الصيدليات الناقصة.",
        build: buildMainDispense },
      { id: "blocked_main", title: "أصناف لم يُصرف لها من المخزن", icon: PackageMinus,
        desc: "أصناف فيها نقص بصيدليات لكن المخزن الرئيسي لا يملك فائضًا آمنًا، مع السبب والتوصية البديلة.",
        build: buildBlockedMain },
      { id: "pharmacy_transfer", title: "خطة التحويل بين الصيدليات", icon: ArrowLeftRight,
        desc: "تحويل الفائض من صيدلية إلى صيدلية أخرى ناقصة لنفس الصنف.",
        build: buildPharmacyTransfer },
      { id: "over", title: "الأصناف الزائدة", icon: PackagePlus,
        desc: "الأصناف التي يتجاوز رصيدها هدف التغطية مع حساب الفائض.",
        build: buildOver },
      { id: "dead", title: "الأصناف الراكدة", icon: Timer,
        desc: "أصناف لها رصيد بدون أي صرف خلال هذا الملف.",
        build: buildDead },
      { id: "no_order", title: "أصناف لا تطلب هذا الشهر", icon: Ban,
        desc: "الأصناف التي تغطيتها تساوي أو تتجاوز الهدف ولا تحتاج طلب جديد.",
        build: buildNoOrder },
      { id: "dq", title: "تقرير الصفوف المتجاهلة ومشاكل البيانات", icon: FileWarning,
        desc: "الصفوف التي تم تجاهلها أثناء الاستيراد أو فيها مشاكل بيانات.",
        build: buildDQ },
    ];
  }, [rows, target, dqQ.data, ignoredQ.data, prioFilter, isVital]);

  const noData = !loading && (!batch || rows.length === 0);

  const makeMeta = (title: string): ReportMeta => ({
    reportName: title,
    fileName: batch?.file_name || "",
    month: batch?.month || "",
    batchId: batch?.id || "",
    targetDays: target,
    hospitalName: (typeof window !== "undefined" && localStorage.getItem("hospital_name")) || "",
  });

  return (
    <div className="p-8 max-w-[1200px]">
      <PageHeader
        title="التقارير"
        description="كل التقارير مبنية على آخر ملف محفوظ (upload_batches + inventory_movements) وقابلة للتصدير إلى Excel."
        actions={
          <div className="flex gap-2">
            <select className="rounded-md border border-input bg-background px-3 h-9 text-sm"
              value={prioFilter} onChange={(e) => setPrioFilter(e.target.value as any)}>
              {PRIO_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="rounded-md border border-input bg-background px-3 h-9 text-sm"
              value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>هدف 14 يوم</option>
              <option value={30}>هدف 30 يوم</option>
              <option value={60}>هدف 60 يوم</option>
              <option value={90}>هدف 90 يوم</option>
            </select>
          </div>
        }
      />

      <DataSourceCard batch={batch} loading={loading} targetDays={target} />

      <Card className="p-5 mb-4 flex items-center justify-between gap-3 bg-muted/30">
        <div>
          <div className="font-bold">تقرير حالة كل صيدلية</div>
          <div className="text-xs text-muted-foreground mt-1">
            عرض حالة كل صنف داخل كل صيدلية مقسمًا حسب درجة التغطية، من آخر ملف Excel محفوظ، مع فلاتر وتصدير لكل صيدلية أو للأصناف الحرجة.
          </div>
        </div>
        <Button asChild size="sm">
          <Link to="/reports/pharmacy-status">
            فتح التقرير <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
      </Card>

      {loading ? <div className="text-muted-foreground">جارٍ التحميل...</div> : noData ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد بيانات محفوظة بعد.</Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {reports.map((r) => {
            const Icon = r.icon;
            return (
              <Card key={r.id} className="p-5 flex items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-primary/10 text-primary"><Icon className="w-5 h-5" /></div>
                  <div>
                    <div className="font-bold">{r.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">{r.desc}</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => exportXlsx(makeMeta(r.title), r.build())}>
                  <Download className="w-4 h-4" /> تنزيل
                </Button>
              </Card>
            );
          })}
        </div>
      )}
      <ActiveIngredientReports />
    </div>
  );
}
