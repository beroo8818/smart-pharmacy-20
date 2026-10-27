import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, tokenStore, STOCK_TXN_LABEL, type StockTxn, type StockTxnType } from "@/integrations/desktop/client";
import { useAuth } from "@/hooks/useAuth";
import { itemKeyFromParts, normalize, num, fmtNum } from "@/lib/desktopAnalytics";

const TYPES: { value: StockTxnType; needs: { from: boolean; to: boolean }; fromType?: string; toType?: string }[] = [
  { value: "warehouse_receipt", needs: { from: false, to: true }, toType: "main_warehouse" },
  { value: "warehouse_issue_to_pharmacy", needs: { from: true, to: true }, fromType: "main_warehouse", toType: "sub_pharmacy" },
  { value: "pharmacy_issue", needs: { from: true, to: false }, fromType: "sub_pharmacy" },
  { value: "pharmacy_transfer", needs: { from: true, to: true }, fromType: "sub_pharmacy", toType: "sub_pharmacy" },
  { value: "warehouse_return", needs: { from: true, to: false }, fromType: "sub_pharmacy" },
  { value: "pharmacy_return_to_warehouse", needs: { from: true, to: true }, fromType: "sub_pharmacy", toType: "main_warehouse" },
];

export default function StockTransactions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = user && ["system_admin", "pharmacy_manager", "warehouse_keeper"].includes(user.role);

  const [rows, setRows] = useState<StockTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [txnType, setTxnType] = useState<StockTxnType>("warehouse_receipt");
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [itemName, setItemName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [activeIngredient, setActiveIngredient] = useState("");
  const [strength, setStrength] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [unit, setUnit] = useState("");
  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const cfg = TYPES.find((t) => t.value === txnType)!;

  async function reload() {
    setLoading(true);
    try {
      const res = await api.stockTxn.list({ token: tokenStore.get() });
      if (res.ok && res.rows) setRows(res.rows);
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function save() {
    setMsg(null);
    if (!activeIngredient.trim()) { setMsg("اكتب المادة الفعالة"); return; }
    if (!strength.trim()) { setMsg("اكتب التركيز"); return; }
    const q = num(qty);
    if (q <= 0) { setMsg("كمية غير صالحة"); return; }
    if (cfg.needs.from && !fromName.trim()) { setMsg("اكتب الموقع المصدر"); return; }
    if (cfg.needs.to && !toName.trim()) { setMsg("اكتب الموقع الهدف"); return; }
    if (note.trim().length < 5) { setMsg("اكتب سبب الحركة أو رقم المستند"); return; }
    setBusy(true);
    try {
      const displayName = itemName.trim() || [activeIngredient.trim(), strength.trim(), dosageForm.trim()].filter(Boolean).join(" ");
      const res = await api.stockTxn.insert({
        token: tokenStore.get(),
        txn: {
          txn_date: date,
          txn_type: txnType,
          item_key: itemKeyFromParts({
            item_name_ar: displayName,
            item_name_en: displayName,
            item_code: itemCode.trim() || null,
            active_ingredient_ar: activeIngredient.trim(),
            strength: strength.trim(),
            dosage_form: dosageForm.trim() || null,
            unit: unit.trim() || null,
          }),
          item_name: displayName,
          item_code: itemCode.trim() || null,
          unit: unit.trim() || null,
          from_location_name: cfg.needs.from ? fromName.trim() : null,
          from_location_type: cfg.needs.from ? (cfg.fromType || null) : null,
          to_location_name: cfg.needs.to ? toName.trim() : null,
          to_location_type: cfg.needs.to ? (cfg.toType || null) : null,
          qty: q,
          note: note.trim() || null,
          source_batch_id: null,
        },
      });
      if (!res.ok) { setMsg(res.error || "فشل الحفظ"); return; }
      setMsg("تم حفظ الحركة");
      setLastSaved(`${STOCK_TXN_LABEL[txnType]} — ${displayName} (${q})`);
      setItemName(""); setItemCode(""); setActiveIngredient(""); setStrength(""); setDosageForm(""); setUnit(""); setFromName(""); setToName(""); setQty(""); setNote("");
      reload();
    } finally { setBusy(false); }
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const f = normalize(filter);
    return rows.filter((r) =>
      normalize(r.item_key).includes(f) ||
      normalize(r.item_name).includes(f) ||
      normalize(r.item_code).includes(f) ||
      normalize(r.from_location_name).includes(f) ||
      normalize(r.to_location_name).includes(f)
    );
  }, [rows, filter]);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">سجل الحركات اليومية</h1>
        <p className="text-sm text-muted-fg mt-1">حركات المخزن والصيدليات بعد تاريخ الرصيد — يستخدمها التحليل لتحديث الرصيد المتوقع.</p>
      </div>

      {canWrite && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="font-bold">إضافة حركة</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span>نوع الحركة</span>
              <select value={txnType} onChange={(e) => setTxnType(e.target.value as StockTxnType)} className="input">
                {TYPES.map((t) => <option key={t.value} value={t.value}>{STOCK_TXN_LABEL[t.value]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span>التاريخ</span>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1"><span>الكمية</span>
              <input type="number" min="0" className="input" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1"><span>المادة الفعالة</span>
              <input className="input" value={activeIngredient} onChange={(e) => setActiveIngredient(e.target.value)} placeholder="مثال: Ceftriaxone" />
            </label>
            <label className="flex flex-col gap-1"><span>التركيز</span>
              <input className="input" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="مثال: 1 gm" />
            </label>
            <label className="flex flex-col gap-1"><span>الشكل الدوائي (اختياري)</span>
              <input className="input" value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} placeholder="مثال: vial / tablet" />
            </label>
            <label className="flex flex-col gap-1"><span>اسم الصنف / التجاري (اختياري)</span>
              <input className="input" value={itemName} onChange={(e) => setItemName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1"><span>كود الصنف (اختياري)</span>
              <input className="input" value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1"><span>الوحدة (اختياري)</span>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            {cfg.needs.from && (
              <label className="flex flex-col gap-1"><span>من (موقع)</span>
                <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="مثال: المخزن الرئيسي" />
              </label>
            )}
            {cfg.needs.to && (
              <label className="flex flex-col gap-1"><span>إلى (موقع)</span>
                <input className="input" value={toName} onChange={(e) => setToName(e.target.value)} placeholder="مثال: صيدلية الباطنة" />
              </label>
            )}
            <label className="flex flex-col gap-1 md:col-span-3"><span>سبب الحركة / رقم المستند (مطلوب)</span>
              <textarea rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-fg">{msg}</div>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "..." : "حفظ الحركة"}</button>
          </div>
          {lastSaved && (
            <div className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 space-y-2">
              <div className="text-sm font-semibold text-primary">تم حفظ الحركة بنجاح</div>
              <div className="text-xs text-muted-fg">{lastSaved}</div>
              <div className="text-sm font-semibold">الخطوة التالية:</div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-primary" onClick={() => navigate("/items")}>راجع التحليل</button>
                <button className="btn-outline" onClick={() => navigate("/daily")}>افتح مركز العمل اليومي</button>
                <button className="btn-outline" onClick={() => navigate("/alerts")}>عرض التنبيهات</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="font-bold">آخر الحركات</div>
          <input className="input max-w-xs" placeholder="ابحث بالصنف أو الموقع" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {loading ? (
          <div className="text-muted-fg text-sm py-6 text-center">جارٍ التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-fg text-sm py-6 text-center">لا توجد حركات.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-right p-2">التاريخ</th>
                  <th className="text-right p-2">الصنف</th>
                  <th className="text-right p-2">من</th>
                  <th className="text-right p-2">إلى</th>
                  <th className="text-right p-2">نوع الحركة</th>
                  <th className="text-right p-2">الكمية</th>
                  <th className="text-right p-2">الملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{r.txn_date}</td>
                    <td className="p-2">{r.item_name || r.item_code || "—"}</td>
                    <td className="p-2">{r.from_location_name || "—"}</td>
                    <td className="p-2">{r.to_location_name || "—"}</td>
                    <td className="p-2">{STOCK_TXN_LABEL[r.txn_type]}</td>
                    <td className="p-2 font-medium">{fmtNum(r.qty)}</td>
                    <td className="p-2 text-muted-fg">{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
