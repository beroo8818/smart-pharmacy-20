
import { useEffect, useMemo, useState } from "react";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, fmtMonth, fmtNum, KIND_CLASS, KIND_LABEL, normalize } from "@/lib/desktopAnalytics";
import { useSearchParams } from "react-router-dom";
import ItemIdentity from "@/components/ItemIdentity";

export default function Items() {
  const [searchParams] = useSearchParams();
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(30);
  const [kind, setKind] = useState("all");

  useEffect(() => { (async () => {
    const token = tokenStore.get();
    const bs = await api.queries.listBatches({ token }); setBatches(bs.batches || []);
    const wanted = searchParams.get("batch") || bs.batches?.[0]?.id;
    if (wanted) { const b = (bs.batches || []).find((x) => x.id === wanted) || null; setBatch(b); const m = await api.queries.movementsByBatch({ token, batchId: wanted }); setMovements(m.movements || []); }
    setLoading(false);
  })(); }, [searchParams]);

  async function selectBatch(id: string) { setLoading(true); const b = batches.find((x) => x.id === id) || null; setBatch(b); const m = await api.queries.movementsByBatch({ token: tokenStore.get(), batchId: id }); setMovements(m.movements || []); setLoading(false); }
  const rows = useMemo(() => analyzeMovements(movements, target), [movements, target]);
  const filtered = rows.filter((r) => (kind === "all" || r.kind === kind) && normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode} ${r.locationName}`).includes(normalize(q)));
  const summary = useMemo(() => rows.reduce((acc, r) => { acc[r.kind] = (acc[r.kind] || 0) + 1; return acc; }, {} as Record<string, number>), [rows]);

  return <div className="p-6 space-y-5">
    <header><h1 className="text-2xl font-bold">تحليل الأصناف</h1><p className="text-sm text-muted-fg mt-1">حالة كل صنف داخل كل صيدلية أو مخزن.</p></header>
    <section className="card p-5 grid md:grid-cols-4 gap-3 items-end">
      <label><span className="label">دفعة البيانات</span><select className="input" value={batch?.id || ""} onChange={(e)=>selectBatch(e.target.value)}>{batches.map(b=><option key={b.id} value={b.id}>{fmtMonth(b.month)} - {b.file_name}</option>)}</select></label>
      <label><span className="label">هدف التغطية بالأيام</span><input className="input" type="number" min={7} value={target} onChange={(e)=>setTarget(Number(e.target.value)||30)} /></label>
      <label><span className="label">الحالة</span><select className="input" value={kind} onChange={(e)=>setKind(e.target.value)}><option value="all">كل الحالات</option>{Object.entries(KIND_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label><span className="label">بحث</span><input className="input" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="اسم الصنف أو الموقع" /></label>
    </section>
    {loading ? <div className="card p-8 text-center text-muted-fg">جارٍ التحميل...</div> : !batch ? <Empty /> : <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Object.entries(KIND_LABEL).slice(0,5).map(([k,v])=><div key={k} className="card p-3"><div className="text-xs text-muted-fg">{v}</div><div className="text-xl font-bold">{fmtNum(summary[k] || 0)}</div></div>)}</div>
      <section className="card overflow-hidden"><div className="p-4 border-b border-border text-sm text-muted-fg">مصدر التحليل: {batch.file_name} — {fmtMonth(batch.month)} — {fmtNum(movements.length)} صف خام</div><div className="overflow-auto max-h-[62vh]"><table className="w-full text-xs"><thead className="bg-muted text-muted-fg sticky top-0"><tr><th className="p-2 text-right">الصنف</th><th className="p-2 text-right">الموقع</th><th className="p-2">الرصيد</th><th className="p-2">المنصرف</th><th className="p-2">أيام التغطية</th><th className="p-2">الحالة</th><th className="p-2 text-right">الإجراء</th></tr></thead><tbody>{filtered.map((r)=><tr key={r.key} className="border-b border-border/60"><td className="p-2"><ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} /></td><td className="p-2">{r.locationName}</td><td className="p-2 text-center">{fmtNum(r.balance)}</td><td className="p-2 text-center">{fmtNum(r.issued)}</td><td className="p-2 text-center">{r.days == null ? "-" : fmtNum(r.days,1)}</td><td className="p-2 text-center"><span className={`pill border ${KIND_CLASS[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td><td className="p-2">{r.action}</td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}
function Empty(){return <div className="card p-8 text-center"><div className="font-bold mb-1">لا توجد بيانات محفوظة</div><div className="text-sm text-muted-fg">ابدأ من صفحة رفع البيانات واحفظ ملف Excel.</div></div>}
