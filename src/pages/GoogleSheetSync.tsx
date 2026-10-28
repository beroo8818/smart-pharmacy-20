import { useMemo, useState } from "react";
import {validateReportDates,todayISO,type ReportDates} from '../../shared/inventoryHistory';
import ReportPeriodFields from '../../shared/components/ReportPeriodFields';
import {hasPermission} from '../../shared/accessPolicy';
import {notifyInventoryChanged} from '../../shared/inventoryRefresh';
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, FileSpreadsheet, CheckCircle2, AlertTriangle, Link2, Upload as UploadIcon,
} from "lucide-react";

/* ---------- helpers ---------- */
function normalize(s: any) {
  return (s == null ? "" : String(s))
    .trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}
function toNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return isNaN(n) ? null : n;
}
function toMonth(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m1 = s.match(/^(\d{4})[-\/](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-01`;
  const m2 = s.match(/^(\d{1,2})[-\/](\d{4})/);
  if (m2) return `${m2[2]}-${m2[1].padStart(2, "0")}-01`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 8) + "01";
  return null;
}
function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  const d = new Date(Date.UTC(year, monthNumber, 0));
  return d.toISOString().substring(0, 10);
}

/* Convert any Google Sheet URL into a CSV export URL */
function toCsvExportUrl(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (!m) return url;
  const id = m[1];
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

/* ---------- header mapping ---------- */
const HEADER_MAP: Record<string, string> = {
  "كود الصنف": "item_code", "كود": "item_code", "code": "item_code", "item_code": "item_code", "sku": "item_code",
  "اسم الصنف": "item_name", "الاسم": "item_name", "اسم": "item_name", "item_name": "item_name", "name": "item_name", "الاسم العربي": "item_name",
  "الاسم العلمي": "scientific_name", "scientific_name": "scientific_name", "scientific": "scientific_name", "generic": "scientific_name",
  "الاسم التجاري": "trade_name", "trade_name": "trade_name", "trade": "trade_name", "brand": "trade_name",
  "الوحده": "unit", "الوحدة": "unit", "unit": "unit", "uom": "unit",
  "الموقع": "location", "الصيدلية": "location", "الصيدليه": "location", "location": "location", "pharmacy": "location",
  "نوع الموقع": "location_type", "location_type": "location_type", "type": "location_type",
  "منصرف": "issued_qty", "issued_qty": "issued_qty", "issued": "issued_qty", "dispensed": "issued_qty",
  "رصيد": "closing_balance", "الرصيد": "closing_balance", "closing_balance": "closing_balance", "balance": "closing_balance", "current_balance": "closing_balance",
  "الشهر": "month", "month": "month", "date": "month", "تاريخ": "month",
};

interface ParsedRow {
  _row: number;
  item_code: string | null;
  item_name: string | null;
  scientific_name: string | null;
  trade_name: string | null;
  unit: string | null;
  location: string | null;
  location_type: "sub_pharmacy" | "main_warehouse";
  issued_qty: number;
  closing_balance: number;
  month: string | null;
  issues: string[];
}

interface ParseResult {
  rows: ParsedRow[];
  totalRead: number;
  itemCount: number;
  pharmacyCount: number;
  issuesCount: number;
  rejected: number;
}

function parseCsvText(text: string, defaultMonth: string | null): ParseResult {
  // Detect separator
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const wb = XLSX.read(text, { type: "string", FS: sep });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  if (!aoa.length) return { rows: [], totalRead: 0, itemCount: 0, pharmacyCount: 0, issuesCount: 0, rejected: 0 };

  const headers = (aoa[0] || []).map((h) => normalize(h));
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key && colMap[key] == null) colMap[key] = i;
  });

  const rows: ParsedRow[] = [];
  let rejected = 0;
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const isEmpty = r.every((c) => c == null || String(c).trim() === "");
    if (isEmpty) continue;

    const itemName = colMap.item_name != null ? (r[colMap.item_name] != null ? String(r[colMap.item_name]).trim() : "") : "";
    const itemCode = colMap.item_code != null ? (r[colMap.item_code] != null ? String(r[colMap.item_code]).trim() : "") : "";
    if (!itemName && !itemCode) { rejected++; continue; }

    const monthRaw = colMap.month != null ? r[colMap.month] : null;
    const month = toMonth(monthRaw) || defaultMonth;
    const locTypeRaw = colMap.location_type != null ? normalize(r[colMap.location_type]) : "";
    const locType: "sub_pharmacy" | "main_warehouse" =
      locTypeRaw.includes("main") || locTypeRaw.includes("مخزن") || locTypeRaw.includes("warehouse")
        ? "main_warehouse" : "sub_pharmacy";

    const issues: string[] = [];
    if (!month) issues.push("الشهر غير محدد");
    const location = colMap.location != null && r[colMap.location] ? String(r[colMap.location]).trim() : "";
    if (!location) issues.push("الموقع/الصيدلية فارغ");
    const issued = toNum(colMap.issued_qty != null ? r[colMap.issued_qty] : null) ?? 0;
    const closing = toNum(colMap.closing_balance != null ? r[colMap.closing_balance] : null) ?? 0;
    if (issued < 0 || closing < 0) issues.push("قيمة سالبة");

    rows.push({
      _row: i + 1,
      item_code: itemCode || null,
      item_name: itemName || null,
      scientific_name: colMap.scientific_name != null && r[colMap.scientific_name] ? String(r[colMap.scientific_name]).trim() : null,
      trade_name: colMap.trade_name != null && r[colMap.trade_name] ? String(r[colMap.trade_name]).trim() : null,
      unit: colMap.unit != null && r[colMap.unit] ? String(r[colMap.unit]).trim() : null,
      location: location || null,
      location_type: locType,
      issued_qty: issued,
      closing_balance: closing,
      month,
      issues,
    });
  }

  const itemSet = new Set(rows.map((r) => normalize(r.item_code || r.item_name)));
  const pharmSet = new Set(rows.map((r) => normalize(r.location)));
  const issuesCount = rows.reduce((a, r) => a + r.issues.length, 0);
  return {
    rows,
    totalRead: rows.length,
    itemCount: itemSet.size,
    pharmacyCount: pharmSet.size,
    issuesCount,
    rejected,
  };
}

/* ---------- component ---------- */
export default function GoogleSheetSync() {
  const { user, hasRole,roles,access } = useAuth();
  const queryClient = useQueryClient();
  const canSave = hasPermission(roles,access,'data.upload');

  const [url, setUrl] = useState("");
  const [defaultMonth, setDefaultMonth] = useState<string>("");
  const [snapshotDate, setSnapshotDate] = useState<string>("");
  const [reportDates,setReportDates]=useState<ReportDates>({});
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [csvText, setCsvText] = useState<string>("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; rows: number } | null>(null);

  const effectiveMonth = defaultMonth ? `${defaultMonth}-01` : null;
  const effectiveSnapshot = snapshotDate || null;
  const result = useMemo<ParseResult | null>(
    () => (csvText ? parseCsvText(csvText, effectiveMonth) : null),
    [csvText, effectiveMonth],
  );

  function setDefaultMonthAndSnapshot(value: string) {
    setDefaultMonth(value);
  }

  async function syncFromUrl() {
    if (!url.trim()) { toast.error("أدخل رابط Google Sheet"); return; }
    setBusy(true); setSaved(null);
    try {
      const csvUrl = toCsvExportUrl(url.trim());
      const resp = await fetch(csvUrl, { redirect: "follow" });
      if (!resp.ok) throw new Error(`فشل التحميل (${resp.status}) — تأكد أن الورقة متاحة للجميع كقارئ`);
      const text = await resp.text();
      if (text.trim().startsWith("<")) throw new Error("الرابط لا يُرجع CSV. اجعل الورقة عامة أو استخدم رابط export?format=csv");
      setCsvText(text);
      setSourceLabel(csvUrl);
      setSyncedAt(new Date());
      toast.success("تمت قراءة الورقة");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "فشل المزامنة");
    } finally { setBusy(false); }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setSaved(null);
    try {
      const text = await f.text();
      setCsvText(text);
      setSourceLabel(f.name);
      setSyncedAt(new Date());
      toast.success("تمت قراءة الملف");
    } catch (err: any) {
      toast.error(err?.message || "تعذّر قراءة الملف");
    } finally { setBusy(false); }
  }

  async function commit() {
    if (!result || !result.rows.length) {
      toast.warning("تم رفع ملف جديد لكن لا توجد صفوف محفوظة صالحة للتحليل. راجع شاشة مراجعة البيانات.");
      return;
    }
    if (!user) { toast.error("يجب تسجيل الدخول"); return; }
    if (!canSave) { toast.error("ليس لديك صلاحية الحفظ"); return; }
    if (!effectiveMonth) { toast.error("اختر الشهر الافتراضي قبل الحفظ"); return; }
    if (!effectiveSnapshot) { toast.error("اختر تاريخ الرصيد قبل الحفظ"); return; }
    let dates:ReportDates;
    try{dates=validateReportDates(effectiveMonth,effectiveSnapshot,'monthly',reportDates,todayISO(),true);}
    catch(e){toast.error((e as Error).message);return;}

    setSaving(true);
    try {
      const fileName = `[google_sheet_csv] ${sourceLabel || "sheet.csv"}`.slice(0, 250);
      const inserts = result.rows.map((r) => ({
        month: (r.month || effectiveMonth) as string,
        item_name: r.item_name,
        item_code: r.item_code,
        scientific_name: r.scientific_name,
        trade_name: r.trade_name,
        unit: r.unit,
        location_name: r.location || "غير محدد",
        location_type: r.location_type,
        issued_quantity: r.issued_qty,
        current_balance: r.closing_balance,
        source_sheet: "google_sheet_csv",
        source_row_number: r._row,
        created_by: user.id,
      }));

      if (inserts.some((row) => row.month !== effectiveMonth)) throw new Error("ارفع كل شهر في دفعة منفصلة؛ لا تجمع فترات مختلفة في تقرير واحد");
      const payload = { file_name: fileName, month: effectiveMonth, snapshot_date: effectiveSnapshot, kind: "monthly", ...dates, rows: inserts };
      let response = await supabase.rpc("hospital_operations" as any, { p_action: "save_import", p_payload: payload } as any);
      if (!response.error && (response.data as any)?.requiresRevision && confirm((response.data as any).error + " هل تعتمد التصحيح؟")) response = await supabase.rpc("hospital_operations" as any, { p_action: "save_import", p_payload: { ...payload, confirm_revision: true } } as any);
      if (response.error) throw new Error("تأكد من تطبيق ترقية قاعدة البيانات: " + response.error.message);
      const saved = response.data as any;
      if (!saved?.ok) throw new Error(saved?.error || "فشل الحفظ");
      if (!saved.duplicate) notifyInventoryChanged();
      const batch = { id: saved.batchId };
      if (saved.duplicate) { setSaved({ id: batch.id, rows: inserts.length }); toast.info("البيانات مسجلة بالفعل؛ لم تتكرر"); return; }

      queryClient.invalidateQueries();
      setSaved({ id: batch.id, rows: inserts.length });
      toast.success(`تم اعتماد وحفظ ${inserts.length} صف`);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "فشل الحفظ");
    } finally { setSaving(false); }
  }

  return (
    <div className="p-8 max-w-[1200px]">
      <PageHeader
        title="مزامنة Google Sheet"
        description="ألصق رابط Google Sheet (يجب أن يكون عامًا) أو ارفع ملف CSV مُصدَّر منه. سيتم تحليل البيانات وعرض ملخص قبل الحفظ."
      />

      <Card className="p-6 mb-4 space-y-4">
        <div>
          <Label className="mb-2 block">رابط Google Sheet</Label>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              dir="ltr"
            />
            <Button onClick={syncFromUrl} disabled={busy || !url.trim()}>
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              مزامنة الآن
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            يجب أن تكون الورقة مشاركة كـ "أي شخص لديه الرابط — قارئ".
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <Label className="mb-2 block">أو ارفع ملف CSV</Label>
          <Input type="file" accept=".csv,text/csv" onChange={handleFile} />
        </div>

        <div className="border-t border-border pt-4">
          <Label className="mb-2 block">الشهر الافتراضي (إذا لم يكن في الورقة)</Label>
          <Input
            type="month"
            value={defaultMonth}
            onChange={(e) => setDefaultMonthAndSnapshot(e.target.value)}
            className="max-w-[200px]"
          />
          <div className="mt-3 max-w-[200px]">
            <Label className="mb-2 block">تاريخ الرصيد</Label>
            <Input
              type="date"
              value={snapshotDate}
              onChange={(e) => setSnapshotDate(e.target.value)}
            />
          </div>
          <ReportPeriodFields month={effectiveMonth||''} kind="monthly" value={reportDates} onChange={setReportDates}/>
        </div>
      </Card>

      {result && (
        <Card className="p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-lg">ملخص المزامنة</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Stat label="اسم المصدر" value={sourceLabel || "—"} mono />
            <Stat label="تاريخ المزامنة" value={syncedAt ? syncedAt.toLocaleString("ar-EG") : "—"} />
            <Stat label="الصفوف المقروءة" value={result.totalRead.toString()} />
            <Stat label="عدد الأصناف" value={result.itemCount.toString()} />
            <Stat label="عدد الصيدليات" value={result.pharmacyCount.toString()} />
            <Stat
              label="عدد المشاكل"
              value={result.issuesCount.toString()}
              tone={result.issuesCount > 0 ? "warn" : "ok"}
            />
          </div>

          {result.rejected > 0 && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              تم تجاهل {result.rejected} صف بدون اسم/كود صنف.
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              المعاينة فقط — لم يتم الحفظ في قاعدة البيانات بعد.
            </div>
            <Button onClick={commit} disabled={saving || !result.totalRead || !canSave || !effectiveSnapshot}>
              <CheckCircle2 className="w-4 h-4" />
              {saving ? "جاري الحفظ..." : "اعتماد وحفظ"}
            </Button>
          </div>

          {/* Preview table */}
          {result.rows.length > 0 && (
            <div className="mt-6 overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-right">#</th>
                    <th className="p-2 text-right">الصنف</th>
                    <th className="p-2 text-right">الموقع</th>
                    <th className="p-2 text-right">الشهر</th>
                    <th className="p-2 text-right">منصرف</th>
                    <th className="p-2 text-right">رصيد</th>
                    <th className="p-2 text-right">مشاكل</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 20).map((r) => (
                    <tr key={r._row} className="border-t border-border">
                      <td className="p-2 text-muted-foreground">{r._row}</td>
                      <td className="p-2">{r.item_name || r.item_code}</td>
                      <td className="p-2">{r.location || "—"}</td>
                      <td className="p-2">{r.month || "—"}</td>
                      <td className="p-2">{r.issued_qty}</td>
                      <td className="p-2">{r.closing_balance}</td>
                      <td className="p-2 text-amber-600">{r.issues.join("، ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 20 && (
                <div className="p-2 text-xs text-muted-foreground text-center bg-muted/50">
                  يتم عرض أول 20 صف من {result.rows.length}.
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {saved && (
        <Card className="p-5 border-emerald-500/40 bg-emerald-50/40">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            تم الحفظ بنجاح — {saved.rows} صف. معرّف الدفعة: <code className="text-xs">{saved.id}</code>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`font-semibold ${color} ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</div>
    </div>
  );
}
