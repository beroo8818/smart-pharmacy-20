import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchStockTransactions, TXN_LABEL, type StockTxn } from "@/lib/continuousAnalysis";
import { itemKeyFromParts, normalize, num } from "@/lib/batchAnalysis";
import { logAudit } from "@/lib/audit";
import { canRegisterStockTx } from "@/lib/permissions";

type TxnType = StockTxn["txn_type"];

const TYPES: { value: TxnType; label: string; needs: { from: boolean; to: boolean } }[] = [
  { value: "warehouse_receipt", label: TXN_LABEL.warehouse_receipt, needs: { from: false, to: true } },
  { value: "warehouse_issue_to_pharmacy", label: TXN_LABEL.warehouse_issue_to_pharmacy, needs: { from: true, to: true } },
  { value: "pharmacy_issue", label: TXN_LABEL.pharmacy_issue, needs: { from: true, to: false } },
  { value: "pharmacy_transfer", label: TXN_LABEL.pharmacy_transfer, needs: { from: true, to: true } },
  { value: "warehouse_return", label: TXN_LABEL.warehouse_return, needs: { from: true, to: false } },
  { value: "pharmacy_return_to_warehouse", label: TXN_LABEL.pharmacy_return_to_warehouse, needs: { from: true, to: true } },
];

