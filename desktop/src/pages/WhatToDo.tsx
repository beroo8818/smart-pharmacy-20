import { useEffect, useMemo, useState } from "react";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, fmtMonth, fmtNum, loadLatestDataset, suggestTransfers, AnalysisRow, TransferRow, normalize, isMainLocation } from "@/lib/desktopAnalytics";
import ItemIdentity from "@/components/ItemIdentity";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeftRight, PackageOpen, ShoppingCart, Warehouse, AlertOctagon } from "lucide-react";

function sevClass(s: string) {
  if (s === "high") return "bg-destructive/15 text-destructive";
  if (s === "medium") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}
function sevLabel(s: string) {
  if (s === "high") return "عاجل";
  if (s === "medium") return "متوسط";
  return "عادي";
}

function RecCard({ r, icon: Icon }: { r: AnalysisRow; icon: any }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 flex-1 min-w-[280px]">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} code={r.itemCode} />
            <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">
              إلى <span className="font-medium text-foreground">{r.locationName}</span>
            </div>
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-xs shrink-0 ${sevClass(r.severity)}`}>{sevLabel(r.severity)}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
        <div><div className="text-muted-foreground">الرصيد الحالي</div><div className="font-semibold mt-0.5">{fmtNum(r.balance)}</div></div>
        <div><div className="text-muted-foreground">المنصرف الشهري</div><div className="font-semibold mt-0.5">{fmtNum(r.issued, 1)}</div></div>
        <div><div className="text-muted-foreground">متوسط يومي</div><div className="font-semibold mt-0.5">{fmtNum(r.adc, 2)}</div></div>
        <div><div className="text-muted-foreground">يكفي</div><div className="font-semibold mt-0.5">{r.days == null ? "—" : `${r.days.toFixed(1)} يوم`}</div></div>
      </div>

      <div className="mt-3 text-sm whitespace-normal break-words" dir="auto">
        <span className="text-muted-foreground">الإجراء المقترح: </span>
        <span className="font-medium">{r.action}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground whitespace-normal break-words" dir="auto">
        <span>السبب: </span>{r.why}
      </div>
    </Card>
  );
}

function TransferCard({ t, icon: Icon }: { t: TransferRow; icon: any }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3 flex-1 min-w-[280px]">
        <div className="w-9 h-9 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <ItemIdentity name={t.itemName} tradeNames={t.tradeNames} code={t.itemCode} />
          <div className="text-xs text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">
            من <span className="font-medium text-foreground">{t.from}</span> ← إلى <span className="font-medium text-foreground">{t.to}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 text-sm whitespace-normal break-words" dir="auto">
        <span className="text-muted-foreground">الكمية: </span>
        <span className="font-bold">{fmtNum(t.qty)}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground whitespace-normal break-words" dir="auto">
        <span>السبب: </span>{t.reason}
      </div>
    </Card>
  );
}

function Section<T>({ title, icon, iconColor, items, emptyText, renderItem }: {
  title: string; icon: any; iconColor: string; items: T[]; emptyText: string; renderItem: (item: T, i: number) => React.ReactNode;
}) {
  const Icon = icon;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-bold flex items-center gap-2">
          <span className={`w-8 h-8 rounded-md flex items-center justify-center ${iconColor}`}><Icon className="w-4 h-4" /></span>
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">{items.length} توصية</span>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">{emptyText}</div>
      ) : (
        <div className="grid gap-3">
          {items.map((r, i) => renderItem(r, i))}
        </div>
      )}
    </Card>
  );
}

export default function WhatToDo() {
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<number>(30);
  const [sevFilter, setSevFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const d = await loadLatestDataset(api, tokenStore.get());
      setBatch(d.batch);
      setMovements(d.movements);
      setLoading(false);
    })();
  }, []);

  const rows = useMemo(() => analyzeMovements(movements, target), [movements, target]);
  const transfers = useMemo(() => suggestTransfers(rows, target), [rows, target]);

  const needs = useMemo(() => rows.filter((r) => ["critical", "danger", "below"].includes(r.kind) && !isMainLocation(r.locationType)), [rows]);
  const noOrder = useMemo(() => rows.filter((r) => ["over", "very_over", "deadstock"].includes(r.kind) && !isMainLocation(r.locationType)), [rows]);

  const summary = useMemo(() => {
    let critical = 0, below = 0, over = 0, dead = 0;
    for (const r of rows) {
      if (isMainLocation(r.locationType)) continue;
      if (r.kind === "critical" || r.kind === "danger") critical++;
      else if (r.kind === "below") below++;
      else if (r.kind === "over" || r.kind === "very_over") over++;
      else if (r.kind === "deadstock") dead++;
    }
    return { critical, below, over, dead, transfers: transfers.length };
  }, [rows, transfers.length]);

  const pharmacySummary = useMemo(() => {
    const m = new Map<string, { name: string; critical: number; below: number; over: number; worstName: string; worstDays: number | null }>();
    for (const r of rows) {
      if (isMainLocation(r.locationType)) continue;
      const k = normalize(r.locationName);
      const prev = m.get(k) || { name: r.locationName, critical: 0, below: 0, over: 0, worstName: "", worstDays: null };
      if (r.kind === "critical" || r.kind === "danger") prev.critical++;
      else if (r.kind === "below") prev.below++;
      else if (r.kind === "over" || r.kind === "very_over") prev.over++;
      if (r.days != null && (prev.worstDays == null || r.days < prev.worstDays)) {
        prev.worstDays = r.days;
        prev.worstName = r.itemName;
      }
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.critical - a.critical);
  }, [rows]);

  const filteredNeeds = useMemo(() => {
    const s = normalize(q);
    return needs.filter((r) => {
      if (sevFilter !== "all" && r.severity !== sevFilter) return false;
      if (s && !normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.locationName}`).includes(s)) return false;
      return true;
    });
  }, [needs, sevFilter, q]);

  const filteredTransfers = useMemo(() => {
    const s = normalize(q);
    return transfers.filter((t) => {
      if (s && !normalize(`${t.itemName} ${t.tradeNames?.join(" ")} ${t.itemCode || ""} ${t.from} ${t.to}`).includes(s)) return false;
      return true;
    });
  }, [transfers, q]);

  const filteredNoOrder = useMemo(() => {
    const s = normalize(q);
    return noOrder.filter((r) => {
      if (s && !normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.locationName}`).includes(s)) return false;
      return true;
    });
  }, [noOrder, q]);

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader
        title="ماذا أفعل الآن؟"
        description="قرارات عملية مبنية على آخر ملف محفوظ — صرف من المخزن، تحويل بين الصيدليات، طلب توريد، وما لا يجب طلبه."
      />

      {batch && (
        <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-muted-foreground">مصدر البيانات</div><div className="font-semibold truncate" dir="auto" title={batch.file_name}>{batch.file_name}</div></div>
            <div><div className="text-xs text-muted-foreground">الشهر</div><div className="font-semibold">{fmtMonth(batch.month)}</div></div>
            <div><div className="text-xs text-muted-foreground">الصفوف المحفوظة</div><div className="font-semibold">{fmtNum(batch.rows_saved)}</div></div>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الأولوية</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={sevFilter} onChange={(e) => setSevFilter(e.target.value as any)}>
              <option value="all">الكل</option>
              <option value="high">عاجل</option>
              <option value="medium">متوسط</option>
              <option value="low">عادي</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="اسم الصنف أو الصيدلية..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="text-muted-foreground">جارٍ التحميل...</div>
      ) : !batch ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card className="p-4"><div className="text-xs text-muted-foreground">خطر جدًا (أقل من 14 يوم)</div><div className="text-2xl font-bold mt-1 text-destructive">{summary.critical}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أقل من الهدف</div><div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{summary.below}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">تحويلات مقترحة</div><div className="text-2xl font-bold mt-1">{summary.transfers}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أصناف زائدة</div><div className="text-2xl font-bold mt-1 text-sky-600 dark:text-sky-400">{summary.over}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground">أصناف راكدة</div><div className="text-2xl font-bold mt-1 text-muted-foreground">{summary.dead}</div></Card>
          </div>

          {/* Per pharmacy */}
          <Card className="p-5 mb-6">
            <h2 className="font-bold mb-3">ملخص حسب الصيدلية</h2>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-right p-2 min-w-[160px]">الصيدلية</th>
                    <th className="text-right p-2">خطر نقص</th>
                    <th className="text-right p-2">أقل من الهدف</th>
                    <th className="text-right p-2">زائد</th>
                    <th className="text-right p-2 min-w-[280px]">أسوأ صنف</th>
                    <th className="text-right p-2 whitespace-nowrap">أيام التغطية</th>
                  </tr>
                </thead>
                <tbody>
                  {pharmacySummary.length === 0 && (
                    <tr><td colSpan={6} className="p-3 text-center text-muted-foreground">لا توجد بيانات</td></tr>
                  )}
                  {pharmacySummary.map((p) => (
                    <tr key={p.name} className="border-b border-border/50">
                      <td className="p-2 whitespace-normal break-words align-top" dir="auto">{p.name}</td>
                      <td className="p-2 text-destructive align-top">{p.critical}</td>
                      <td className="p-2 text-amber-600 dark:text-amber-400 align-top">{p.below}</td>
                      <td className="p-2 text-sky-600 dark:text-sky-400 align-top">{p.over}</td>
                      <td className="p-2 align-top whitespace-normal break-words" dir="auto">{p.worstName || "—"}</td>
                      <td className="p-2 align-top whitespace-nowrap font-semibold">{p.worstDays == null ? "—" : `${p.worstDays.toFixed(1)} يوم`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6">
            <Section
              title="أصناف تحتاج صرفًا أو توريدًا"
              icon={Warehouse}
              iconColor="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              items={filteredNeeds}
              emptyText="لا توجد توصيات بالنسبة للهدف الحالي."
              renderItem={(r, i) => <RecCard key={i} r={r} icon={Warehouse} />}
            />
            <Section
              title="أصناف يجب تحويلها بين الصيدليات"
              icon={ArrowLeftRight}
              iconColor="bg-sky-500/15 text-sky-600 dark:text-sky-400"
              items={filteredTransfers}
              emptyText="لا توجد تحويلات مقترحة بين الصيدليات."
              renderItem={(t, i) => <TransferCard key={i} t={t} icon={ArrowLeftRight} />}
            />
            <Section
              title="لا تطلب هذا الشهر"
              icon={PackageOpen}
              iconColor="bg-muted text-muted-foreground"
              items={filteredNoOrder}
              emptyText="لا توجد أصناف زائدة أو راكدة."
              renderItem={(r, i) => <RecCard key={i} r={r} icon={PackageOpen} />}
            />
          </div>
        </>
      )}
    </div>
  );
}
