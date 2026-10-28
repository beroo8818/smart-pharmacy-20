import { useMemo, useState } from "react";
import {useLiveInventory} from '../../../shared/useLiveInventory';
import { api, tokenStore, UploadBatch } from "@/integrations/desktop/client";
import ItemIdentity from "@/components/ItemIdentity";

type DecisionStatus = "new" | "approved" | "rejected" | "postponed" | "executed";
type Rec = {
  id: string; section: string; itemName: string; tradeNames?: string[]; itemCode: string | null;
  to: string; from?: string; qty?: number; kind: string;
};
type Decision = { status: DecisionStatus; at: string; qty?: number | null; note?: string | null; rec: Rec };
type Row = Decision & { batchId: string; batchName: string };

const STATUS_LABEL: Record<DecisionStatus, string> = {
  new: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض", postponed: "مؤجل", executed: "تم التنفيذ",
};
const STATUS_CLASS: Record<DecisionStatus, string> = {
  new: "bg-muted text-muted-fg border border-border",
  approved: "bg-success-soft text-success border border-success/30",
  rejected: "bg-danger-soft text-danger border border-danger/30",
  postponed: "bg-warn-soft text-warn border border-warn/30",
  executed: "bg-primary-soft text-primary border border-primary/30",
};
const TYPE_LABEL: Record<string, string> = {
  dispense_from_main: "صرف من المخزن",
  transfer_between: "تحويل بين صيدليات",
  urgent: "نقص عاجل",
  do_not_order: "لا تطلب",
  review_data: "مراجعة بيانات",
};

async function loadRows(){
      const res = await api.queries.listBatches({ token: tokenStore.get() });
      const locationRes=await api.queries.listLocations({token:tokenStore.get()});
      if(!res.ok||!locationRes.ok)throw new Error('تعذر التحقق من نطاق سجل الإجراءات');
      const names=new Set((locationRes.locations||[]).map(l=>l.name));
      const batches: UploadBatch[] = (res && (res as any).batches) || [];
      const all: Row[] = [];
      for (const b of batches || []) {
        try {
          const raw = localStorage.getItem(`desktop_decisions_${b.id}`);
          if (!raw) continue;
          const map: Record<string, Decision> = JSON.parse(raw);
          for (const d of Object.values(map))if(d?.rec&&(names.has(d.rec.to)||!!d.rec.from&&names.has(d.rec.from)))all.push({ ...d, batchId: b.id, batchName: b.file_name });
        } catch {}
      }
      all.sort((a, b) => (a.at < b.at ? 1 : -1));
      return all;
}
export default function ActionsLog() {
  const {data,error,loading}=useLiveInventory(loadRows);
  const rows=error?[]:data||[];
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (typeFilter && r.rec.kind !== typeFilter) return false;
      if (!s) return true;
      return [r.rec.itemName, ...(r.rec.tradeNames || []), r.rec.from, r.rec.to, r.note, r.batchName]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [rows, q, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const out: Record<DecisionStatus, number> = { new: 0, approved: 0, rejected: 0, postponed: 0, executed: 0 };
    for (const r of rows) out[r.status]++;
    return out;
  }, [rows]);

  return (
    <div className="p-6 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">سجل الإجراءات</h1>
        <p className="text-sm text-muted-fg mt-1">قرارات هذا الجهاز ضمن المواقع المسموحة لحسابك. قرارات الواجهة القديمة ليست حركات مخزون ولا يشملها ملف نسخ SQLite وحده.</p>
        {error&&<p role="alert">{error}</p>}
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(Object.keys(STATUS_LABEL) as DecisionStatus[]).map((s) => (
          <div key={s} className="card p-4">
            <div className="text-xs text-muted-fg">{STATUS_LABEL[s]}</div>
            <div className="text-2xl font-bold mt-1">{summary[s]}</div>
          </div>
        ))}
      </div>

      <section className="card p-4 grid gap-3 md:grid-cols-3">
        <label><span className="label">الحالة</span>
          <select className="input w-full" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">الكل</option>
            {(Object.keys(STATUS_LABEL) as DecisionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></label>
        <label><span className="label">النوع</span>
          <select className="input w-full" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label><span className="label">بحث</span>
          <input className="input w-full" placeholder="صنف / صيدلية / ملاحظة..." value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </section>

      {loading ? <div className="card p-8 text-center text-muted-fg">جارٍ التحميل...</div>
        : !filtered.length ? <div className="card p-8 text-center text-muted-fg">لا توجد إجراءات بعد.</div>
        : (
          <section className="card overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-fg sticky top-0">
                  <tr>
                    <th className="p-2 text-right">التاريخ</th>
                    <th className="p-2 text-right">الحالة</th>
                    <th className="p-2 text-right">النوع</th>
                    <th className="p-2 text-right">الصنف</th>
                    <th className="p-2 text-right">من</th>
                    <th className="p-2 text-right">إلى</th>
                    <th className="p-2 text-right">مقترحة</th>
                    <th className="p-2 text-right">منفذة</th>
                    <th className="p-2 text-right">ملاحظة</th>
                    <th className="p-2 text-right">الملف</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 align-top">
                      <td className="p-2 whitespace-nowrap" dir="ltr">{new Date(r.at).toLocaleString("ar-EG")}</td>
                      <td className="p-2"><span className={`px-2 py-0.5 rounded text-[11px] ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td className="p-2">{TYPE_LABEL[r.rec.kind] || r.rec.kind}</td>
                      <td className="p-2"><ItemIdentity name={r.rec.itemName} tradeNames={r.rec.tradeNames} code={r.rec.itemCode} /></td>
                      <td className="p-2" dir="auto">{r.rec.from || "—"}</td>
                      <td className="p-2" dir="auto">{r.rec.to || "—"}</td>
                      <td className="p-2">{r.rec.qty ?? "—"}</td>
                      <td className="p-2 font-bold">{r.qty ?? "—"}</td>
                      <td className="p-2" dir="auto">{r.note || "—"}</td>
                      <td className="p-2 text-muted-fg" dir="auto">{r.batchName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
    </div>
  );
}
