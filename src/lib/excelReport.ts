import XLSX from "xlsx-js-style";

export type ReportHeaderMeta = {
  hospital?: string;
  reportTitle: string;
  month?: string | null;
  snapshotDate?: string | null;
  source?: string;
  analysisMethod?: string;
  user?: string;
  confidence?: string;
};

/** بناء صفوف هيدر موحد لجميع تقارير Excel في النظام. */
export function buildUnifiedHeader(meta: ReportHeaderMeta): any[][] {
  const today = new Date().toLocaleDateString("ar-EG");
  return [
    [`المستشفى: ${meta.hospital || "—"}`],
    [`التقرير: ${meta.reportTitle}`],
    [
      `الشهر: ${meta.month || "—"}`,
      `تاريخ الرصيد (snapshot): ${meta.snapshotDate || "—"}`,
      `المصدر: ${meta.source || "—"}`,
    ],
    [
      `طريقة التحليل: ${meta.analysisMethod || "مادة فعالة + تركيز + شكل"}`,
      `درجة الثقة: ${meta.confidence || "—"}`,
    ],
    [`تاريخ التصدير: ${today}`, `بواسطة: ${meta.user || "—"}`],
    [],
  ];
}

/** يصدّر workbook جاهز مع هيدر موحد + ورقة بيانات. */
export function exportUnifiedExcel(opts: {
  filename: string;
  sheetName: string;
  meta: ReportHeaderMeta;
  columns: string[];
  rows: (string | number | null)[][];
}) {
  const header = buildUnifiedHeader(opts.meta);
  const data = [...header, opts.columns, ...opts.rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  // تنسيق رأس الجدول (الصف بعد الهيدر)
  const colHeaderRow = header.length;
  opts.columns.forEach((_, i) => {
    const a = XLSX.utils.encode_cell({ r: colHeaderRow, c: i });
    if (ws[a]) {
      (ws[a] as any).s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1F4E79" } },
        alignment: { horizontal: "center" },
      };
    }
  });
  // عرض الأعمدة
  ws["!cols"] = opts.columns.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName.slice(0, 30));
  XLSX.writeFile(wb, opts.filename);
}