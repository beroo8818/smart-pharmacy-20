import { useMemo, useState } from "react";
import {validateReportDates,todayISO,type ReportDates} from '../../../shared/inventoryHistory';
import ReportPeriodFields from '../../../shared/components/ReportPeriodFields';
import * as XLSX from "xlsx";
import { useNavigate } from "react-router-dom";
import { api, tokenStore } from "@/integrations/desktop/client";
import { fmtNum } from "@/lib/desktopAnalytics";

function normalize(s: any) {
  return (s == null ? "" : String(s)).trim().toLowerCase()
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
  const m1 = s.match(/^(\d{4})[-\/](\d{1,2})/); if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-01`;
  const m2 = s.match(/^(\d{1,2})[-\/](\d{4})/); if (m2) return `${m2[2]}-${m2[1].padStart(2, "0")}-01`;
  const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().substring(0, 8) + "01";
  return null;
}
function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  const d = new Date(Date.UTC(year, monthNumber, 0));
  return d.toISOString().substring(0, 10);
}
function toCsvExportUrl(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
  if (!m) return url;
  const gid = (url.match(/[#?&]gid=(\d+)/) || [, "0"])[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

const HEADER_MAP: Record<string, string> = {
  "كود الصنف": "item_code", "كود": "item_code", "code": "item_code", "item_code": "item_code", "sku": "item_code",
  "اسم الصنف": "item_name", "الاسم": "item_name", "اسم": "item_name", "item_name": "item_name", "name": "item_name",
  "الاسم العلمي": "scientific_name", "scientific_name": "scientific_name", "scientific": "scientific_name",
  "الاسم التجاري": "trade_name", "trade_name": "trade_name", "brand": "trade_name",
  "الوحده": "unit", "الوحدة": "unit", "unit": "unit", "uom": "unit",
  "الموقع": "location", "الصيدلية": "location", "location": "location", "pharmacy": "location",
  "نوع الموقع": "location_type", "location_type": "location_type", "type": "location_type",
  "منصرف": "issued_qty", "issued_qty": "issued_qty", "issued": "issued_qty",
  "رصيد": "closing_balance", "الرصيد": "closing_balance", "closing_balance": "closing_balance", "balance": "closing_balance",
  "الشهر": "month", "month": "month", "date": "month", "تاريخ": "month",
};

type ParsedRow = {
  _row: number; item_code: string | null; item_name: string;
  scientific_name: string | null; trade_name: string | null; unit: string | null;
  location: string; location_type: "sub_pharmacy" | "main_store";
  issued_qty: number; closing_balance: number; month: string | null;
  issues: string[];
};

function parseCsvText(text: string, defaultMonth: string | null) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = firstLine.includes("\t") ? "\t" : ",";
  const wb = XLSX.read(text, { type: "string", FS: sep });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  if (!aoa.length) return { rows: [] as ParsedRow[], rejected: 0 };

  const headers = (aoa[0] || []).map((h) => normalize(h));
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => { const key = HEADER_MAP[h]; if (key && colMap[key] == null) colMap[key] = i; });

  const rows: ParsedRow[] = []; let rejected = 0;
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    if (r.every((c) => c == null || String(c).trim() === "")) continue;
    const itemName = colMap.item_name != null && r[colMap.item_name] != null ? String(r[colMap.item_name]).trim() : "";
    const itemCode = colMap.item_code != null && r[colMap.item_code] != null ? String(r[colMap.item_code]).trim() : "";
    if (!itemName && !itemCode) { rejected++; continue; }
    const monthRaw = colMap.month != null ? r[colMap.month] : null;
    const month = toMonth(monthRaw) || defaultMonth;
    const locTypeRaw = colMap.location_type != null ? normalize(r[colMap.location_type]) : "";
    const locType: "sub_pharmacy" | "main_store" =
      locTypeRaw.includes("main") || locTypeRaw.includes("مخزن") || locTypeRaw.includes("warehouse") || locTypeRaw.includes("store")
        ? "main_store" : "sub_pharmacy";
    const issues: string[] = [];
    if (!month) issues.push("الشهر غير محدد");
    const location = colMap.location != null && r[colMap.location] ? String(r[colMap.location]).trim() : "";
    if (!location) issues.push("الموقع/الصيدلية فارغ");
    const issued = toNum(colMap.issued_qty != null ? r[colMap.issued_qty] : null) ?? 0;
    const closing = toNum(colMap.closing_balance != null ? r[colMap.closing_balance] : null) ?? 0;
    if (issued < 0 || closing < 0) issues.push("قيمة سالبة");
    rows.push({
      _row: i + 1, item_code: itemCode || null, item_name: itemName || itemCode,
      scientific_name: colMap.scientific_name != null && r[colMap.scientific_name] ? String(r[colMap.scientific_name]).trim() : null,
      trade_name: colMap.trade_name != null && r[colMap.trade_name] ? String(r[colMap.trade_name]).trim() : null,
      unit: colMap.unit != null && r[colMap.unit] ? String(r[colMap.unit]).trim() : null,
      location: location || "غير محدد", location_type: locType,
      issued_qty: issued, closing_balance: closing, month, issues,
    });
  }
  return { rows, rejected };
}

export default function GoogleSheetSync() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [defaultMonth, setDefaultMonth] = useState("");
  const [snapshotDate, setSnapshotDate] = useState("");
  const [reportDates,setReportDates]=useState<ReportDates>({});
  const [sourceLabel, setSourceLabel] = useState("");
  const [csvText, setCsvText] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; rows: number } | null>(null);

  const effectiveMonth = defaultMonth ? `${defaultMonth}-01` : null;
  function setDefaultMonthAndSnapshot(value: string) {
    setDefaultMonth(value);
  }
  const result = useMemo(() => csvText ? parseCsvText(csvText, effectiveMonth) : null, [csvText, effectiveMonth]);

  const stats = useMemo(() => {
    if (!result) return null;
    const items = new Set(result.rows.map((r) => normalize(r.item_code || r.item_name)));
    const pharms = new Set(result.rows.map((r) => normalize(r.location)));
    const issues = result.rows.reduce((a, r) => a + r.issues.length, 0);
    return { total: result.rows.length, items: items.size, pharms: pharms.size, issues, rejected: result.rejected };
  }, [result]);

  async function syncFromUrl() {
    if (!url.trim()) { setMsg("أدخل رابط Google Sheet"); return; }
    setBusy(true); setMsg(null); setSaved(null);
    try {
      const csvUrl = toCsvExportUrl(url.trim());
      const resp = await fetch(csvUrl, { redirect: "follow" });
      if (!resp.ok) throw new Error(`فشل التحميل (${resp.status}) — تأكد أن الورقة متاحة للجميع كقارئ`);
      const text = await resp.text();
      if (text.trim().startsWith("<")) throw new Error("الرابط لا يُرجع CSV. اجعل الورقة عامة أو استخدم رابط export?format=csv");
      setCsvText(text); setSourceLabel(csvUrl); setSyncedAt(new Date()); setMsg("تمت قراءة الورقة");
    } catch (e: any) { setMsg(e?.message || "فشل المزامنة"); } finally { setBusy(false); }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true); setMsg(null); setSaved(null);
    try {
      const text = await f.text();
      setCsvText(text); setSourceLabel(f.name); setSyncedAt(new Date()); setMsg("تمت قراءة الملف");
    } catch (err: any) { setMsg(err?.message || "تعذّر قراءة الملف"); } finally { setBusy(false); }
  }
  async function commit() {
    if (!result?.rows.length) { setMsg("تم رفع ملف جديد لكن لا توجد صفوف محفوظة صالحة للتحليل. راجع شاشة مراجعة البيانات."); return; }
    if (!effectiveMonth) { setMsg("اختر الشهر الافتراضي قبل الحفظ"); return; }
    if (!snapshotDate) { setMsg("اختر تاريخ الرصيد قبل الحفظ"); return; }
    let dates:ReportDates;
    try{dates=validateReportDates(effectiveMonth,snapshotDate,'monthly',reportDates,todayISO(),true);}
    catch(e){setMsg((e as Error).message);return;}
    setSaving(true); setMsg("جارٍ الحفظ...");
    try {
      const rows = result.rows.map((r) => ({
        item_code: r.item_code, item_name_ar: r.item_name, item_name_en: null,
        active_ingredient_ar: r.scientific_name, strength: null, dosage_form: null,
        unit: r.unit, location: r.location, location_type: r.location_type,
        month: r.month || effectiveMonth, issued_qty: r.issued_qty, closing_balance: r.closing_balance,
      }));
      const payload={
        token: tokenStore.get(),
        fileName: `[google_sheet_csv] ${sourceLabel || "sheet.csv"}`.slice(0, 250),
        month: effectiveMonth, rows, ignored: result.rejected,
        snapshotDate, batchKind: "monthly",
        ...dates,
      };
      let res = await api.upload.saveBatch(payload);
      if(res.requiresRevision&&confirm(res.error))res=await api.upload.saveBatch({...payload,confirmRevision:true});
      if (!res.ok) { setMsg(res.error || "فشل الحفظ"); return; }
      setSaved({ id: res.batchId, rows: res.rows }); setMsg(`تم حفظ ${fmtNum(res.rows)} صف بنجاح.`);
    } finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-5 max-w-[1200px]">
      <header>
        <h1 className="text-2xl font-bold">مزامنة من Google Sheet</h1>
        <p className="text-sm text-muted-fg mt-1">أدخل رابط Google Sheet (مشاركة عامة) أو ارفع ملف CSV ثم راجع الملخص قبل الحفظ.</p>
      </header>

      <section className="card p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <label><span className="label">الشهر الافتراضي</span>
            <input type="month" className="input" value={defaultMonth} onChange={(e) => setDefaultMonthAndSnapshot(e.target.value)} />
          </label>
          <label><span className="label">تاريخ الرصيد (snapshot)</span>
            <input type="date" className="input" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
          </label>
        </div>

        <ReportPeriodFields month={effectiveMonth||''} kind="monthly" value={reportDates} onChange={setReportDates}/>
        <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
          <label><span className="label">رابط Google Sheet (يُحوّل تلقائيًا إلى CSV)</span>
            <input className="input" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={syncFromUrl} disabled={busy}>🔄 مزامنة الآن</button>
        </div>

        <div className="text-sm text-muted-fg">أو ارفع ملف CSV مباشرة:</div>
        <input type="file" accept=".csv,text/csv" className="input" onChange={onFile} disabled={busy} />

        {msg && <div className="text-sm font-semibold text-primary">{msg}</div>}
        {syncedAt && <div className="text-xs text-muted-fg">آخر مزامنة: {syncedAt.toLocaleString("ar-EG")} — المصدر: {sourceLabel}</div>}
      </section>

      {stats && (
        <section className="card p-5 space-y-3">
          <div className="font-bold">ملخص قبل الحفظ</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="card p-3"><div className="text-xs text-muted-fg">صفوف</div><div className="text-xl font-bold">{fmtNum(stats.total)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted-fg">أصناف</div><div className="text-xl font-bold">{fmtNum(stats.items)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted-fg">صيدليات</div><div className="text-xl font-bold">{fmtNum(stats.pharms)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted-fg">مشاكل</div><div className="text-xl font-bold text-warn">{fmtNum(stats.issues)}</div></div>
            <div className="card p-3"><div className="text-xs text-muted-fg">مرفوضة</div><div className="text-xl font-bold text-danger">{fmtNum(stats.rejected)}</div></div>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-primary" onClick={commit} disabled={saving || !stats.total || !effectiveMonth || !snapshotDate}>
              {saving ? "..." : "✅ اعتماد وحفظ"}
            </button>
          </div>
        </section>
      )}

      {saved && (
        <section className="card p-4 border-primary/30 bg-primary-soft/40">
          <div className="text-sm font-semibold text-primary mb-2">تم حفظ البيانات بنجاح</div>
          <div className="text-sm font-semibold mb-2">الخطوة التالية:</div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary" onClick={() => navigate("/daily")}>افتح مركز العمل اليومي</button>
            <button className="btn-outline" onClick={() => navigate("/alerts")}>عرض التنبيهات</button>
            <button className="btn-outline" onClick={() => navigate(`/items?batch=${saved.id}`)}>تحليل الأصناف</button>
          </div>
        </section>
      )}
    </div>
  );
}