export default function StockTransactions() {
  const { user, roles } = useAuth();
  const navigate = useNavigate();
  const canWrite = roles.some((r) => ["system_admin", "pharmacy_manager", "warehouse_keeper", "sub_pharmacist"].includes(r));

  const [rows, setRows] = useState<StockTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  // Form
  const [txnType, setTxnType] = useState<TxnType>("warehouse_receipt");
  const [date, setDate] = useState<string>(new Date().toISOString().substring(0, 10));
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
      const r = await fetchStockTransactions();
      setRows(r);
    } catch (e: any) {
      toast.error("فشل تحميل الحركات: " + (e?.message || ""));
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function save() {
    if (!user) { toast.error("يجب تسجيل الدخول"); return; }
    if (!canRegisterStockTx(roles)) { toast.error("غير مسموح: تسجيل حركات المخزن غير متاح لدورك."); return; }
    if (!activeIngredient.trim()) { toast.error("اكتب المادة الفعالة"); return; }
    if (!strength.trim()) { toast.error("اكتب التركيز"); return; }
    const q = num(qty);
    if (q <= 0) { toast.error("كمية غير صالحة"); return; }
    if (cfg.needs.from && !fromName.trim()) { toast.error("اكتب الموقع المصدر"); return; }
    if (cfg.needs.to && !toName.trim()) { toast.error("اكتب الموقع الهدف"); return; }

    if (note.trim().length < 5) { toast.error("اكتب سبب الحركة أو رقم المستند في الملاحظة"); return; }

    const fromType = txnType.startsWith("warehouse_") && cfg.needs.from
      ? (txnType === "warehouse_issue_to_pharmacy" ? "main_warehouse" : "sub_pharmacy")
      : (cfg.needs.from ? "sub_pharmacy" : null);
    const toType = cfg.needs.to
      ? (txnType === "warehouse_receipt" || txnType === "pharmacy_return_to_warehouse" ? "main_warehouse" : "sub_pharmacy")
      : null;

    setBusy(true);
    try {
      const displayName = itemName.trim() || [activeIngredient.trim(), strength.trim(), dosageForm.trim()].filter(Boolean).join(" ");
      const payload = {
        txn_date: date,
        txn_type: txnType,
        item_key: itemKeyFromParts({
          item_name: displayName,
          item_code: itemCode.trim() || null,
          scientific_name: activeIngredient.trim(),
          strength: strength.trim(),
          dosage_form: dosageForm.trim() || null,
          unit: unit.trim() || null,
        }),
        item_name: displayName,
        item_code: itemCode.trim() || null,
        unit: unit.trim() || null,
        from_location_name: cfg.needs.from ? fromName.trim() : null,
        from_location_type: fromType,
        to_location_name: cfg.needs.to ? toName.trim() : null,
        to_location_type: toType,
        qty: q,
        note: note.trim() || null,
        created_by: user.id,
      };
      const { error } = await (supabase as any).from("stock_transactions").insert(payload);
      if (error) throw error;
      await logAudit({
        userId: user.id,
        action: "stock_transaction_created",
        entityType: "stock_transactions",
        newValue: payload,
      });
      toast.success("تم حفظ الحركة");
      setLastSaved(`${TXN_LABEL[txnType]} — ${displayName} (${q})`);
      setItemName(""); setItemCode(""); setActiveIngredient(""); setStrength(""); setDosageForm(""); setUnit(""); setFromName(""); setToName(""); setQty(""); setNote("");
      reload();
    } catch (e: any) {
      toast.error("فشل الحفظ: " + (e?.message || ""));
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
      <PageHeader
        title="سجل الحركات اليومية"
        description="حركات المخزن والصيدليات بعد تاريخ الرصيد — يستخدمها التحليل لتحديث الرصيد المتوقع اليوم."
      />

      {canWrite && (
        <Card className="p-5 space-y-3">
          <div className="font-bold">إضافة حركة</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span>نوع الحركة</span>
              <select value={txnType} onChange={(e) => setTxnType(e.target.value as TxnType)} className="border rounded-md px-2 py-2 bg-background">
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>التاريخ</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span>الكمية</span>
              <Input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span>المادة الفعالة</span>
              <Input value={activeIngredient} onChange={(e) => setActiveIngredient(e.target.value)} placeholder="مثال: Ceftriaxone" />
            </label>
            <label className="flex flex-col gap-1">
              <span>التركيز</span>
              <Input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="مثال: 1 gm" />
            </label>
            <label className="flex flex-col gap-1">
              <span>الشكل الدوائي (اختياري)</span>
              <Input value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} placeholder="مثال: vial / tablet" />
            </label>
            <label className="flex flex-col gap-1">
              <span>اسم الصنف / التجاري (اختياري)</span>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span>كود الصنف (اختياري)</span>
              <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span>الوحدة (اختياري)</span>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            {cfg.needs.from && (
              <label className="flex flex-col gap-1">
                <span>من (موقع)</span>
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="مثال: المخزن الرئيسي أو صيدلية العيادات" />
              </label>
            )}
            {cfg.needs.to && (
              <label className="flex flex-col gap-1">
                <span>إلى (موقع)</span>
                <Input value={toName} onChange={(e) => setToName(e.target.value)} placeholder="مثال: صيدلية الباطنة" />
              </label>
            )}
            <label className="flex flex-col gap-1 md:col-span-3">
              <span>سبب الحركة / رقم المستند (مطلوب)</span>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </label>
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? "..." : "حفظ الحركة"}</Button>
          </div>
          {lastSaved && (
            <div className="mt-3 rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
              <div className="text-sm font-semibold text-primary mb-1">تم حفظ الحركة بنجاح</div>
              <div className="text-xs text-muted-foreground mb-2">{lastSaved}</div>
              <div className="text-sm font-semibold mb-2">الخطوة التالية:</div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => navigate("/items")}>راجع التحليل</Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/daily")}>افتح مركز العمل اليومي</Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/alerts")}>عرض التنبيهات</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="font-bold">آخر الحركات</div>
          <Input
            placeholder="ابحث بالصنف أو الموقع"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {loading ? (
          <div className="text-muted-foreground text-sm py-6 text-center">جارٍ التحميل…</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-sm py-6 text-center">لا توجد حركات.</div>
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
                  <tr key={r.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{r.txn_date}</td>
                    <td className="p-2">{r.item_name || r.item_code || "—"}</td>
                    <td className="p-2">{r.from_location_name || "—"}</td>
                    <td className="p-2">{r.to_location_name || "—"}</td>
                    <td className="p-2">{TXN_LABEL[r.txn_type]}</td>
                    <td className="p-2 font-medium">{num(r.qty).toLocaleString("ar-EG")}</td>
                    <td className="p-2 text-muted-foreground">{r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
